import {
    assertTeamBattleIntent,
    chainFamily,
    type ChainId,
    hashTeamBattleIntent,
    normalizeAccount,
    type Tactic,
    type TeamBattleIntent,
    teamBattleIntentTypedData,
} from '@cryptopets/protocol';
import { ethers } from 'ethers';

import { prisma } from '@config/prisma';
import { getPetById } from '@repositories/roster.repository';

import { assertServedDomain } from './domain';
import { classifyIntentWriteFailure, type IntentRejection, type SignatureFormat } from './intent.service';
import { BATTLE_KIND } from './kind';
import { findSessionDelegation } from './session.service';

/**
 * Team intent submission (§D, for team battles; docs/plan-team-battles-3v3.md).
 *
 * The duel intent's job and the duel intent's checks, in the same order: the wallet signature
 * (or a key the wallet delegated) is the authorization, and nothing here creates a ledger row.
 * What changes is the subject. The attacker signs three placed pets rather than one, and names
 * the defender's plan by hash rather than a defending pet, since the plan's three pets are the
 * defenders.
 *
 * Shares `battle_intent` with duels, so a wallet has one nonce space across both kinds: a nonce
 * spent on a duel cannot be replayed as a team challenge or the reverse.
 */

/** Wire shape of a team intent, as a client sends it. */
export interface TeamBattleIntentWire {
    chainId: string;
    deploymentId: string;
    attackerOwner: string;
    attackers: { petId: string; col: number; row: number; tactic: Tactic }[];
    defenderOwner: string;
    defensePlanHash: string;
    challengeId: string | null;
    clientNonce: string;
    rulesetHash: string;
    expiresAt: number;
}

export interface SubmitTeamIntentRequest {
    intent: TeamBattleIntentWire;
    signature: string;
    signatureFormat: SignatureFormat;
    /** The delegated key that signed, when one did (§D). Absent means the wallet signed. */
    sessionKey?: string;
    authenticatedWallet: string;
    nowSeconds: number;
}

/** The duel's reasons, less the pet-fighting-itself one, plus the two a plan adds. */
export type TeamIntentRejection =
    | Exclude<IntentRejection, 'self-battle'>
    /** The named plan does not exist, or is not the defender's. */
    | 'unknown-plan'
    /** The defender withdrew the named plan. */
    | 'plan-revoked';

export type SubmitTeamIntentResult = { ok: true; intentHash: string } | { ok: false; reason: TeamIntentRejection; detail: string };

