import type { BattleSnapshot, EquipEntry, PetSnapshot, SquadMember, TeamBattleSnapshot } from '@cryptopets/protocol';

/**
 * Reads a frozen snapshot back out of the ledger row it was stored in.
 *
 * The snapshot is persisted with `JSON.stringify`, which has no bigint, so `petId`, `dna`,
 * `lastOpponentId`, `sourceVersion` and an equipped item's `itemType` all come back as
 * decimal strings. The protocol types require real bigints, so nothing may hash, validate
 * or simulate a stored snapshot without going through here first.
 *
 * One decoder, used by every worker that reads the column. There were three, written
 * separately, and that is precisely how one of them came to be missing `schemaVersion` and
 * `equipment` after roadmap §4 added them: the signing worker rebuilt every snapshot at
 * layout version 1, its hash stopped matching the one acceptance committed, and the seed
 * check inside `assertBattleReceipt` refused every receipt. Adding a field to `PetSnapshot`
 * must be a change in one place, or the next field lands the same way.
 *
 * `schemaVersion` is carried verbatim and never defaulted. A row written before that field
 * existed genuinely is a version 1 snapshot with a receipt already signed over it, so
 * leaving it absent is what lets `assertBattleSnapshot` read it as 1; substituting this
 * build's current version would re-encode it under a layout it was never hashed under.
 */

/** One equipped item as stored: JSON, so the item type arrives as a decimal string. */
export interface StoredEquipEntry {
    slot: number;
    itemType: string | bigint;
    hp: number;
    atk: number;
    def: number;
    int: number;
    mdef: number;
}

/** One pet as stored, with every bigint field widened to accept its decimal-string form. */
export interface StoredPetSnapshot {
    petId: string | bigint;
    owner: string;
    dna: string | bigint;
    rarity: number;
    level: number;
    skill: number;
    xp: number;
    lastOpponentId: string | bigint;
    streak: number;
    readyAt: number;
    sourceVersion: string | bigint;
    equipment?: StoredEquipEntry[];
}

/** A battle snapshot as stored in `battle_ledger.snapshot`. */
export interface StoredBattleSnapshot {
    domain: BattleSnapshot['domain'];
    attacker: StoredPetSnapshot;
    defender: StoredPetSnapshot;
    takenAt: number;
    schemaVersion?: number;
}

/** Decodes one stored pet. */
export function decodeStoredPet(pet: StoredPetSnapshot): PetSnapshot {
    return {
        petId: BigInt(pet.petId),
        owner: pet.owner,
        dna: BigInt(pet.dna),
        rarity: pet.rarity,
        level: pet.level,
        skill: pet.skill,
        xp: pet.xp,
        lastOpponentId: BigInt(pet.lastOpponentId),
        streak: pet.streak,
        readyAt: pet.readyAt,
        sourceVersion: BigInt(pet.sourceVersion),
        // Omitted rather than empty when the pet wore nothing, matching what
        // `assertPetSnapshot` normalizes to and what `snapshot.builder` wrote.
        ...(pet.equipment && pet.equipment.length > 0 && { equipment: pet.equipment.map(decodeStoredEquipEntry) }),
    };
}

/** Decodes a whole stored snapshot, ready to hash, validate or simulate. */
export function decodeStoredSnapshot(stored: unknown): BattleSnapshot {
    const snapshot = stored as StoredBattleSnapshot;
    return {
        domain: snapshot.domain,
        attacker: decodeStoredPet(snapshot.attacker),
        defender: decodeStoredPet(snapshot.defender),
        takenAt: snapshot.takenAt,
        ...(snapshot.schemaVersion !== undefined && { schemaVersion: snapshot.schemaVersion }),
    };
}

/** A stored team snapshot: the duel's stored pets, each with its placement. */
export interface StoredTeamBattleSnapshot {
    domain: TeamBattleSnapshot['domain'];
    attackers: (Omit<SquadMember, 'pet'> & { pet: StoredPetSnapshot })[];
    roster: (Omit<SquadMember, 'pet'> & { pet: StoredPetSnapshot })[];
    takenAt: number;
    schemaVersion: number;
}

/** Decodes a stored team snapshot, ready to hash, validate or replay. */
export function decodeStoredTeamSnapshot(stored: unknown): TeamBattleSnapshot {
    const snapshot = stored as StoredTeamBattleSnapshot;
    return {
        domain: snapshot.domain,
        attackers: snapshot.attackers.map((m) => ({ col: m.col, row: m.row, tactic: m.tactic, pet: decodeStoredPet(m.pet) })),
        roster: snapshot.roster.map((m) => ({ col: m.col, row: m.row, tactic: m.tactic, pet: decodeStoredPet(m.pet) })),
        takenAt: snapshot.takenAt,
        schemaVersion: snapshot.schemaVersion,
    };
}

function decodeStoredEquipEntry(entry: StoredEquipEntry): EquipEntry {
    return {
        slot: entry.slot,
        itemType: BigInt(entry.itemType),
        hp: entry.hp,
        atk: entry.atk,
        def: entry.def,
        int: entry.int,
        mdef: entry.mdef,
    };
}
