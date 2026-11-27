import type { Hex } from '@cryptopets/protocol';
import type { Prisma } from '@generated/prisma/client';
import { BattleState } from '@generated/prisma/enums';

import { prisma } from '@config/prisma';
import { applyTransition } from '@features/battle/ledger';
import type { EngineAttestation } from '@features/battle/signer';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

/**
 * Helpers shared by the duel and team signing paths (`sign.worker.ts`, `team.worker.ts`),
 * kept apart from both so neither has to import the other.
 */
/**
 * Every attestation this receipt has earned. The TypeScript engine's own agreement
 * is implicit in having computed the receipt at all, so it is always included.
 * `go-verifier`'s is included whenever independent verification actually ran and
 * matched — which is the only way this battle reached `verified` in the first
 * place, so its presence here is just formalizing a check already passed, not
 * re-deciding anything.
 *
 * Both name `receiptHash`, the digest of *this* receipt: the signer refuses any
 * attestation whose `receiptHash` does not match what it independently
 * recomputes, so an attestation naming the wrong receipt (stale, or for a
 * different battle entirely) is caught there, not trusted here.
 */
export function buildAttestations(
    battle: { verificationDetail: Prisma.JsonValue },
    receiptHash: Hex,
    nowSeconds: number,
): EngineAttestation[] {
    const attestations: EngineAttestation[] = [
        { attester: 'typescript-engine', receiptHash, attestedAt: nowSeconds },
    ];
    if (battle.verificationDetail) {
        attestations.push({ attester: 'go-verifier', receiptHash, attestedAt: nowSeconds });
    }
    return attestations;
}

export async function commitmentHashFor(battleId: string): Promise<string> {
    const commitment = await prisma.battleCommitment.findUnique({
        where: { battleId },
        select: { commitmentHash: true },
    });
    if (!commitment) {
        throw new Error(`battle ${battleId} has no commitment row; cannot build its receipt`);
    }
    return commitment.commitmentHash;
}

export async function failSigning(battleId: string, roomId: string | null, reason: string): Promise<void> {
    await applyTransition({
        battleId,
        from: BattleState.verified,
        to: BattleState.signing_failed,
        patch: { failureReason: reason },
    });
    notifyBattleRoomIfPresent(roomId, { type: 'battle-updated', battleId, state: BattleState.signing_failed });
}

export function serializeBigints<T>(value: T): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