/** Validates, verifies, and records a signed team intent. */
export async function submitTeamBattleIntent(request: SubmitTeamIntentRequest): Promise<SubmitTeamIntentResult> {
    let intent: TeamBattleIntent;
    try {
        intent = assertTeamBattleIntent(toProtocolTeamIntent(request.intent));
    } catch (error) {
        return reject('malformed-intent', (error as Error).message);
    }

    try {
        assertServedDomain(intent.domain);
    } catch (error) {
        return reject('wrong-deployment', (error as Error).message);
    }
    if (request.nowSeconds >= intent.expiresAt) {
        return reject('intent-expired', `intent expired at ${intent.expiresAt}, now ${request.nowSeconds}`);
    }
    if (normalizeAccount(request.authenticatedWallet) !== intent.attackerOwner) {
        return reject('wallet-mismatch', `authenticated wallet ${request.authenticatedWallet} is not the attacker ${intent.attackerOwner}`);
    }
    if (intent.attackerOwner === intent.defenderOwner) {
        // D7, as for duels: one wallet must not fight itself for XP and drops, and a team
        // battle pays six fighters.
        return reject('same-owner', 'a wallet cannot challenge its own defence plan');
    }

    // EIP-712 only: Base ships first (D6), and the protocol has no Solana team intent message.
    if (chainFamily(intent.domain.chainId) !== 'evm' || request.signatureFormat !== 'eip712') {
        return reject('wrong-signature-format', `team intents are EIP-712 signed on EVM chains; got ${request.signatureFormat} on ${intent.domain.chainId}`);
    }
    if (request.sessionKey) {
        const signer = normalizeAccount(request.sessionKey);
        if (!verifyTeamIntentSignature(intent, request.signature, signer)) {
            return reject('bad-signature', 'signature does not verify against the named session key');
        }
        const delegation = await findSessionDelegation(intent.domain.chainId, intent.attackerOwner, signer, request.nowSeconds);
        if (!delegation.ok) {
            return reject('session-not-authorized', `${signer} may not sign for ${intent.attackerOwner}: ${delegation.reason}`);
        }
    } else if (!verifyTeamIntentSignature(intent, request.signature)) {
        return reject('bad-signature', 'signature does not recover to the attacker owner');
    }

    // Ownership from indexed chain state, as for a duel (threat T10).
    const family = chainFamily(intent.domain.chainId);
    const pets = await Promise.all(intent.attackers.map((a) => getPetById(family, a.petId.toString())));
    for (const [i, pet] of pets.entries()) {
        const petId = intent.attackers[i]?.petId;
        if (!pet) return reject('unknown-pet', `attacking pet ${petId} is not in the roster`);
        if (normalizeAccount(pet.owner) !== intent.attackerOwner) {
            return reject('not-pet-owner', `pet ${petId} belongs to ${pet.owner}, not ${intent.attackerOwner}`);
        }
    }

    // The plan must be the defender's and still standing. Whether it covers this squad
    // (ruleset, level band, window, daily cap) is acceptance's question, as consent is for duels.
    const plan = await prisma.defensePlan.findUnique({
        where: { planHash: intent.defensePlanHash },
        select: { chainId: true, deploymentId: true, defenderOwner: true, revokedAt: true },
    });
    if (
        !plan ||
        plan.chainId !== intent.domain.chainId ||
        plan.deploymentId !== intent.domain.deploymentId ||
        plan.defenderOwner !== intent.defenderOwner
    ) {
        return reject('unknown-plan', `no defence plan ${intent.defensePlanHash} for ${intent.defenderOwner}`);
    }
    if (plan.revokedAt) {
        return reject('plan-revoked', `defence plan ${intent.defensePlanHash} was withdrawn`);
    }

    const intentHash = hashTeamBattleIntent(intent);
    try {
        await prisma.battleIntent.create({
            data: {
                intentHash,
                kind: BATTLE_KIND.team,
                chainId: intent.domain.chainId,
                deploymentId: intent.domain.deploymentId,
                attackerOwner: intent.attackerOwner,
                defenderOwner: intent.defenderOwner,
                attackers: intent.attackers.map((a) => ({ petId: a.petId.toString(), col: a.col, row: a.row, tactic: a.tactic })),
                defensePlanHash: intent.defensePlanHash,
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

/** Whether `signature` over the team intent's EIP-712 payload came from `expectedSigner`. */
export function verifyTeamIntentSignature(intent: TeamBattleIntent, signature: string, expectedSigner: string = intent.attackerOwner): boolean {
    try {
        const typed = teamBattleIntentTypedData(intent);
        const types = typed.types as unknown as Record<string, ethers.TypedDataField[]>;
        const recovered = ethers.verifyTypedData(typed.domain, types, typed.message, signature);
        return normalizeAccount(recovered) === normalizeAccount(expectedSigner);
    } catch {
        return false;
    }
}

/** Maps the wire shape onto the protocol type, leaving validation to the protocol. */
export function toProtocolTeamIntent(wire: TeamBattleIntentWire): TeamBattleIntent {
    return {
        domain: { chainId: wire.chainId as ChainId, deploymentId: wire.deploymentId },
        attackerOwner: wire.attackerOwner,
        attackers: (wire.attackers ?? []).map((a) => ({ petId: BigInt(a.petId), col: a.col, row: a.row, tactic: a.tactic })),
        defenderOwner: wire.defenderOwner,
        defensePlanHash: wire.defensePlanHash as `0x${string}`,
        challengeId: wire.challengeId,
        clientNonce: wire.clientNonce,
        rulesetHash: wire.rulesetHash as `0x${string}`,
        expiresAt: wire.expiresAt,
    };
}

function reject(reason: TeamIntentRejection, detail: string): SubmitTeamIntentResult {
    return { ok: false, reason, detail };
}
