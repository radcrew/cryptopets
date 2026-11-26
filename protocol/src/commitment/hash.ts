import { writeHeader } from '../domain/deployment';
import type { Hex } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';
import { hashAnyBattleSnapshot } from '../snapshot/team';

import { assertBattleCommitment, type BattleCommitment } from './types';

/**
 * Canonical encoding of a commitment.
 *
 * The snapshot enters as its hash, not as its fields. §E lists `attackerSnapshot`
 * and `defenderSnapshot` alongside `snapshotHash`, but hashing both would bind the
 * same data twice: `snapshotHash` already commits to every frozen field. The
 * delivered payload still carries the full snapshots, so a player can replay
 * without asking us for anything; a verifier recomputes their hash and compares.
 */
export function encodeBattleCommitment(commitment: BattleCommitment): Uint8Array {
    const checked = assertBattleCommitment(commitment);
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.COMMITMENT);
    return writeHeader(writer, 'commitment', checked.domain)
        .text(checked.battleId)
        .hash(checked.intentHash)
        .hash(checked.defenseAuthorizationHash)
        .hash(hashAnyBattleSnapshot(checked.snapshot))
        .u32(checked.rulesetVersion)
        .hash(checked.rulesetHash)
        .hash(checked.drandChainHash)
        .u64(checked.drandRound)
        .u64(checked.acceptedAt)
        .optional(checked.previousCommitmentHash, (w, v) => w.hash(v))
        .text(checked.signingKeyId)
        .build();
}

/**
 * `commitmentHash`: what the KMS key signs, what the next commitment links back
 * to, and what a receipt references.
 */
export function hashBattleCommitment(commitment: BattleCommitment): Hex {
    return keccak256Hex(encodeBattleCommitment(commitment));
}
