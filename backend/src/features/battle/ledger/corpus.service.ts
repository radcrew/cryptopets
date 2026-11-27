import { normalizeAccount } from '@cryptopets/protocol';

import { prisma } from '@config/prisma';

/**
 * The public receipt corpus (§H item 3): paginated export by pet, by wallet, and
 * by signing-key sequence range, with no authentication.
 *
 * "No special access" is the point. §H's whole argument is that anyone can take
 * a receipt and redo the fight, and that only holds if anyone can also *get*
 * the receipts in the first place — a corpus that needed an API key or a
 * relationship with us would quietly become a corpus only we (and whoever we
 * chose) could use to check our own homework.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampLimit(limit: number | undefined): number {
    if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.trunc(limit), MAX_LIMIT);
}

export interface ReceiptSummary {
    receiptHash: string;
    battleId: string;
    chainId: string;
    deploymentId: string;
    /** Null on a team receipt, whose six fighters are in `payload`. */
    attackerPetId: string | null;
    /** Null on a team receipt, whose six fighters are in `payload`. */
    defenderPetId: string | null;
    signingKeyId: string;
    sequence: string;
    previousReceiptHash: string | null;
    attackerPreviousReceiptHash: string | null;
    defenderPreviousReceiptHash: string | null;
    payload: unknown;
    signature: string;
    createdAt: number;
}

function toSummary(row: {
    receiptHash: string;
    battleId: string;
    chainId: string;
    deploymentId: string;
    attackerPetId: string | null;
    defenderPetId: string | null;
    signingKeyId: string;
    sequence: bigint;
    previousReceiptHash: string | null;
    attackerPreviousReceiptHash: string | null;
    defenderPreviousReceiptHash: string | null;
    payload: unknown;
    signature: string;
    createdAt: bigint;
}): ReceiptSummary {
    return {
        receiptHash: row.receiptHash,
        battleId: row.battleId,
        chainId: row.chainId,
        deploymentId: row.deploymentId,
        attackerPetId: row.attackerPetId,
        defenderPetId: row.defenderPetId,
        signingKeyId: row.signingKeyId,
        sequence: row.sequence.toString(),
        previousReceiptHash: row.previousReceiptHash,
        attackerPreviousReceiptHash: row.attackerPreviousReceiptHash,
        defenderPreviousReceiptHash: row.defenderPreviousReceiptHash,
        payload: row.payload,
        signature: row.signature,
        createdAt: Number(row.createdAt),
    };
}

export interface CursorPage {
    receipts: ReceiptSummary[];
    /** Pass as `cursor` to fetch the next page; null once there are no more rows. */
    nextCursor: string | null;
}

/**
 * A page of receipts involving one pet, oldest first.
 *
 * Ordered by `(createdAt, receiptHash)` rather than just `createdAt`, because two
 * receipts can share a `createdAt` (concurrent battles resolving in the same
 * second) and an order that isn't fully deterministic makes cursor pagination
 * silently skip or repeat rows at the boundary between pages.
 */
export async function listReceiptsByPet(
    chainId: string,
    petId: string,
    cursor?: string,
    limit?: number,
): Promise<CursorPage> {
    const take = clampLimit(limit);
    const rows = await prisma.battleReceipt.findMany({
        // A team receipt names its fighters in battle_receipt_fighter rather than the two duel
        // columns, so a pet's team battles are found there.
        where: {
            chainId,
            OR: [{ attackerPetId: petId }, { defenderPetId: petId }, { fighters: { some: { chainId, petId } } }],
        },
        orderBy: [{ createdAt: 'asc' }, { receiptHash: 'asc' }],
        ...(cursor ? { cursor: { receiptHash: cursor }, skip: 1 } : {}),
        take,
    });
    return paginate(rows, take);
}

/** Oldest first is the export order; newest first serves a player's own recent battles. */
export type ReceiptOrder = 'asc' | 'desc';

/**
 * A page of receipts where the given wallet was either side of the battle.
 *
 * The receipt table itself has no owner column (only pet ids); ownership lives
 * on `battle_ledger`, joined through the relation. Matched case-insensitively
 * rather than assuming a stored casing convention, since the same wallet can
 * arrive here checksummed or lowercased depending on which path wrote it.
 *
 * `order` flips both sort keys together, so the order stays total and the cursor walks
 * newest first as reliably as it walks oldest first.
 */
export async function listReceiptsByWallet(
    wallet: string,
    cursor?: string,
    limit?: number,
    order: ReceiptOrder = 'asc',
): Promise<CursorPage> {
    const normalized = normalizeAccount(wallet);
    const take = clampLimit(limit);
    const rows = await prisma.battleReceipt.findMany({
        where: {
            battle: {
                OR: [
                    { attackerOwner: { equals: normalized, mode: 'insensitive' } },
                    { defenderOwner: { equals: normalized, mode: 'insensitive' } },
                ],
            },
        },
        orderBy: [{ createdAt: order }, { receiptHash: order }],
        ...(cursor ? { cursor: { receiptHash: cursor }, skip: 1 } : {}),
        take,
    });
    return paginate(rows, take);
}

export interface SequencePage {
    receipts: ReceiptSummary[];
    /** Pass as `after` to fetch the next page; null once there are no more rows. */
    nextAfter: string | null;
}

/**
 * A page of receipts under one signing key, ordered by `sequence` — the exact
 * order the global hash chain requires (§G): receipt N's `previousReceiptHash`
 * is receipt N-1's hash under this same key, so walking the chain means walking
 * this endpoint's pages in order, not the pet/wallet views above (which can mix
 * receipts from different keys with no single chain between them).
 */
export async function listReceiptsBySequence(
    signingKeyId: string,
    afterSequence?: string,
    limit?: number,
): Promise<SequencePage> {
    const take = clampLimit(limit);
    const rows = await prisma.battleReceipt.findMany({
        where: {
            signingKeyId,
            ...(afterSequence !== undefined ? { sequence: { gt: BigInt(afterSequence) } } : {}),
        },
        orderBy: { sequence: 'asc' },
        take,
    });
    const receipts = rows.map(toSummary);
    // A short page (fewer rows than requested) means the result set is exhausted;
    // signalling "more" in that case would send a client back for one guaranteed-
    // empty extra round trip on every single export.
    const exhausted = receipts.length < take;
    return { receipts, nextAfter: exhausted ? null : (receipts[receipts.length - 1]?.sequence ?? null) };
}

function paginate(rows: Parameters<typeof toSummary>[0][], take: number): CursorPage {
    const receipts = rows.map(toSummary);
    const exhausted = receipts.length < take;
    return {
        receipts,
        nextCursor: exhausted ? null : (receipts[receipts.length - 1]?.receiptHash ?? null),
    };
}
