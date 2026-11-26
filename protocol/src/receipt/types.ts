import { assertProtocolDomain, assertSameDomain, type ProtocolDomain } from '../domain/deployment';
import { type Hex, hexToBytes, toBytes } from '../encoding/bytes';
import type { ProgressionDelta } from '../progression/progression';
import { beaconRandomness, BEACON_SIGNATURE_LENGTH, resolveDrandChain, roundTime } from '../randomness/drand';
import { deriveBattleSeed, DRAND_RANDOMNESS_LENGTH } from '../randomness/seed';
import { hashBattleSnapshot } from '../snapshot/hash';
import { assertBattleSnapshot, type BattleSnapshot } from '../snapshot/types';

/**
 * The signed, permanent record of one battle.
 *
 * Everything needed to recompute the fight is here or reachable from here, which is
 * the whole point: we are not asking anyone to believe the result, we are publishing
 * the homework so anyone can mark it (§G, §H). A receipt that cannot be independently
 * recomputed is an assertion, and assertions are what this design exists to avoid.
 *
 * Three hash links, not one:
 *
 * - `previousReceiptHash` chains every receipt under a signing key, so removal or
 *   reordering breaks the chain and two receipts claiming one predecessor is provable
 *   equivocation.
 * - the two per-pet links exist because off-chain XP is not verifiable against the
 *   chain. Confirming a pet really was level 12 means replaying that pet's prior
 *   backend battles, and without a per-pet link that means scanning the entire ledger.
 *
 * `rewardDelta` from §G is deliberately absent: Phase 3 receipts carry no transferable
 * reward, and inventing the shape now would freeze a layout before the reward model
 * exists. Adding it is a `receipt` schema-version bump, which is what the version
 * registry is for.
 */
export interface BattleReceipt {
    domain: ProtocolDomain;
    battleId: string;
    /** The wallet-signed intent that authorized the battle. */
    intentHash: Hex;
    /** The pre-reveal commitment this battle was accepted under. */
    commitmentHash: Hex;
    /** The defender's standing authorization it relied on. */
    defenseAuthorizationHash: Hex;
    /** Both pets, frozen at acceptance. Carries each pet's source chain version. */
    snapshot: BattleSnapshot;
    /** The beacon proof: which round, its signature, and the randomness it yields. */
    beacon: ReceiptBeacon;
    /** The seed the fight ran on. Must follow from this receipt's own inputs. */
    seed: Hex;
    rulesetVersion: number;
    rulesetHash: Hex;
    result: BattleResult;
    /** Hash of the blow-by-blow log, which is served separately. */
    combatLogHash: Hex;
    progression: ProgressionDelta;
    /** Position in this signing key's chain. Starts at 1. */
    sequence: number;
    /** Previous receipt under this key, or null for the first. */
    previousReceiptHash: Hex | null;
    /** Previous receipt involving the attacker pet, or null for its first. */
    attackerPreviousReceiptHash: Hex | null;
    /** Previous receipt involving the defender pet, or null for its first. */
    defenderPreviousReceiptHash: Hex | null;
    createdAt: number;
    signingKeyId: string;
    /**
     * Absent or 1: a duel's receipt, the only layout before team battles. A team battle's
     * receipt is version 2 and a different type (`TeamBattleReceipt`).
     */
    schemaVersion?: 1;
}

/** The beacon proof carried by a receipt, so the randomness is checkable, not asserted. */
export interface ReceiptBeacon {
    chainHash: Hex;
    round: number;
    /** 48-byte compressed G1 signature. */
    signature: Hex;
    /** 32-byte randomness: sha256 of the signature. */
    randomness: Hex;
}

/** The outcome, stated from the attacker's perspective, as `simulate` reports it. */
export interface BattleResult {
    attackerWon: boolean;
    rounds: number;
    winnerHpRemaining: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Validates an untrusted receipt, returning a normalized copy.
 *
 * Beyond field shapes, this enforces the internal consistency a receipt can be held to
 * without any external data:
 *
 * - the randomness is the hash of the signature it ships with;
 * - the seed follows from this receipt's own domain, beacon, battle id, snapshot, and
 *   ruleset;
 * - the beacon had published before the receipt was created;
 * - the snapshot was taken before the receipt was created;
 * - a null chain link happens only at sequence 1.
 *
 * Deliberately *not* done here: BLS verification and progression recomputation. Both
 * are real checks (`verifyReceiptConsistency`) but too expensive to run every time a
 * receipt is hashed.
 */
export function assertBattleReceipt(receipt: BattleReceipt): BattleReceipt {
    const version: number = receipt.schemaVersion ?? 1;
    if (version !== 1) {
        throw new Error(`receipt schema version ${version} is not a duel receipt`);
    }
    const domain = assertProtocolDomain(receipt.domain);
    assertId(receipt.battleId, 'battleId');
    assertId(receipt.signingKeyId, 'signingKeyId');
    assertHash(receipt.intentHash, 'intentHash');
    assertHash(receipt.commitmentHash, 'commitmentHash');
    assertHash(receipt.defenseAuthorizationHash, 'defenseAuthorizationHash');
    assertHash(receipt.rulesetHash, 'rulesetHash');
    assertHash(receipt.combatLogHash, 'combatLogHash');
    assertHash(receipt.seed, 'seed');
    assertOptionalHash(receipt.previousReceiptHash, 'previousReceiptHash');
    assertOptionalHash(receipt.attackerPreviousReceiptHash, 'attackerPreviousReceiptHash');
    assertOptionalHash(receipt.defenderPreviousReceiptHash, 'defenderPreviousReceiptHash');

    const snapshot = assertBattleSnapshot(receipt.snapshot);
    // A receipt whose snapshot names another deployment is incoherent, and it would also
    // make the seed check ambiguous: the derivation binds one domain, and there would be
    // two candidates for which.
    assertSameDomain(domain, snapshot.domain);
    const beacon = assertReceiptBeacon(receipt.beacon);

    if (!Number.isSafeInteger(receipt.rulesetVersion) || receipt.rulesetVersion < 1) {
        throw new Error(`rulesetVersion must be a positive integer, got ${receipt.rulesetVersion}`);
    }
    assertResult(receipt.result);

    if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1) {
        throw new Error(`sequence must be a positive integer, got ${receipt.sequence}`);
    }
    // A null link anywhere but the start of a key's chain would be an undetectable gap:
    // the chain would simply restart, and nothing would say a receipt went missing.
    if (receipt.sequence === 1 && receipt.previousReceiptHash !== null) {
        throw new Error('the first receipt under a signing key must have no previousReceiptHash');
    }
    if (receipt.sequence > 1 && receipt.previousReceiptHash === null) {
        throw new Error(`receipt at sequence ${receipt.sequence} must link its predecessor`);
    }

