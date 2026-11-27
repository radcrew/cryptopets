import { assertProtocolDomain, assertSameDomain, type ProtocolDomain, writeHeader } from '../domain/deployment';
import { TEAM_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import type { Hex } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';
import type { PetProgression } from '../progression/progression';
import { resolveDrandChain, roundTime } from '../randomness/drand';
import { deriveBattleSeed } from '../randomness/seed';
import { assertTeamBattleSnapshot, hashTeamBattleSnapshot, type TeamBattleSnapshot } from '../snapshot/team';

import { hashBattleReceipt, writePetProgression } from './hash';
import {
    assertBattleReceipt,
    assertHash,
    assertId,
    assertOptionalHash,
    assertReceiptBeacon,
    assertResult,
    type BattleReceipt,
    type BattleResult,
    type ReceiptBeacon,
} from './types';
import {
    petProgressionFromWire,
    petSnapshotFromWire,
    receiptFromWire,
    type WireBattleReceipt,
    type WirePetProgression,
    type WirePetSnapshot,
} from './wire';

/**
 * The signed, permanent record of one team battle: receipt schema version 2.
 *
 * Everything a duel receipt promises (§G), for six fighters. The differences are the ones a
 * team battle forces:
 *
 * - `defensePlanHash` names the defender's consent, where a duel names a defence
 *   authorization.
 * - `progression` and `fighterPreviousReceiptHashes` cover all six fighters, in fight order:
 *   attackers by slot, then defenders by slot.
 */
export interface TeamBattleReceipt {
    schemaVersion: 2;
    domain: ProtocolDomain;
    battleId: string;
    intentHash: Hex;
    commitmentHash: Hex;
    defensePlanHash: Hex;
    snapshot: TeamBattleSnapshot;
    beacon: ReceiptBeacon;
    seed: Hex;
    rulesetVersion: number;
    rulesetHash: Hex;
    result: BattleResult;
    combatLogHash: Hex;
    /** The six fighters, attackers then defenders, each by slot. */
    progression: PetProgression[];
    sequence: number;
    previousReceiptHash: Hex | null;
    /** Each fighter's previous receipt, in the same order as `progression`. */
    fighterPreviousReceiptHashes: (Hex | null)[];
    createdAt: number;
    signingKeyId: string;
}

/** A receipt of either kind. A signing key's chain, and a pet's, can hold both. */
export type AnyBattleReceipt = BattleReceipt | TeamBattleReceipt;

export function isTeamBattleReceipt(receipt: AnyBattleReceipt): receipt is TeamBattleReceipt {
    return receipt.schemaVersion === TEAM_SCHEMA_VERSIONS.receipt;
}

/** The six fighters' pet ids, in the order `progression` and the links use. */
export function teamFighterIds(receipt: TeamBattleReceipt): bigint[] {
    return [...receipt.snapshot.attackers, ...receipt.snapshot.roster].map((m) => m.pet.petId);
}

/**
 * Validates an untrusted team receipt, returning a normalized copy.
 *
 * The duel receipt's internal-consistency checks (`assertBattleReceipt`), plus the one a team
 * battle adds: the progression and per-fighter links list exactly the six fighters, in order.
 */
export function assertTeamBattleReceipt(receipt: TeamBattleReceipt): TeamBattleReceipt {
    if (receipt.schemaVersion !== TEAM_SCHEMA_VERSIONS.receipt) {
        throw new Error(`a team receipt is schema version ${TEAM_SCHEMA_VERSIONS.receipt}, got ${String(receipt.schemaVersion)}`);
    }
    const domain = assertProtocolDomain(receipt.domain);
    assertId(receipt.battleId, 'battleId');
    assertId(receipt.signingKeyId, 'signingKeyId');
    assertHash(receipt.intentHash, 'intentHash');
    assertHash(receipt.commitmentHash, 'commitmentHash');
    assertHash(receipt.defensePlanHash, 'defensePlanHash');
    assertHash(receipt.rulesetHash, 'rulesetHash');
    assertHash(receipt.combatLogHash, 'combatLogHash');
    assertHash(receipt.seed, 'seed');
    assertOptionalHash(receipt.previousReceiptHash, 'previousReceiptHash');

    const snapshot = assertTeamBattleSnapshot(receipt.snapshot);
    assertSameDomain(domain, snapshot.domain);
    const beacon = assertReceiptBeacon(receipt.beacon);
    if (!Number.isSafeInteger(receipt.rulesetVersion) || receipt.rulesetVersion < 1) {
        throw new Error(`rulesetVersion must be a positive integer, got ${receipt.rulesetVersion}`);
    }
    assertResult(receipt.result);

    if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1) {
        throw new Error(`sequence must be a positive integer, got ${receipt.sequence}`);
    }
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
    const publishedAt = roundTime(resolveDrandChain(beacon.chainHash), beacon.round);
    if (receipt.createdAt < publishedAt) {
        throw new Error(`createdAt ${receipt.createdAt} precedes drand round ${beacon.round}, which publishes at ${publishedAt}`);
    }

    const expectedSeed = deriveBattleSeed({
        domain,
        drandRandomness: beacon.randomness,
        battleId: receipt.battleId,
        snapshotHash: hashTeamBattleSnapshot(snapshot),
        rulesetHash: receipt.rulesetHash,
    }).hex;
    if (receipt.seed.toLowerCase() !== expectedSeed) {
        throw new Error(`seed ${receipt.seed} does not follow from this receipt inputs (expected ${expectedSeed})`);
    }

    const normalized: TeamBattleReceipt = {
        schemaVersion: TEAM_SCHEMA_VERSIONS.receipt,
        domain,
        battleId: receipt.battleId,
        intentHash: receipt.intentHash,
        commitmentHash: receipt.commitmentHash,
        defensePlanHash: receipt.defensePlanHash,
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
        fighterPreviousReceiptHashes: receipt.fighterPreviousReceiptHashes,
        createdAt: receipt.createdAt,
        signingKeyId: receipt.signingKeyId,
    };

    const fighters = teamFighterIds(normalized);
    if (!Array.isArray(receipt.progression) || receipt.progression.length !== fighters.length) {
        throw new Error(`progression must list the ${fighters.length} fighters`);
    }
    receipt.progression.forEach((p, i) => {
        if (p.petId !== fighters[i]) throw new Error(`progression[${i}] is pet ${p.petId}, expected ${fighters[i]}`);
    });
    if (!Array.isArray(receipt.fighterPreviousReceiptHashes) || receipt.fighterPreviousReceiptHashes.length !== fighters.length) {
        throw new Error(`fighterPreviousReceiptHashes must list the ${fighters.length} fighters`);
    }
    receipt.fighterPreviousReceiptHashes.forEach((link, i) => assertOptionalHash(link, `fighterPreviousReceiptHashes[${i}]`));
    return normalized;
}

