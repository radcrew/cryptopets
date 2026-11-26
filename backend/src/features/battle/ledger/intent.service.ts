import {
    assertBattleIntent,
    type BattleIntent,
    battleIntentSolanaMessage,
    battleIntentTypedData,
    chainFamily,
    type ChainId,
    hashBattleIntent,
    isExpired,
    normalizeAccount,
} from '@cryptopets/protocol';
import { ethers } from 'ethers';

import { prisma } from '@config/prisma';
import { verifySolanaSignature } from '@features/auth/solana';
import { getPetById } from '@repositories/roster.repository';

import { assertServedDomain } from './domain';
import { findSessionDelegation } from './session.service';

/**
 * Battle intent submission (§D).
 *
 * A JWT authorizes API access; it does not authorize a battle. It is a bearer token we
 * issued to ourselves, so a compromised API could mint one for any wallet and spend
 * someone else's pet's cooldown. The wallet signature is the authorization, and this
 * module's job is to refuse anything that is not one.
 *
 * What this deliberately does not do: create a ledger row. §J's `accepted` state means the
 * snapshot has been frozen and a drand round committed, which is the accept flow. Storing a
 * verified intent first keeps the nonce consumed (so a replay cannot get a second battle
 * even if acceptance fails) without inventing a ledger state that has no snapshot.
 */

/** Wire shape of an intent, as a client sends it. */
export interface BattleIntentWire {
    chainId: string;
    deploymentId: string;
    attackerOwner: string;
    attackerPetId: string;
    defenderOwner: string;
    defenderPetId: string;
    challengeId: string | null;
    clientNonce: string;
    rulesetHash: string;
    expiresAt: number;
}

export type SignatureFormat = 'eip712' | 'solana-message';

export interface SubmitIntentRequest {
    intent: BattleIntentWire;
    signature: string;
    signatureFormat: SignatureFormat;
    /**
     * The delegated key that signed, when one did (§D).
     *
     * Absent means the wallet signed directly, which is the original path and stays
     * supported: a client with no session, or one whose session lapsed, simply prompts.
     */
    sessionKey?: string;
    /** Wallet from the verified JWT. Must be the attacker. */
    authenticatedWallet: string;
    /** Unix seconds. Injected so expiry is testable and never read from a global clock. */
    nowSeconds: number;
}

/** Why an intent was refused. Distinct values because they mean different things to a client. */
export type IntentRejection =
    | 'malformed-intent'
    | 'wrong-deployment'
    /**
     * The intent's own `expiresAt` has passed. Named for the intent rather than a bare
     * `expired` because the accept path returns a `CoverageFailure` also spelled `expired`,
     * meaning the *defender's authorization* lapsed. One wire code cannot carry both: the
     * client maps a code to player-facing text with no idea which endpoint produced it, and
     * told players their request had timed out when the opponent's consent was the thing
     * that had run out.
     */
    | 'intent-expired'
    | 'wallet-mismatch'
    | 'wrong-signature-format'
    | 'bad-signature'
    /** A real signature from a key this wallet has not delegated to, or no longer has. */
    | 'session-not-authorized'
    | 'unknown-pet'
    | 'not-pet-owner'
    | 'self-battle'
    | 'same-owner'
    | 'nonce-already-used'
    | 'duplicate-intent';

export type SubmitIntentResult =
    | { ok: true; intentHash: string }
    | { ok: false; reason: IntentRejection; detail: string };

/**
 * Validates, verifies, and records a signed intent.
 *
 * Order matters: cheap structural checks first, then the signature, then the database. The
 * ownership read is last of the checks because it is the only one that touches Postgres, and
 * an attacker spraying malformed intents should not get free queries out of it.
 */
