import { writeHeader } from '../domain/deployment';
import { DUEL_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import type { Hex } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';
import type { PetProgression, ProgressionDelta } from '../progression/progression';
import { hashBattleSnapshot } from '../snapshot/hash';

import { assertBattleReceipt, type BattleReceipt } from './types';

/**
 * Canonical encoding of a receipt.
 *
 * Field order is header-first, like every other object here: schema version, chain id,
 * deployment id, then the body. §G lists `battleId` ahead of `chainId`; the header
 * convention wins, so the shared prefix stays defined in one place instead of being
 * copy-pasted per object.
 *
 * The snapshot enters as `snapshotHash`. §G lists the snapshots and their hash
 * separately, but hashing both binds the same bytes twice. The full snapshot travels in
 * the payload so replay needs nothing from us.
 *
 * The progression delta is encoded in full rather than as a hash, because it is small
 * and because a verifier comparing its own recomputation against ours wants the numbers,
 * not a digest that only says "different".
 */
export function encodeBattleReceipt(receipt: BattleReceipt): Uint8Array {
    const checked = assertBattleReceipt(receipt);
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.RECEIPT);
    writeHeader(writer, 'receipt', checked.domain, DUEL_SCHEMA_VERSIONS.receipt)
        .text(checked.battleId)
        .hash(checked.intentHash)
        .hash(checked.commitmentHash)
        .hash(checked.defenseAuthorizationHash)
        .hash(hashBattleSnapshot(checked.snapshot))
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
        .hash(checked.combatLogHash);
    writeProgression(writer, checked.progression);
    return writer
        .u64(checked.sequence)
        .optional(checked.previousReceiptHash, (w, v) => w.hash(v))
        .optional(checked.attackerPreviousReceiptHash, (w, v) => w.hash(v))
        .optional(checked.defenderPreviousReceiptHash, (w, v) => w.hash(v))
        .u64(checked.createdAt)
        .text(checked.signingKeyId)
        .build();
}

/**
 * `receiptHash`: what the KMS key signs, what the next receipt links back to, and what a
 * Merkle leaf commits to.
 */
export function hashBattleReceipt(receipt: BattleReceipt): Hex {
    return keccak256Hex(encodeBattleReceipt(receipt));
}

function writeProgression(writer: CanonicalWriter, progression: ProgressionDelta): void {
    writePetProgression(writer, progression.attacker);
    writePetProgression(writer, progression.defender);
}

/** Shared with the team receipt, which writes six of these. */
export function writePetProgression(writer: CanonicalWriter, pet: PetProgression): void {
    writer
        .u256(pet.petId)
        .bool(pet.won)
        .u32(pet.decayShift)
        .u32(pet.xpAwarded)
        .u256(pet.lastOpponentId)
        .u32(pet.streak)
        .u16(pet.level)
        .u32(pet.xp)
        .bool(pet.leveledUp);
}
