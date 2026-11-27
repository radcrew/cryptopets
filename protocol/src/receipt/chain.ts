import type { Hex } from '../encoding/bytes';

import { type AnyBattleReceipt, hashAnyBattleReceipt, isTeamBattleReceipt, teamFighterIds } from './team';

/**
 * Receipt hash chains: the global one per signing key, and one per pet.
 *
 * `sequence` alone is an ordering we assert. The links make history tamper-evident:
 * remove a receipt and the next one no longer matches its predecessor, reorder them and
 * the same, sign two with the same predecessor and the contradiction is provable.
 *
 * None of this prevents us withholding a receipt. It makes the gap visible, which is the
 * honest claim (§G, threat T3).
 */

export type ReceiptChainFailure =
    | 'wrong-anchor'
    | 'broken-link'
    | 'sequence-not-consecutive'
    | 'duplicate-battle-id'
    | 'mixed-signing-key'
    | 'time-went-backwards';

export type ReceiptChainResult = { ok: true } | { ok: false; index: number; reason: ReceiptChainFailure };

/**
 * Checks a run of receipts from one signing key.
 *
 * `expectedAnchor` is what the first element must link to: `null` when the window starts
 * at the key's first receipt, a hash when it continues an earlier window, `undefined` to
 * skip the check when auditing a slice without its predecessor.
 *
 * Sequence numbers must be consecutive. A gap is exactly what a withheld receipt looks
 * like, and unlike the hash link it names the missing position.
 */
export function verifyReceiptChain(
    receipts: readonly AnyBattleReceipt[],
    expectedAnchor?: Hex | null,
): ReceiptChainResult {
    const seenBattleIds = new Set<string>();
    let previousHash: Hex | null | undefined = expectedAnchor;
    let previousSequence: number | undefined;
    let previousCreatedAt: number | undefined;
    let signingKeyId: string | undefined;

    for (let index = 0; index < receipts.length; index++) {
        const receipt = receipts[index]!;

        if (signingKeyId === undefined) {
            signingKeyId = receipt.signingKeyId;
        } else if (receipt.signingKeyId !== signingKeyId) {
            // Each key has its own chain, so a mixed run is a malformed query rather
            // than evidence of tampering.
            return { ok: false, index, reason: 'mixed-signing-key' };
        }
        if (previousHash !== undefined && receipt.previousReceiptHash !== previousHash) {
            return { ok: false, index, reason: index === 0 ? 'wrong-anchor' : 'broken-link' };
        }
        if (previousSequence !== undefined && receipt.sequence !== previousSequence + 1) {
            return { ok: false, index, reason: 'sequence-not-consecutive' };
        }
        if (seenBattleIds.has(receipt.battleId)) {
            return { ok: false, index, reason: 'duplicate-battle-id' };
        }
        if (previousCreatedAt !== undefined && receipt.createdAt < previousCreatedAt) {
            return { ok: false, index, reason: 'time-went-backwards' };
        }

        seenBattleIds.add(receipt.battleId);
        previousHash = hashAnyBattleReceipt(receipt);
        previousSequence = receipt.sequence;
        previousCreatedAt = receipt.createdAt;
    }

    return { ok: true };
}

/**
 * Walks one pet's own chain.
 *
 * This is the check that makes off-chain progression auditable. A pet's level is not
 * verifiable against the chain any more, so proving it really was level 12 means
 * replaying the battles that got it there. The per-pet link is what makes that a walk
 * rather than a scan of every receipt ever issued.
 *
 * `receipts` must be that pet's battles in order, each one having the pet as attacker or
 * defender. The link followed is whichever side the pet was on.
 */
export function verifyPetReceiptChain(
    petId: bigint,
    receipts: readonly AnyBattleReceipt[],
    expectedAnchor?: Hex | null,
): ReceiptChainResult {
    let previousHash: Hex | null | undefined = expectedAnchor;

    for (let index = 0; index < receipts.length; index++) {
        const receipt = receipts[index]!;
        const link = petPreviousReceiptHash(receipt, petId);
        if (link === undefined) {
            // Asking for a pet's chain and being handed someone else's battle is a bad
            // query, reported as a broken link at the offending position.
            return { ok: false, index, reason: 'broken-link' };
        }
        if (previousHash !== undefined && link !== previousHash) {
            return { ok: false, index, reason: index === 0 ? 'wrong-anchor' : 'broken-link' };
        }
        previousHash = hashAnyBattleReceipt(receipt);
    }

    return { ok: true };
}

/** The link a given pet follows in a receipt, or undefined if the pet is not in it. */
export function petPreviousReceiptHash(receipt: AnyBattleReceipt, petId: bigint): Hex | null | undefined {
    if (isTeamBattleReceipt(receipt)) {
        // Only the six fighters are linked; a benched roster pet was not in this battle.
        const index = teamFighterIds(receipt).indexOf(petId);
        return index < 0 ? undefined : receipt.fighterPreviousReceiptHashes[index];
    }
    if (receipt.snapshot.attacker.petId === petId) {
        return receipt.attackerPreviousReceiptHash;
    }
    if (receipt.snapshot.defender.petId === petId) {
        return receipt.defenderPreviousReceiptHash;
    }
    return undefined;
}

/**
 * Receipts that contradict each other: one `battleId`, two different hashes.
 *
 * An empty result is not proof of honesty, only that these receipts do not contradict
 * each other.
 */
export function findReceiptEquivocations(receipts: readonly AnyBattleReceipt[]): string[] {
    const hashesByBattleId = new Map<string, Set<Hex>>();
    for (const receipt of receipts) {
        const hashes = hashesByBattleId.get(receipt.battleId) ?? new Set<Hex>();
        hashes.add(hashAnyBattleReceipt(receipt));
        hashesByBattleId.set(receipt.battleId, hashes);
    }
    return [...hashesByBattleId.entries()].filter(([, hashes]) => hashes.size > 1).map(([battleId]) => battleId);
}