export async function submitBattleIntent(request: SubmitIntentRequest): Promise<SubmitIntentResult> {
    let intent: BattleIntent;
    try {
        intent = assertBattleIntent(toProtocolIntent(request.intent));
    } catch (error) {
        return reject('malformed-intent', (error as Error).message);
    }

    try {
        assertServedDomain(intent.domain);
    } catch (error) {
        // A staging signature replayed against production lands here, which is the whole
        // reason both halves of the domain are inside the signed payload.
        return reject('wrong-deployment', (error as Error).message);
    }

    if (isExpired(intent, request.nowSeconds)) {
        return reject('intent-expired', `intent expired at ${intent.expiresAt}, now ${request.nowSeconds}`);
    }

    if (normalizeAccount(request.authenticatedWallet) !== intent.attackerOwner) {
        // §D: a JWT user never submits a battle for another wallet.
        return reject(
            'wallet-mismatch',
            `authenticated wallet ${request.authenticatedWallet} is not the attacker ${intent.attackerOwner}`,
        );
    }

    if (intent.attackerPetId === intent.defenderPetId) {
        return reject('self-battle', 'a pet cannot fight itself');
    }

    if (intent.attackerOwner === intent.defenderOwner) {
        // Comparing the declared owners is enough: both are normalized above, and the roster
        // reads below refuse any pet whose real owner differs from the one declared. Without
        // this, one wallet fights itself for XP and drops, which team battles would triple.
        return reject('same-owner', 'two pets of the same owner cannot fight each other');
    }

    const expectedFormat: SignatureFormat = chainFamily(intent.domain.chainId) === 'evm' ? 'eip712' : 'solana-message';
    if (request.signatureFormat !== expectedFormat) {
        return reject(
            'wrong-signature-format',
            `${intent.domain.chainId} intents are signed as ${expectedFormat}, got ${request.signatureFormat}`,
        );
    }

    // Signed by the wallet, or by a key the wallet delegated to (§D).
    //
    // The delegated branch is checked against `sessionKey` rather than by recovering and
    // seeing who turns up, because recovery is an EVM affordance: Solana verifies against a
    // named pubkey. Having the client say which key it used keeps one code path for both
    // families, and costs nothing, since a lie fails the signature check immediately.
    if (request.sessionKey) {
        const signer = normalizeAccount(request.sessionKey);
        if (!verifyIntentSignature(intent, request.signature, expectedFormat, signer)) {
            return reject('bad-signature', 'signature does not verify against the named session key');
        }
        const delegation = await findSessionDelegation(
            intent.domain.chainId,
            intent.attackerOwner,
            signer,
            request.nowSeconds,
        );
        if (!delegation.ok) {
            // Its own reason, because it is the one a player can act on: their session
            // lapsed or was revoked, and re-approving takes one prompt. Collapsing it into
            // `bad-signature` would send them looking at their wallet instead.
            return reject('session-not-authorized', `${signer} may not sign for ${intent.attackerOwner}: ${delegation.reason}`);
        }
    } else if (!verifyIntentSignature(intent, request.signature, expectedFormat)) {
        return reject('bad-signature', 'signature does not recover to the attacker owner');
    }

    const family = chainFamily(intent.domain.chainId);
    const attacker = await getPetById(family, intent.attackerPetId.toString());
    if (!attacker) {
        return reject('unknown-pet', `attacker pet ${intent.attackerPetId} is not in the roster`);
    }
    if (normalizeAccount(attacker.owner) !== intent.attackerOwner) {
        // Ownership comes from indexed chain state, not from the signature. A pet sold
        // between signing and submitting fails here (threat T10).
        return reject(
            'not-pet-owner',
            `pet ${intent.attackerPetId} belongs to ${attacker.owner}, not ${intent.attackerOwner}`,
        );
    }
    const defender = await getPetById(family, intent.defenderPetId.toString());
    if (!defender) {
        return reject('unknown-pet', `defender pet ${intent.defenderPetId} is not in the roster`);
    }
    if (normalizeAccount(defender.owner) !== intent.defenderOwner) {
        return reject(
            'not-pet-owner',
            `pet ${intent.defenderPetId} belongs to ${defender.owner}, not ${intent.defenderOwner}`,
        );
    }

    const intentHash = hashBattleIntent(intent);

    try {
        await prisma.battleIntent.create({
            data: {
                intentHash,
                chainId: intent.domain.chainId,
                deploymentId: intent.domain.deploymentId,
                attackerOwner: intent.attackerOwner,
                attackerPetId: intent.attackerPetId.toString(),
                defenderOwner: intent.defenderOwner,
                defenderPetId: intent.defenderPetId.toString(),
                challengeId: intent.challengeId,
                clientNonce: intent.clientNonce,
                rulesetHash: intent.rulesetHash,
                expiresAt: BigInt(intent.expiresAt),
                signature: request.signature,
                signatureFormat: request.signatureFormat,
            },
        });
    } catch (error) {
        const failure = classifyIntentWriteFailure(error, intentHash);
        return reject(failure.reason, failure.detail);
    }

    return { ok: true, intentHash };
}

