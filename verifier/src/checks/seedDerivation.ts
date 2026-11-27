import { type AnyBattleReceipt, deriveBattleSeed, hashAnyBattleSnapshot } from '@cryptopets/protocol';

import type { CheckResult } from './types';

/**
 * Checks that the seed the fight ran on really follows from the receipt's own inputs
 * (§E, §H item 1): the domain, the drand randomness, the battle id, the snapshot, and the
 * ruleset hash.
 *
 * This is what stops a favourable seed being stapled onto a genuine beacon and a genuine
 * snapshot. `assertBattleReceipt` makes the same check internally — a receipt that fails
 * here also fails to hash at all — but it is reported as its own named check because
 * "the seed was chosen, not derived" and "this JSON is malformed" are very different
 * accusations, and collapsing them into one line would lose that.
 */
export function checkSeedDerivation(receipt: AnyBattleReceipt): CheckResult {
    const check = 'seed-derivation';
    let expected: string;
    try {
        expected = deriveBattleSeed({
            domain: receipt.domain,
            drandRandomness: receipt.beacon.randomness,
            battleId: receipt.battleId,
            snapshotHash: hashAnyBattleSnapshot(receipt.snapshot),
            rulesetHash: receipt.rulesetHash,
        }).hex;
    } catch (error) {
        return { check, ok: false, detail: `could not derive the seed: ${(error as Error).message}` };
    }

    if (receipt.seed.toLowerCase() !== expected) {
        return { check, ok: false, detail: `receipt claims seed ${receipt.seed}, but its own inputs derive ${expected}` };
    }
    return { check, ok: true };
}
