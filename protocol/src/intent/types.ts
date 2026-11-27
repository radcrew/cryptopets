import { assertProtocolDomain, type ProtocolDomain } from '../domain/deployment';
import { type Hex, hexToBytes, normalizeAccount } from '../encoding/bytes';

/**
 * A wallet-signed, expiring request to fight. Permission, not a result.
 *
 * A JWT is fine for API access but is the wrong thing to authorize a battle: it
 * is a bearer token we issued to ourselves, so a compromised API could mint one
 * for any wallet. This object is signed by the attacker's own key, which means
 * an operator cannot fabricate consent to spend someone else's pet's cooldown.
 *
 * See architecture §D. The signing payloads live in `./signing`; nothing here
 * verifies a signature (that is the backend's job, with a chain-specific
 * verifier).
 */
export interface BattleIntent {
    /** Which chain and deployment this intent is valid on. */
    domain: ProtocolDomain;
    /** Wallet that owns the attacking pet and signs this intent. */
    attackerOwner: string;
    /** On-chain pet id. */
    attackerPetId: bigint;
    /** Wallet that owns the defending pet. */
    defenderOwner: string;
    defenderPetId: bigint;
    /** Matchmaking challenge this answers, or null for a direct challenge. */
    challengeId: string | null;
    /** Wallet-chosen idempotency nonce. Consumed once, then never again. */
    clientNonce: string;
    /** Ruleset the signer is agreeing to fight under. */
    rulesetHash: Hex;
    /** Unix seconds after which the intent is dead. */
    expiresAt: number;
}

/**
 * Opaque ids may only contain these characters.
 *
 * The restriction is not cosmetic. The Solana signing payload is a text message
 * with one labelled field per line, so a value containing a newline could forge
 * additional lines and change what the wallet owner believes they signed. Every
 * free-text field in this object is therefore constrained to characters that
 * cannot break that framing.
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** Validates an untrusted intent, returning a normalized copy. */
export function assertBattleIntent(intent: BattleIntent): BattleIntent {
    const domain = assertProtocolDomain(intent.domain);

    const attackerOwner = assertAccount(intent.attackerOwner, 'attackerOwner');
    const defenderOwner = assertAccount(intent.defenderOwner, 'defenderOwner');
    const attackerPetId = assertPetId(intent.attackerPetId, 'attackerPetId');
    const defenderPetId = assertPetId(intent.defenderPetId, 'defenderPetId');

    if (intent.challengeId !== null) {
        assertId(intent.challengeId, 'challengeId', 1, 64);
    }
    assertId(intent.clientNonce, 'clientNonce', 8, 128);

    if (hexToBytes(intent.rulesetHash).length !== 32) {
        throw new Error('rulesetHash must be a 32-byte hash');
    }

    if (!Number.isSafeInteger(intent.expiresAt) || intent.expiresAt <= 0) {
        throw new Error(`expiresAt must be a positive unix-seconds integer, got ${intent.expiresAt}`);
    }

    return {
        domain,
        attackerOwner,
        attackerPetId,
        defenderOwner,
        defenderPetId,
        challengeId: intent.challengeId,
        clientNonce: intent.clientNonce,
        rulesetHash: intent.rulesetHash,
        expiresAt: intent.expiresAt,
    };
}

/** True when `intent` has expired at `nowSeconds`. The clock is always an argument here. */
export function isExpired(intent: BattleIntent, nowSeconds: number): boolean {
    return nowSeconds >= intent.expiresAt;
}

/** Validates and normalizes an account. Shared with the team intent. */
export function assertAccount(value: string, field: string): string {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
        throw new Error(`${field} is not a valid account: ${JSON.stringify(value)}`);
    }
    return normalizeAccount(value);
}

/** Validates a pet id. Shared with the team intent. */
export function assertPetId(value: bigint, field: string): bigint {
    if (typeof value !== 'bigint' || value <= 0n) {
        throw new Error(`${field} must be a positive pet id, got ${value}`);
    }
    if (value >= 1n << 256n) {
        throw new Error(`${field} does not fit in 256 bits`);
    }
    return value;
}

/** Validates an opaque id against the signing-safe charset. Shared with the team intent. */
export function assertId(value: string, field: string, min: number, max: number): void {
    if (typeof value !== 'string' || value.length < min || value.length > max) {
        throw new Error(`${field} must be ${min}-${max} characters, got ${JSON.stringify(value)}`);
    }
    if (!SAFE_ID_PATTERN.test(value)) {
        throw new Error(`${field} contains characters that are not allowed: ${JSON.stringify(value)}`);
    }
}