/**
 * Verifies the wallet signature over the chain-specific payload.
 *
 * Note what is verified: the payload the wallet was shown, rebuilt from the intent, not a
 * digest supplied by the client. A client that sends a signature over different fields
 * fails here, because the message being checked is derived from the fields it claims.
 */
/**
 * Whether `signature` over `intent` was produced by `expectedSigner`.
 *
 * Defaults to the attacker owner, which is the wallet-signed path. A delegated session key
 * is passed explicitly, and the caller is responsible for having checked that the key is
 * actually allowed to act for that owner — this function only answers "who signed this",
 * never "may they".
 */
export function verifyIntentSignature(
    intent: BattleIntent,
    signature: string,
    format: SignatureFormat,
    expectedSigner: string = intent.attackerOwner,
): boolean {
    try {
        const signer = normalizeAccount(expectedSigner);
        if (format === 'eip712') {
            const typed = battleIntentTypedData(intent);
            // The protocol declares its type list `as const` so field order cannot drift;
            // ethers wants a mutable record. Structurally identical, so a cast rather than a
            // rebuilt copy that could silently reorder fields.
            const types = typed.types as unknown as Record<string, ethers.TypedDataField[]>;
            const recovered = ethers.verifyTypedData(typed.domain, types, typed.message, signature);
            return normalizeAccount(recovered) === signer;
        }
        return verifySolanaSignature(signer, signature, battleIntentSolanaMessage(intent));
    } catch {
        // A malformed signature is a refusal, not an exception for the route to handle.
        return false;
    }
}

/** Maps the wire shape onto the protocol type, leaving validation to the protocol. */
export function toProtocolIntent(wire: BattleIntentWire): BattleIntent {
    return {
        domain: { chainId: wire.chainId as ChainId, deploymentId: wire.deploymentId },
        attackerOwner: wire.attackerOwner,
        attackerPetId: BigInt(wire.attackerPetId),
        defenderOwner: wire.defenderOwner,
        defenderPetId: BigInt(wire.defenderPetId),
        challengeId: wire.challengeId,
        clientNonce: wire.clientNonce,
        rulesetHash: wire.rulesetHash as `0x${string}`,
        expiresAt: wire.expiresAt,
    };
}

/**
 * Turns a write failure into a reason.
 *
 * The two unique constraints mean different things. A repeated nonce is a replay attempt
 * (threat T7) and is worth alerting on; the same `intentHash` arriving twice is usually a
 * client retrying a request whose response it never saw. Neither is ever resolved by an
 * upsert: quietly merging would let a second, different payload inherit the first's
 * acceptance.
 */
export function classifyIntentWriteFailure(
    error: unknown,
    intentHash: string,
): { reason: 'nonce-already-used' | 'duplicate-intent'; detail: string } {
    const code = (error as { code?: string }).code;
    const target = String((error as { meta?: { target?: unknown } }).meta?.target ?? '');
    if (code === 'P2002') {
        if (target.includes('client_nonce') || target.includes('battle_intent_nonce')) {
            return { reason: 'nonce-already-used', detail: 'this client nonce has already been used' };
        }
        return { reason: 'duplicate-intent', detail: `intent ${intentHash} has already been submitted` };
    }
    throw error;
}

function reject(reason: IntentRejection, detail: string): SubmitIntentResult {
    return { ok: false, reason, detail };
}
