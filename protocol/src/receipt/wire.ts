import type { PetProgression } from '../progression/progression';
import type { BattleSnapshot, EquipEntry, PetSnapshot } from '../snapshot/types';

import type { BattleReceipt } from './types';

/**
 * JSON wire form of a `BattleReceipt`: identical shape, except the bigint fields (pet id,
 * dna, last-opponent id, source version) travel as decimal strings, since JSON has no
 * bigint type. This is exactly what the backend's public receipt endpoints actually serve —
 * `backend/src/features/battle-worker/sign.worker.ts` stores the receipt through a
 * `JSON.stringify(receipt, bigint -> string)` replacer, and the read/corpus routes hand that
 * stored payload back unchanged.
 *
 * `receiptFromWire` converts only; it does not validate. `assertBattleReceipt` is what makes
 * a converted receipt trustworthy — a field that fails to convert cleanly (a non-numeric
 * string handed to `BigInt(...)`) throws before that even runs, and everything else
 * (ranges, hash consistency, chain-link shape) is `assertBattleReceipt`'s job, not this one's.
 */
export type WireBattleReceipt = Omit<BattleReceipt, 'snapshot' | 'progression'> & {
    snapshot: WireBattleSnapshot;
    progression: WireProgressionDelta;
};

export type WireBattleSnapshot = Omit<BattleSnapshot, 'attacker' | 'defender'> & {
    attacker: WirePetSnapshot;
    defender: WirePetSnapshot;
};

export type WirePetSnapshot = Omit<
    PetSnapshot,
    'petId' | 'dna' | 'lastOpponentId' | 'sourceVersion' | 'equipment'
> & {
    petId: string;
    dna: string;
    lastOpponentId: string;
    sourceVersion: string;
    /** Item types are uint256 too, so they cross the wire as decimal strings. */
    equipment?: (Omit<EquipEntry, 'itemType'> & { itemType: string })[];
};

export interface WireProgressionDelta {
    attacker: WirePetProgression;
    defender: WirePetProgression;
}

export type WirePetProgression = Omit<PetProgression, 'petId' | 'lastOpponentId'> & {
    petId: string;
    lastOpponentId: string;
};

/** Converts a JSON-wire receipt (bigints as decimal strings) into a typed `BattleReceipt`. */
export function receiptFromWire(wire: WireBattleReceipt): BattleReceipt {
    return {
        ...wire,
        snapshot: {
            ...wire.snapshot,
            attacker: petSnapshotFromWire(wire.snapshot.attacker),
            defender: petSnapshotFromWire(wire.snapshot.defender),
        },
        progression: {
            attacker: petProgressionFromWire(wire.progression.attacker),
            defender: petProgressionFromWire(wire.progression.defender),
        },
    };
}

/** Shared with the team receipt. */
export function petSnapshotFromWire(pet: WirePetSnapshot): PetSnapshot {
    // `equipment` is pulled out of the spread rather than overridden after it: its wire
    // shape carries a string item type, and spreading it first would leave that type in
    // the result even though the value is replaced.
    const { equipment, ...rest } = pet;
    return {
        ...rest,
        petId: BigInt(pet.petId),
        dna: BigInt(pet.dna),
        lastOpponentId: BigInt(pet.lastOpponentId),
        sourceVersion: BigInt(pet.sourceVersion),
        // Widened like every other uint256 here. Left as a string it reaches
        // `assertPetSnapshot` as the wrong type and rejects the whole receipt, which is how
        // this was found: a geared receipt failed seed derivation rather than decoding.
        ...(equipment && {
            equipment: equipment.map((entry) => ({ ...entry, itemType: BigInt(entry.itemType) })),
        }),
    };
}

/** Shared with the team receipt. */
export function petProgressionFromWire(pet: WirePetProgression): PetProgression {
    return {
        ...pet,
        petId: BigInt(pet.petId),
        lastOpponentId: BigInt(pet.lastOpponentId),
    };
}