    if (!Number.isSafeInteger(receipt.createdAt) || receipt.createdAt < 1) {
        throw new Error(`createdAt must be a positive unix-seconds integer, got ${receipt.createdAt}`);
    }
    if (receipt.createdAt < snapshot.takenAt) {
        throw new Error(`createdAt ${receipt.createdAt} precedes the snapshot at ${snapshot.takenAt}`);
    }
    const chain = resolveDrandChain(beacon.chainHash);
    const publishedAt = roundTime(chain, beacon.round);
    if (receipt.createdAt < publishedAt) {
        throw new Error(
            `createdAt ${receipt.createdAt} precedes drand round ${beacon.round}, which publishes at ${publishedAt}`,
        );
    }

    const expectedSeed = deriveBattleSeed({
        domain,
        drandRandomness: beacon.randomness,
        battleId: receipt.battleId,
        snapshotHash: hashBattleSnapshot(snapshot),
        rulesetHash: receipt.rulesetHash,
    }).hex;
    if (receipt.seed.toLowerCase() !== expectedSeed) {
        throw new Error(`seed ${receipt.seed} does not follow from this receipt inputs (expected ${expectedSeed})`);
    }

    return {
        domain,
        battleId: receipt.battleId,
        intentHash: receipt.intentHash,
        commitmentHash: receipt.commitmentHash,
        defenseAuthorizationHash: receipt.defenseAuthorizationHash,
        snapshot,
        beacon,
        seed: receipt.seed,
        rulesetVersion: receipt.rulesetVersion,
        rulesetHash: receipt.rulesetHash,
        result: { ...receipt.result },
        combatLogHash: receipt.combatLogHash,
        progression: receipt.progression,
        sequence: receipt.sequence,
        previousReceiptHash: receipt.previousReceiptHash,
        attackerPreviousReceiptHash: receipt.attackerPreviousReceiptHash,
        defenderPreviousReceiptHash: receipt.defenderPreviousReceiptHash,
        createdAt: receipt.createdAt,
        signingKeyId: receipt.signingKeyId,
    };
}

/** Shared with the team receipt. */
export function assertReceiptBeacon(beacon: ReceiptBeacon): ReceiptBeacon {
    const chain = resolveDrandChain(beacon.chainHash);
    if (!Number.isSafeInteger(beacon.round) || beacon.round < 1) {
        throw new Error(`beacon round must be a positive integer, got ${beacon.round}`);
    }
    if (toBytes(beacon.signature).length !== BEACON_SIGNATURE_LENGTH) {
        throw new Error(`beacon signature must be ${BEACON_SIGNATURE_LENGTH} bytes`);
    }
    if (toBytes(beacon.randomness).length !== DRAND_RANDOMNESS_LENGTH) {
        throw new Error(`beacon randomness must be ${DRAND_RANDOMNESS_LENGTH} bytes`);
    }
    // Cheap and worth doing every time: randomness is defined as the hash of the
    // signature, so a receipt where they disagree is malformed regardless of whether
    // the signature itself verifies.
    const derived = beaconRandomness(beacon.signature);
    if (derived !== beacon.randomness.toLowerCase()) {
        throw new Error(`beacon randomness ${beacon.randomness} is not the hash of the signature (${derived})`);
    }
    return {
        chainHash: chain.chainHash,
        round: beacon.round,
        signature: beacon.signature.toLowerCase() as Hex,
        randomness: beacon.randomness.toLowerCase() as Hex,
    };
}

/** Shared with the team receipt. */
export function assertResult(result: BattleResult): void {
    if (typeof result?.attackerWon !== 'boolean') {
        throw new Error('result.attackerWon must be a boolean');
    }
    if (!Number.isSafeInteger(result.rounds) || result.rounds < 1 || result.rounds > 0xffff) {
        throw new Error(`result.rounds must be 1-65535, got ${result.rounds}`);
    }
    if (
        !Number.isSafeInteger(result.winnerHpRemaining) ||
        result.winnerHpRemaining < 0 ||
        result.winnerHpRemaining > 0xffff
    ) {
        throw new Error(`result.winnerHpRemaining must be 0-65535, got ${result.winnerHpRemaining}`);
    }
}

/** Shared with the team receipt. */
export function assertId(value: string, field: string): void {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
        throw new Error(`${field} is not a valid id: ${JSON.stringify(value)}`);
    }
}

/** Shared with the team receipt. */
export function assertHash(value: Hex, field: string): void {
    if (hexToBytes(value).length !== 32) {
        throw new Error(`${field} must be a 32-byte hash`);
    }
}

/** Shared with the team receipt. */
export function assertOptionalHash(value: Hex | null, field: string): void {
    if (value !== null) {
        assertHash(value, field);
    }
}
