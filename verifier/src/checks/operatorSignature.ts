import { type AnyBattleReceipt, hashAnyBattleReceipt, type Hex, recoverAddress } from '@cryptopets/protocol';

import type { SignedReceiptEnvelope, TrustedSigningKey } from '../io/types';
import type { CheckResult } from './types';

/**
 * Checks that a receipt's operator signature actually verifies against a trusted, published
 * signing key (§A's "operator signature -> verify against a published key" row, §H item 1).
 *
 * This needs nothing beyond the receipt itself and the caller-supplied trusted key list: no
 * drand round, no combat replay, no backend access. It is the cheapest real check there is,
 * which is why it runs first.
 *
 * Deliberately not covered here: the drand BLS signature (needs the beacon), the combat
 * replay (needs the ruleset and the log), and the progression recomputation (needs the
 * ruleset's level cap) — all of those are `verifyReceiptConsistency` / the full-replay checks
 * this package adds next, not this one.
 */
export function checkOperatorSignature(
    envelope: SignedReceiptEnvelope,
    receipt: AnyBattleReceipt,
    trustedKeys: readonly TrustedSigningKey[],
): CheckResult {
    const check = 'operator-signature';

    if (receipt.signingKeyId !== envelope.signingKeyId) {
        return {
            check,
            ok: false,
            detail: `envelope names signing key ${envelope.signingKeyId}, but the receipt payload names ${receipt.signingKeyId}`,
        };
    }

    const key = trustedKeys.find((candidate) => candidate.keyId === envelope.signingKeyId);
    if (!key) {
        return { check, ok: false, detail: `signing key ${envelope.signingKeyId} is not in the trusted key list` };
    }
    if (key.notBefore !== undefined && receipt.createdAt < key.notBefore) {
        return {
            check,
            ok: false,
            detail: `receipt created at ${receipt.createdAt}, before key ${key.keyId} became valid at ${key.notBefore}`,
        };
    }
    if (key.notAfter != null && receipt.createdAt > key.notAfter) {
        return {
            check,
            ok: false,
            detail: `receipt created at ${receipt.createdAt}, after key ${key.keyId} retired at ${key.notAfter}`,
        };
    }

    const digest = hashAnyBattleReceipt(receipt);
    if (digest.toLowerCase() !== envelope.receiptHash.toLowerCase()) {
        return {
            check,
            ok: false,
            detail: `envelope's receiptHash ${envelope.receiptHash} does not match the recomputed digest ${digest}`,
        };
    }

    let recovered: Hex;
    try {
        recovered = recoverAddress(digest, envelope.signature as Hex);
    } catch (error) {
        return { check, ok: false, detail: (error as Error).message };
    }
    if (recovered.toLowerCase() !== key.address.toLowerCase()) {
        return { check, ok: false, detail: `signature recovers to ${recovered}, not ${key.address}` };
    }

    return { check, ok: true };
}
