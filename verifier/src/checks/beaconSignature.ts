import { type AnyBattleReceipt, verifyReceiptBeacon } from '@cryptopets/protocol';

import type { CheckResult } from './types';

/**
 * Checks the drand BLS signature the receipt carries (§E, §H item 1).
 *
 * This is the check that makes commit-before-reveal mean anything. Everything cheaper —
 * that the randomness is the hash of the signature, that the seed follows from that
 * randomness — passes just as happily for a signature we invented, because we would have
 * hashed our own invention consistently. Only verifying against drand's public key, over
 * the round number as the signed message, establishes that the randomness existed
 * independently of us and could not have been known when the battle was committed.
 *
 * Needs no ruleset: this runs even when the bundle a receipt names could not be obtained.
 */
export function checkBeaconSignature(receipt: AnyBattleReceipt): CheckResult {
    const check = 'beacon-signature';
    let result: ReturnType<typeof verifyReceiptBeacon>;
    try {
        result = verifyReceiptBeacon(receipt);
    } catch (error) {
        return { check, ok: false, detail: (error as Error).message };
    }
    if (result.ok) {
        return { check, ok: true };
    }
    return { check, ok: false, detail: result.failures.map((failure) => failure.detail).join('; ') };
}
