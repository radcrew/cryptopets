import { writeHeader } from '../domain/deployment';
import type { Hex } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';

import { assertBattleSnapshot, type BattleSnapshot, type PetSnapshot } from './types';

/**
 * Canonical encoding of a frozen battle snapshot: header, attacker, defender,
 * `takenAt`.
 *
 * Attacker and defender are written in role order, not sorted by pet id. Roles are
 * not symmetric here (the attacker pays, the attacker's `firstWins` defines the
 * result), so swapping the two must produce a different hash.
 *
 * No `battleId` is included. A snapshot describes pets, and the commitment is what
 * binds one snapshot to one battle by signing `battleId` and `snapshotHash`
 * together (§E).
 */
export function encodeBattleSnapshot(snapshot: BattleSnapshot): Uint8Array {
    const checked = assertBattleSnapshot(snapshot);
    const version = checked.schemaVersion ?? 1;
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.SNAPSHOT);
    writeHeader(writer, 'snapshot', checked.domain, version);
    writePetSnapshot(writer, checked.attacker, version);
    writePetSnapshot(writer, checked.defender, version);
    return writer.u64(checked.takenAt).build();
}

/** `snapshotHash`: carried by the commitment (§E) and the receipt (§G). */
export function hashBattleSnapshot(snapshot: BattleSnapshot): Hex {
    return keccak256Hex(encodeBattleSnapshot(snapshot));
}

/**
 * One pet's fields, in the layout `version` defines.
 *
 * Version 1 stops at `sourceVersion`; version 2 appends the equipment list (roadmap §4).
 * Everything before it is byte-identical across the two, so an ungeared v2 snapshot
 * differs from the v1 of the same pet only by the version in the header and a zero-length
 * array — which is the point: adding the field cannot change what an old fight hashed to.
 */
export function writePetSnapshot(writer: CanonicalWriter, pet: PetSnapshot, version: number): void {
    writer
        .u256(pet.petId)
        .account(pet.owner)
        .u256(pet.dna)
        .u8(pet.rarity)
        .u16(pet.level)
        .u16(pet.skill)
        .u32(pet.xp)
        .u256(pet.lastOpponentId)
        .u32(pet.streak)
        .u64(pet.readyAt)
        .u64(pet.sourceVersion);

    if (version < 2) {
        return;
    }

    // Count-prefixed and in slot order, which `assertPetSnapshot` has already enforced.
    // The item type is hashed alongside the resolved numbers so a verifier can hold us to
    // both: the modifiers the fight used, and which item was supposed to have granted them.
    writer.array(pet.equipment ?? [], (w, entry) => {
        w.u8(entry.slot)
            .u256(entry.itemType)
            .u16(entry.hp)
            .u16(entry.atk)
            .u16(entry.def)
            .u16(entry.int)
            .u16(entry.mdef);
    });
}
