import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@config/prisma', () => ({
    prisma: { battleReceipt: { findMany: vi.fn() } },
}));

import { prisma } from '@config/prisma';
import { listReceiptsByPet, listReceiptsBySequence, listReceiptsByWallet } from '@features/battle/ledger';

function row(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        receiptHash: `0x${'11'.repeat(32)}`,
        battleId: 'btl_1',
        chainId: 'eip155:84532',
        deploymentId: 'base-sepolia-live',
        attackerPetId: '1',
        defenderPetId: '2',
        signingKeyId: 'battle-signer-2026-07',
        sequence: 1n,
        previousReceiptHash: null,
        attackerPreviousReceiptHash: null,
        defenderPreviousReceiptHash: null,
        payload: { battleId: 'btl_1' },
        signature: '0xsig',
        createdAt: 1893456000n,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('listReceiptsByPet', () => {
    it('matches a pet as either attacker or defender', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsByPet('eip155:84532', '7');
        expect(vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0]).toMatchObject({
            where: {
                chainId: 'eip155:84532',
                OR: [{ attackerPetId: '7' }, { defenderPetId: '7' }, { fighters: { some: { chainId: 'eip155:84532', petId: '7' } } }],
            },
        });
    });

    it('orders by createdAt then receiptHash, so concurrent battles in one second stay stable', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsByPet('eip155:84532', '7');
        expect(vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0]).toMatchObject({
            orderBy: [{ createdAt: 'asc' }, { receiptHash: 'asc' }],
        });
    });

    it('paginates via cursor on the primary key, not offset', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsByPet('eip155:84532', '7', `0x${'22'.repeat(32)}`, 50);
        expect(vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0]).toMatchObject({
            cursor: { receiptHash: `0x${'22'.repeat(32)}` },
            skip: 1,
            take: 50,
        });
    });

    it('omits cursor and skip on the first page', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsByPet('eip155:84532', '7');
        const call = vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0] as Record<string, unknown>;
        expect(call.cursor).toBeUndefined();
        expect(call.skip).toBeUndefined();
    });

    it('clamps a requested limit above the maximum', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsByPet('eip155:84532', '7', undefined, 10000);
        expect(vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0]).toMatchObject({ take: 500 });
    });

    it('falls back to the default limit for an invalid one', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsByPet('eip155:84532', '7', undefined, -5);
        expect(vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0]).toMatchObject({ take: 100 });
    });

    it('serializes bigint fields to strings', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([row()] as never);
        const page = await listReceiptsByPet('eip155:84532', '1');
        expect(page.receipts[0]).toMatchObject({ sequence: '1', createdAt: 1893456000 });
    });

    it('signals more pages only when the page was full', async () => {
        const full = Array.from({ length: 100 }, (_, i) => row({ receiptHash: `0x${String(i).padStart(64, '0')}` }));
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue(full as never);
        const page = await listReceiptsByPet('eip155:84532', '1');
        expect(page.nextCursor).toBe(full[99]!.receiptHash);
    });

    it('reports no more pages when the page came back short', async () => {
        // A short page means the result set is exhausted; signalling "more" here would send a
        // client back for one guaranteed-empty extra round trip on every single export.
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([row()] as never);
        const page = await listReceiptsByPet('eip155:84532', '1', undefined, 100);
        expect(page.nextCursor).toBeNull();
    });

    it('reports no more pages on an empty result', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        expect((await listReceiptsByPet('eip155:84532', '1')).nextCursor).toBeNull();
    });
});

describe('listReceiptsByWallet', () => {
    it('matches either side of the battle through the ledger relation', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsByWallet('0xABCDEF0123456789abcdef0123456789ABCDEF01');
        expect(vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0]).toMatchObject({
            where: {
                battle: {
                    OR: [
                        { attackerOwner: { equals: '0xabcdef0123456789abcdef0123456789abcdef01', mode: 'insensitive' } },
                        { defenderOwner: { equals: '0xabcdef0123456789abcdef0123456789abcdef01', mode: 'insensitive' } },
                    ],
                },
            },
        });
    });

    it('leaves a Solana base58 wallet untouched, since base58 is case-sensitive', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        const pubkey = 'DRiP2Pn2K6fuMLKQmt5rZWyHiUZ6aK3TzhBd8ZUqzTqL';
        await listReceiptsByWallet(pubkey);
        const call = vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0] as {
            where: { battle: { OR: { attackerOwner: { equals: string } }[] } };
        };
        expect(call.where.battle.OR[0]!.attackerOwner.equals).toBe(pubkey);
    });
});

describe('listReceiptsBySequence', () => {
    it('walks one signing key strictly in chain order', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsBySequence('battle-signer-2026-07');
        expect(vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0]).toMatchObject({
            where: { signingKeyId: 'battle-signer-2026-07' },
            orderBy: { sequence: 'asc' },
        });
    });

    it('filters strictly after the given sequence, matching the chain-walk contract', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsBySequence('battle-signer-2026-07', '5');
        expect(vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0]).toMatchObject({
            where: { signingKeyId: 'battle-signer-2026-07', sequence: { gt: 5n } },
        });
    });

    it('omits the sequence filter on the first page', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([]);
        await listReceiptsBySequence('battle-signer-2026-07');
        const call = vi.mocked(prisma.battleReceipt.findMany).mock.calls[0]![0] as { where: Record<string, unknown> };
        expect(call.where).not.toHaveProperty('sequence');
    });

    it('reports nextAfter as the last sequence in a full page', async () => {
        const full = Array.from({ length: 100 }, (_, i) => row({ sequence: BigInt(i + 1) }));
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue(full as never);
        const page = await listReceiptsBySequence('battle-signer-2026-07');
        expect(page.nextAfter).toBe('100');
    });

    it('reports nextAfter null once the chain is exhausted', async () => {
        vi.mocked(prisma.battleReceipt.findMany).mockResolvedValue([row({ sequence: 42n })] as never);
        const page = await listReceiptsBySequence('battle-signer-2026-07', undefined, 100);
        expect(page.nextAfter).toBeNull();
    });
});