/**
 * Canonical encoding: header at version 2, then the duel receipt's fields in the duel
 * receipt's order, with the team's additions where their duel counterparts sit. The plan
 * hash takes the authorization hash's place, and the six fighters' links follow the global
 * one.
 */
export function encodeTeamBattleReceipt(receipt: TeamBattleReceipt): Uint8Array {
    const checked = assertTeamBattleReceipt(receipt);
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.RECEIPT);
    writeHeader(writer, 'receipt', checked.domain, TEAM_SCHEMA_VERSIONS.receipt)
        .text(checked.battleId)
        .hash(checked.intentHash)
        .hash(checked.commitmentHash)
        .hash(checked.defensePlanHash)
        .hash(hashTeamBattleSnapshot(checked.snapshot))
        .hash(checked.beacon.chainHash)
        .u64(checked.beacon.round)
        .bytes(checked.beacon.signature)
        .bytes(checked.beacon.randomness)
        .hash(checked.seed)
        .u32(checked.rulesetVersion)
        .hash(checked.rulesetHash)
        .bool(checked.result.attackerWon)
        .u16(checked.result.rounds)
        .u16(checked.result.winnerHpRemaining)
        .hash(checked.combatLogHash)
        .array(checked.progression, (w, p) => writePetProgression(w, p));
    return writer
        .u64(checked.sequence)
        .optional(checked.previousReceiptHash, (w, v) => w.hash(v))
        .array(checked.fighterPreviousReceiptHashes, (w, link) => w.optional(link, (x, v) => x.hash(v)))
        .u64(checked.createdAt)
        .text(checked.signingKeyId)
        .build();
}

/** A team battle's `receiptHash`: signed, linked to, and committed to by a Merkle leaf. */
export function hashTeamBattleReceipt(receipt: TeamBattleReceipt): Hex {
    return keccak256Hex(encodeTeamBattleReceipt(receipt));
}

/** The hash of a receipt of either kind. */
export function hashAnyBattleReceipt(receipt: AnyBattleReceipt): Hex {
    return isTeamBattleReceipt(receipt) ? hashTeamBattleReceipt(receipt) : hashBattleReceipt(receipt);
}

/** Validates a receipt of either kind. */
export function assertAnyBattleReceipt(receipt: AnyBattleReceipt): AnyBattleReceipt {
    return isTeamBattleReceipt(receipt) ? assertTeamBattleReceipt(receipt) : assertBattleReceipt(receipt);
}

/** JSON wire form: the bigint fields of every pet and progression entry as decimal strings. */
export type WireTeamBattleReceipt = Omit<TeamBattleReceipt, 'snapshot' | 'progression'> & {
    snapshot: Omit<TeamBattleSnapshot, 'attackers' | 'roster'> & {
        attackers: (Omit<TeamBattleSnapshot['attackers'][number], 'pet'> & { pet: WirePetSnapshot })[];
        roster: (Omit<TeamBattleSnapshot['roster'][number], 'pet'> & { pet: WirePetSnapshot })[];
    };
    progression: WirePetProgression[];
};

/** Converts a JSON-wire receipt of either kind. A team receipt declares schema version 2. */
export function anyReceiptFromWire(wire: WireBattleReceipt | WireTeamBattleReceipt): AnyBattleReceipt {
    return wire.schemaVersion === TEAM_SCHEMA_VERSIONS.receipt
        ? teamReceiptFromWire(wire as WireTeamBattleReceipt)
        : receiptFromWire(wire as WireBattleReceipt);
}

/** Converts a JSON-wire team receipt into a typed one. Converts only; validation is
 *  `assertTeamBattleReceipt`'s job, as with `receiptFromWire`. */
export function teamReceiptFromWire(wire: WireTeamBattleReceipt): TeamBattleReceipt {
    return {
        ...wire,
        snapshot: {
            ...wire.snapshot,
            attackers: wire.snapshot.attackers.map((m) => ({ ...m, pet: petSnapshotFromWire(m.pet) })),
            roster: wire.snapshot.roster.map((m) => ({ ...m, pet: petSnapshotFromWire(m.pet) })),
        },
        progression: wire.progression.map(petProgressionFromWire),
    };
}
