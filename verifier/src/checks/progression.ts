import {
    type AnyBattleReceipt,
    isTeamBattleReceipt,
    type Ruleset,
    verifyReceiptProgression,
    verifyTeamReceiptProgression,
} from '@cryptopets/protocol';

import type { CheckResult } from './types';

/**
 * Recomputes the XP and level change the battle caused and compares it to what the receipt
 * claims (§F, §H item 1).
 *
 * This is what makes off-chain progression auditable at all. A pet's level is no longer
 * verifiable against the chain, so the honest version of "this pet is level 12" is "replay
 * the receipts that got it there and see". That is only a pure function of the receipt
 * because the snapshot freezes `lastOpponentId` and `streak`, the same-opponent decay state
 * XP depends on — without those a third party could only recompute this with access to our
 * tables, which is not replay.
 *
 * The level cap comes from the ruleset the receipt names, never from this build's defaults:
 * passing the wrong cap produces a mismatch, which is the correct outcome rather than a
 * false pass.
 */
export function checkProgression(receipt: AnyBattleReceipt, ruleset: Ruleset): CheckResult {
    const check = 'progression';
    let result: ReturnType<typeof verifyReceiptProgression>;
    try {
        const params = { maxLevel: ruleset.maxLevel };
        result = isTeamBattleReceipt(receipt)
            ? verifyTeamReceiptProgression(receipt, params)
            : verifyReceiptProgression(receipt, params);
    } catch (error) {
        return { check, ok: false, detail: (error as Error).message };
    }
    if (result.ok) {
        return { check, ok: true };
    }
    return { check, ok: false, detail: result.failures.map((failure) => failure.detail).join('; ') };
}
