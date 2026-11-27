import { describe, expect, it } from 'vitest';

import {
    assertBattleSnapshot,
    type BattleSnapshot,
    type EquipEntry,
    encodeBattleSnapshot,
    hashBattleSnapshot,
    type PetSnapshot,
    SNAPSHOT_SCHEMA_VERSION,
} from '../../src/snapshot';

/**
 * Snapshot schema v2: equipment (roadmap §4).
 *
 * Two properties carry the whole design and both are pinned here. A version 1 snapshot
 * must hash exactly as it always did, or every receipt already signed stops verifying.
 * And the resolved modifiers must be part of the digest, or unequipping after acceptance
 * would change a committed fight.
 */

const BLADE: EquipEntry = { slot: 0, itemType: 1n, hp: 0, atk: 4, def: 0, int: 0, mdef: 0 };
const PLATE: EquipEntry = { slot: 1, itemType: 11n, hp: 30, atk: 0, def: 10, int: 0, mdef: 0 };

const ATTACKER: PetSnapshot = {
    petId: 1n,
    owner: '0xabcdef0123456789abcdef0123456789abcdef01',
    dna: 1234567890123456n,
    rarity: 3,
    level: 10,
    skill: 4,
    xp: 120,
    lastOpponentId: 0n,
    streak: 0,
    readyAt: 1861919000,
    sourceVersion: 1861918000n,
};

const DEFENDER: PetSnapshot = {
    ...ATTACKER,
    petId: 2n,
    owner: '0x2222222222222222222222222222222222222222',
    dna: 6543210987654321n,
};

const BASE: BattleSnapshot = {
    domain: { chainId: 'eip155:84532', deploymentId: 'base-sepolia-live' },
    attacker: ATTACKER,
    defender: DEFENDER,
    takenAt: 1861918900,
};

describe('schema versioning', () => {
    // The single most breakage-prone property in this change: an absent version means the
    // snapshot was written before the field existed, which is version 1 by definition.
    // Defaulting to the build's current version would re-encode every stored snapshot
    // under a layout it was never hashed under.
    it('treats an absent version as 1, not as the current one', () => {
        expect(assertBattleSnapshot(BASE).schemaVersion).toBe(1);
        expect(SNAPSHOT_SCHEMA_VERSION).toBe(2);
    });

    it('hashes a version 1 snapshot identically whether the version is implied or stated', () => {
        expect(hashBattleSnapshot(BASE)).toBe(hashBattleSnapshot({ ...BASE, schemaVersion: 1 }));
    });

    // The version travels inside the hashed bytes, so the same pets under two layouts are
    // two different digests rather than one ambiguous one.
    it('gives an ungeared v2 snapshot a different hash from its v1 twin', () => {
        expect(hashBattleSnapshot({ ...BASE, schemaVersion: 2 })).not.toBe(hashBattleSnapshot(BASE));
    });

    it('refuses a version this build does not implement', () => {
        expect(() => assertBattleSnapshot({ ...BASE, schemaVersion: 4 })).toThrow(/unsupported snapshot schema version/);
    });

    // Version 3 exists, but it is a team battle's snapshot. Reading a duel at it would hash
    // two pets under a layout built for eight.
    it('refuses the team layout for a duel', () => {
        expect(() => assertBattleSnapshot({ ...BASE, schemaVersion: 3 })).toThrow(/team battle's layout/);
    });

    // Refused rather than silently dropped: encoding it at v1 would hash a fight without
    // the gear it was supposed to include.
    it('refuses equipment on a version 1 snapshot', () => {
        expect(() =>
            assertBattleSnapshot({ ...BASE, schemaVersion: 1, attacker: { ...ATTACKER, equipment: [BLADE] } }),
        ).toThrow(/cannot carry equipment/);
    });
});

describe('encoding equipment', () => {
    const geared: BattleSnapshot = {
        ...BASE,
        schemaVersion: 2,
        attacker: { ...ATTACKER, equipment: [BLADE, PLATE] },
    };

    it('puts the resolved modifiers in the digest', () => {
        const weaker: BattleSnapshot = {
            ...geared,
            attacker: { ...ATTACKER, equipment: [{ ...BLADE, atk: 3 }, PLATE] },
        };
        expect(hashBattleSnapshot(geared)).not.toBe(hashBattleSnapshot(weaker));
    });

    // The item type is hashed alongside the numbers, so a verifier can hold the operator to
    // both: the modifiers the fight used, and which item was meant to have granted them.
    it('puts the item type in the digest even though the engine never reads it', () => {
        const swapped: BattleSnapshot = {
            ...geared,
            attacker: { ...ATTACKER, equipment: [{ ...BLADE, itemType: 2n }, PLATE] },
        };
        expect(hashBattleSnapshot(geared)).not.toBe(hashBattleSnapshot(swapped));
    });

    it('distinguishes which pet is wearing the gear', () => {
        const onDefender: BattleSnapshot = {
            ...BASE,
            schemaVersion: 2,
            defender: { ...DEFENDER, equipment: [BLADE, PLATE] },
        };
        expect(hashBattleSnapshot(geared)).not.toBe(hashBattleSnapshot(onDefender));
    });

    it('encodes an empty list and an absent one the same way', () => {
        const empty = hashBattleSnapshot({ ...BASE, schemaVersion: 2, attacker: { ...ATTACKER, equipment: [] } });
        expect(empty).toBe(hashBattleSnapshot({ ...BASE, schemaVersion: 2 }));
    });

    it('is deterministic', () => {
        expect(encodeBattleSnapshot(geared)).toEqual(encodeBattleSnapshot(geared));
    });
});

describe('equipment validation', () => {
    const geared = (equipment: EquipEntry[]): BattleSnapshot => ({
        ...BASE,
        schemaVersion: 2,
        attacker: { ...ATTACKER, equipment },
    });

    // Ascending order makes the encoding canonical without an implicit sort, and rejects
    // two items in one slot — a state ItemCore cannot produce, so a snapshot claiming it
    // could not be reconciled with any chain history.
    it('refuses slots out of order', () => {
        expect(() => assertBattleSnapshot(geared([PLATE, BLADE]))).toThrow(/strictly ascending/);
    });

    it('refuses two items in one slot', () => {
        expect(() => assertBattleSnapshot(geared([BLADE, { ...BLADE, itemType: 2n }]))).toThrow(/strictly ascending/);
    });

    it('refuses a slot the contract does not have', () => {
        expect(() => assertBattleSnapshot(geared([{ ...BLADE, slot: 3 }]))).toThrow(/slot must be 0-2/);
    });

    // Item type 0 is ItemCore's empty-slot sentinel, so it is never a real equipped item.
    it('refuses item type 0', () => {
        expect(() => assertBattleSnapshot(geared([{ ...BLADE, itemType: 0n }]))).toThrow(/not a valid item type/);
    });

    // The engine truncates to 16 bits with wraparound rather than clamping, so a negative
    // modifier is one underflow away from a pet with 65,000 HP.
    it('refuses a negative bonus', () => {
        expect(() => assertBattleSnapshot(geared([{ ...BLADE, atk: -1 }]))).toThrow(/atk must be 0-65535/);
    });

    it('refuses a bonus that does not fit 16 bits', () => {
        expect(() => assertBattleSnapshot(geared([{ ...BLADE, hp: 70000 }]))).toThrow(/hp must be 0-65535/);
    });

    it('keeps a valid list intact and in order', () => {
        const checked = assertBattleSnapshot(geared([BLADE, PLATE]));
        expect(checked.attacker.equipment).toEqual([BLADE, PLATE]);
    });
});
