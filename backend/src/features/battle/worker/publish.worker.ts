import {
    anyReceiptFromWire,
    assertAnyBattleReceipt,
    hashAnyBattleReceipt,
    type WireBattleReceipt,
    type WireTeamBattleReceipt,
} from '@cryptopets/protocol';
import { BattleState } from '@generated/prisma/enums';

import { prisma } from '@config/prisma';
import { applyTransition, type ClaimedMessage, completeOutbox } from '@features/battle/ledger';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

/**
 * Handles `publish` messages: `signed` -> `published` (§J).
 *
 * The receipt row is written by the sign worker, and the public corpus serves it from that
 * moment, so this transition does not perform publication so much as confirm it. What it
 * adds is the last integrity gate before the receipt is treated as publicly final: the
 * stored payload is parsed back through the protocol types, revalidated, and re-hashed, and
 * the digest must equal the id it is stored under.
 *
 * That is worth doing precisely because it should never fail. A row that no longer hashes
 * to its own key means the payload was corrupted between signing and storage — by a bad
 * serialization, a partial write, a schema drift — and the signature over it no longer
 * proves anything. Catching that here stops us announcing a receipt nobody can verify;
 * catching it later means a third party finds it first, which is the outcome this whole
 * design exists to avoid.
 *
 * A mismatch throws rather than transitioning to a failure state. There is no honest
 * `publish_failed` outcome for a battle that was already signed: the fight really did
 * happen and the signature really was issued, so the correct response is a dead-lettered
 * message and a human looking at why storage disagrees with what was signed.
 */
export async function processPublishMessage(message: ClaimedMessage, nowSeconds: number): Promise<void> {
    const battle = await prisma.battleLedger.findUnique({ where: { battleId: message.battleId } });
    if (!battle) {
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    if (battle.state !== BattleState.signed) {
        // Already published by another worker, or this is a stale retry of a transition
        // that already landed.
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }

    const receipt = await prisma.battleReceipt.findUnique({ where: { battleId: battle.battleId } });
    if (!receipt) {
        throw new Error(`battle ${battle.battleId} is signed but has no receipt row to publish`);
    }

    // Either kind: a team receipt re-hashes under its own layout.
    const recomputed = hashAnyBattleReceipt(
        assertAnyBattleReceipt(anyReceiptFromWire(receipt.payload as unknown as WireBattleReceipt | WireTeamBattleReceipt)),
    );
    if (recomputed.toLowerCase() !== receipt.receiptHash.toLowerCase()) {
        throw new Error(
            `receipt ${receipt.receiptHash} for battle ${battle.battleId} re-hashes to ${recomputed}; ` +
                'the stored payload does not match what was signed',
        );
    }

    await applyTransition({
        battleId: battle.battleId,
        from: BattleState.signed,
        to: BattleState.published,
        // Batching is not per-battle work — it aggregates across many receipts on its own
        // schedule — so no `batch` message is enqueued here. The batcher picks up published
        // receipts by querying for them.
    });
    notifyBattleRoomIfPresent(battle.roomId, {
        type: 'battle-updated',
        battleId: battle.battleId,
        state: BattleState.published,
    });
    await completeOutbox(message.id, new Date(nowSeconds * 1000));
}
