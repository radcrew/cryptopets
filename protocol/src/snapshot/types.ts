import { assertProtocolDomain, type ProtocolDomain } from '../domain/deployment';
import { assertSupportedSchemaVersion, DUEL_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import { normalizeAccount } from '../encoding/bytes';

/**
 * One equipped item, frozen with the pet (roadmap §4, snapshot schema v2).
 *
 * Carries the **resolved** modifier rather than a reference to a catalog row, which is
 * the whole point: unequipping after acceptance must not change a committed fight, for
 * the same reason a level-up between acceptance and settlement must not. A replay needs
 * nothing but these numbers.
 *
 * `itemType` rides along even though the engine never reads it. It is what lets an
 * outsider cross-check the resolved numbers against the published catalog and against
 * the chain's own equip state at `sourceVersion`, so a geared receipt is checkable rather
 * than merely self-consistent (threat T13).
 *
 * Bonuses are non-negative and additive. The engine truncates to 16 bits with wraparound
 * rather than clamping, so a negative modifier is one underflow from a pet with 65,000 HP.
 */
export interface EquipEntry {
    /** Equip slot 0-2, matching ItemCore.SLOT_*. */
    slot: number;
    /** ERC-1155 token id of the equipped item. */
    itemType: bigint;
    hp: number;
    atk: number;
    def: number;
    int: number;
    mdef: number;
}

/**
 * One pet, frozen at acceptance. The "photo" from Part 1 of the architecture doc.
 *
 * Two jobs. First, the fight is decided entirely by values written down before any
 * randomness existed, so a level-up between acceptance and settlement cannot
 * reroll a committed battle (the same attack `GameLogic.sol` closed on chain by
 * snapshotting sim inputs). Second, it makes the battle replayable by a stranger:
 * every input the ruleset consumes is here, in the receipt, rather than read live
 * from a database only we can see.
 *
 * That second job is why progression state is included. XP depends on
 * same-opponent decay, which lives in `lastOpponentId` and `streak`; without them
 * in the snapshot, progression could only be recomputed by someone with access to
 * our tables, which is not replay.
 *
 * Equipment arrived in schema version 2 (roadmap §4), at the cost that field always
 * carried. Version 1 snapshots have none and keep verifying unchanged.
 */
export interface PetSnapshot {
    petId: bigint;
    /** Owner at snapshot time, per finalized chain state. */
    owner: string;
    /** 16-digit DNA, the sole source of base attributes. */
    dna: bigint;
    /** Rarity tier 1-5, the DNA multiplier. */
    rarity: number;
    level: number;
    /** Skill archetype 0-7, or any other value for "no archetype" (`NO_SKILL`). */
    skill: number;
    /** XP toward the next level at snapshot time. */
    xp: number;
    /** Previous opponent, or 0 for a pet that has not fought. Drives XP decay. */
    lastOpponentId: bigint;
    /** Consecutive prior battles against `lastOpponentId`. The XP decay shift. */
    streak: number;
    /** Unix seconds this pet becomes battle-ready. Lets a verifier check cooldown. */
    readyAt: number;
    /**
     * Indexed chain version the pet was read at (EVM block timestamp / Solana
     * slot), so a snapshot taken from an unfinalized write is identifiable after
     * the fact rather than merely suspected (threat T10).
     */
    sourceVersion: bigint;
    /**
     * What this pet had equipped at snapshot time, ordered by slot (schema v2+).
     *
     * Absent or empty means ungeared, which is what every v1 snapshot is. Slots must be
     * strictly ascending and unique: the order is part of the encoding, and sorting
     * silently here would hide an upstream bug that produced two weapons.
     */
    equipment?: EquipEntry[];
}

/** Both pets, frozen together. This is what `snapshotHash` covers. */
export interface BattleSnapshot {
    domain: ProtocolDomain;
    attacker: PetSnapshot;
    defender: PetSnapshot;
    /** Unix seconds the snapshot was taken, which is acceptance time. */
    takenAt: number;
    /**
     * Which layout this snapshot was written under. Defaults to the current version.
     *
     * Stored on the object rather than assumed, because re-encoding a historical snapshot
     * has to reproduce the bytes it was hashed under. A v1 snapshot re-encoded at v2 would
     * get a different `snapshotHash` and every receipt naming it would fail to verify.
     */
    schemaVersion?: number;
}

/**
 * The layout a new duel snapshot should declare.
 *
 * Exported so a producer names it deliberately rather than relying on a default: the
 * default is 1, because that is what an absent field means on every snapshot written
 * before the field existed. Pinned to the duel layout: version 3 is a team battle's
 * snapshot, a different object with its own type (`./team`).
 */
export const SNAPSHOT_SCHEMA_VERSION = DUEL_SCHEMA_VERSIONS.snapshot;

/** DNA is a 16-digit number on both chains (see `combat/dna.ts`). */
const MAX_DNA = 10n ** 16n;
const MAX_U256 = 1n << 256n;
const SAFE_ACCOUNT_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** Validates one pet snapshot, returning a normalized copy. */
export function assertPetSnapshot(pet: PetSnapshot, label: string): PetSnapshot {
    if (typeof pet.petId !== 'bigint' || pet.petId <= 0n || pet.petId >= MAX_U256) {
        throw new Error(`${label}.petId is not a valid pet id: ${pet.petId}`);
    }
    if (typeof pet.owner !== 'string' || !SAFE_ACCOUNT_PATTERN.test(pet.owner)) {
        throw new Error(`${label}.owner is not a valid account: ${JSON.stringify(pet.owner)}`);
    }
    if (typeof pet.dna !== 'bigint' || pet.dna < 0n || pet.dna >= MAX_DNA) {
        throw new Error(`${label}.dna must be a 16-digit value, got ${pet.dna}`);
    }
    if (!Number.isSafeInteger(pet.rarity) || pet.rarity < 1 || pet.rarity > 5) {
        throw new Error(`${label}.rarity must be 1-5, got ${pet.rarity}`);
    }
    assertU16(pet.level, `${label}.level`, 1);
    assertU16(pet.skill, `${label}.skill`, 0);
    assertU32(pet.xp, `${label}.xp`);
    if (typeof pet.lastOpponentId !== 'bigint' || pet.lastOpponentId < 0n || pet.lastOpponentId >= MAX_U256) {
        throw new Error(`${label}.lastOpponentId must be a pet id or 0, got ${pet.lastOpponentId}`);
    }
    assertU32(pet.streak, `${label}.streak`);
    if (pet.lastOpponentId === 0n && pet.streak !== 0) {
        // A streak against nobody is not a state the chain can produce, so accepting
        // it would mean hashing a snapshot that cannot be reconciled with any
        // history. Reject it here rather than let it decay XP silently.
        throw new Error(`${label}.streak must be 0 when lastOpponentId is 0, got ${pet.streak}`);
    }
    assertUnixSeconds(pet.readyAt, `${label}.readyAt`, 0);
    if (typeof pet.sourceVersion !== 'bigint' || pet.sourceVersion < 0n || pet.sourceVersion >= 1n << 64n) {
        throw new Error(`${label}.sourceVersion must fit in 64 bits, got ${pet.sourceVersion}`);
    }
    const equipment = assertEquipment(pet.equipment, label);
    return { ...pet, owner: normalizeAccount(pet.owner), ...(equipment.length > 0 && { equipment }) };
}

/** Highest slot index the protocol accepts, matching ItemCore's three gear slots. */
const MAX_SLOT = 2;

/**
 * Validates a pet's equipment list.
 *
 * Slots must be strictly ascending, which does two jobs at once: it makes the encoding
 * canonical without an implicit sort, and it rejects two items in one slot — a state the
 * contract cannot produce, so accepting it would mean hashing a snapshot that no chain
 * history can explain.
 */
function assertEquipment(equipment: EquipEntry[] | undefined, label: string): EquipEntry[] {
    if (equipment === undefined) {
        return [];
    }
    if (!Array.isArray(equipment)) {
        throw new Error(`${label}.equipment must be an array`);
    }

    let previousSlot = -1;
    return equipment.map((entry, index) => {
        const where = `${label}.equipment[${index}]`;
        if (!Number.isSafeInteger(entry.slot) || entry.slot < 0 || entry.slot > MAX_SLOT) {
            throw new Error(`${where}.slot must be 0-${MAX_SLOT}, got ${entry.slot}`);
        }
        if (entry.slot <= previousSlot) {
            throw new Error(
                `${where}.slot must be strictly ascending; got ${entry.slot} after ${previousSlot}`,
            );
        }
        previousSlot = entry.slot;

        if (typeof entry.itemType !== 'bigint' || entry.itemType <= 0n || entry.itemType >= MAX_U256) {
            // Type 0 is ItemCore's empty-slot sentinel, so it is never a real equipped item.
            throw new Error(`${where}.itemType is not a valid item type: ${entry.itemType}`);
        }

        const bonuses = {} as Record<'hp' | 'atk' | 'def' | 'int' | 'mdef', number>;
        for (const field of ['hp', 'atk', 'def', 'int', 'mdef'] as const) {
            const value = entry[field];
            if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
                throw new Error(`${where}.${field} must be 0-65535, got ${value}`);
            }
            bonuses[field] = value;
        }

        return { slot: entry.slot, itemType: entry.itemType, ...bonuses };
    });
}

