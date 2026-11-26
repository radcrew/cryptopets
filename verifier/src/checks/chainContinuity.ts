import { type AnyBattleReceipt, type Hex, verifyReceiptChain } from '@cryptopets/protocol';

import type { CheckResult } from './types';

/**
 * Checks hash-chain continuity across a run of receipts under one signing key (§G, §H item 1):
 * every receipt links to its predecessor's real hash, sequence numbers are consecutive, and no
 * battle id or timestamp is out of place.
 *
 * Like the operator-signature check, this needs nothing beyond the receipts themselves —
 * `verifyReceiptChain` does the actual walk (`protocol/src/receipt/chain.ts`); this just adapts
 * its result into the same `CheckResult` shape every other check reports.
 *
 * `expectedAnchor` is `null` to assert the run starts at the key's very first receipt, a hash to
 * continue an earlier window, or omitted to check only the run's own internal continuity.
 */
export function checkChainContinuity(receipts: readonly AnyBattleReceipt[], expectedAnchor?: Hex | null): CheckResult {
    const check = 'chain-continuity';
    const result = verifyReceiptChain(receipts, expectedAnchor);
    if (result.ok) {
        return { check, ok: true };
    }
    return { check, ok: false, detail: `receipt at index ${result.index} (battleId ${receipts[result.index]?.battleId}): ${result.reason}` };
}