/** Validates a battle snapshot, returning a normalized copy. */
export function assertBattleSnapshot(snapshot: BattleSnapshot): BattleSnapshot {
    const domain = assertProtocolDomain(snapshot.domain);
    // Absent means 1, not "current". Every snapshot stored before this field existed is a
    // version 1 snapshot, and there are already receipts naming them; defaulting to the
    // build's current version would re-encode all of those under a layout they were never
    // hashed under and invalidate every signature over them. A producer of new snapshots
    // sets the version explicitly, and `SNAPSHOT_SCHEMA_VERSION` is what it should set.
    const schemaVersion = snapshot.schemaVersion ?? 1;
    assertSupportedSchemaVersion('snapshot', schemaVersion);
    if (schemaVersion > DUEL_SCHEMA_VERSIONS.snapshot) {
        throw new Error(`snapshot schema version ${schemaVersion} is a team battle's layout, not a duel's`);
    }

    const attacker = assertPetSnapshot(snapshot.attacker, 'attacker');
    const defender = assertPetSnapshot(snapshot.defender, 'defender');
    if (attacker.petId === defender.petId) {
        throw new Error(`a pet cannot fight itself (petId ${attacker.petId})`);
    }
    if (schemaVersion < 2 && (attacker.equipment?.length || defender.equipment?.length)) {
        // Refused rather than dropped. Version 1 has nowhere to put equipment, so encoding
        // this would silently hash a fight without the gear it was supposed to include.
        throw new Error('snapshot schema version 1 cannot carry equipment; use version 2');
    }
    assertUnixSeconds(snapshot.takenAt, 'takenAt', 1);
    return { domain, attacker, defender, takenAt: snapshot.takenAt, schemaVersion };
}

/** Whether a pet was off cooldown when the snapshot was taken. */
export function isBattleReady(pet: PetSnapshot, atSeconds: number): boolean {
    return atSeconds >= pet.readyAt;
}

function assertU16(value: number, field: string, min: number): void {
    if (!Number.isSafeInteger(value) || value < min || value > 0xffff) {
        throw new Error(`${field} must be ${min}-65535, got ${value}`);
    }
}

function assertU32(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new Error(`${field} must be 0-4294967295, got ${value}`);
    }
}

function assertUnixSeconds(value: number, field: string, min: number): void {
    if (!Number.isSafeInteger(value) || value < min || value > 0xffffffffffff) {
        throw new Error(`${field} must be a unix-seconds integer >= ${min}, got ${value}`);
    }
}
