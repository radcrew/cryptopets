import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@config/prisma', () => ({
    prisma: {
        battleOutbox: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
            updateMany: vi.fn(),
            update: vi.fn(),
            createMany: vi.fn(),
        },
    },
}));

import { prisma } from '@config/prisma';

import {
    claimOutbox,
    completeOutbox,
    enqueueOutbox,
    failOutbox,
    listDeadLetters,
    MAX_OUTBOX_ATTEMPTS,
    nextOutboxDueAt,
    OUTBOX_TOPICS,
    retryDelaySeconds,
} from '@features/battle/ledger';
import { STALE_LOCK_MS } from '@features/battle/ledger/constants';

const NOW = new Date('2026-07-26T09:00:00.000Z');

beforeEach(() => {
    vi.clearAllMocks();
});

describe('enqueueOutbox', () => {
    it('writes through the client it is given, so it joins the caller transaction', async () => {
        // Enqueueing outside the transition's transaction is the bug this parameter exists
        // to prevent, so the client is never taken from module scope.
        const client = { battleOutbox: { createMany: vi.fn() } };
        await enqueueOutbox(client as never, [{ battleId: 'btl_1', topic: OUTBOX_TOPICS.compute }]);
        expect(client.battleOutbox.createMany).toHaveBeenCalledTimes(1);
        expect(prisma.battleOutbox.createMany).not.toHaveBeenCalled();
    });

    it('does nothing for an empty list', async () => {
        const client = { battleOutbox: { createMany: vi.fn() } };
        await enqueueOutbox(client as never, []);
        expect(client.battleOutbox.createMany).not.toHaveBeenCalled();
    });

    it('defaults the payload and leaves availableAt to the database', async () => {
        const client = { battleOutbox: { createMany: vi.fn() } };
        await enqueueOutbox(client as never, [{ battleId: 'btl_1', topic: OUTBOX_TOPICS.sign }]);
        const data = client.battleOutbox.createMany.mock.calls[0]![0].data as Record<string, unknown>[];
        expect(data[0]).toEqual({ battleId: 'btl_1', topic: 'sign', payload: {} });
    });

    it('passes an explicit availableAt through, for waiting on a beacon round', async () => {
        const client = { battleOutbox: { createMany: vi.fn() } };
        const availableAt = new Date(NOW.getTime() + 6000);
        await enqueueOutbox(client as never, [
            { battleId: 'btl_1', topic: OUTBOX_TOPICS.awaitBeacon, availableAt },
        ]);
        const data = client.battleOutbox.createMany.mock.calls[0]![0].data as Record<string, unknown>[];
        expect(data[0]!.availableAt).toBe(availableAt);
    });
});

describe('claimOutbox', () => {
    const candidate = {
        id: 'msg_1',
        battleId: 'btl_1',
        topic: 'compute',
        payload: {},
        attempts: 0,
    };

    it('claims a due message and increments its attempt count', async () => {
        vi.mocked(prisma.battleOutbox.findMany).mockResolvedValue([candidate] as never);
        vi.mocked(prisma.battleOutbox.updateMany).mockResolvedValue({ count: 1 } as never);

        const claimed = await claimOutbox([OUTBOX_TOPICS.compute], 'worker-a', 10, NOW);

        expect(claimed).toEqual([{ ...candidate, attempts: 1 }]);
        expect(vi.mocked(prisma.battleOutbox.findMany).mock.calls[0]![0]).toMatchObject({
            where: {
                processedAt: null,
                deadLetteredAt: null,
                OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(NOW.getTime() - STALE_LOCK_MS) } }],
                availableAt: { lte: NOW },
                topic: { in: ['compute'] },
            },
        });
        expect(vi.mocked(prisma.battleOutbox.updateMany).mock.calls[0]![0]).toMatchObject({
            where: { id: 'msg_1', lockedAt: null, processedAt: null },
        });
    });

    it('takes over a stale lock, guarded on the exact lock it saw', async () => {
        // A worker that died mid-message leaves its lock behind, and nothing else clears it.
        const lockedAt = new Date(NOW.getTime() - STALE_LOCK_MS - 1);
        vi.mocked(prisma.battleOutbox.findMany).mockResolvedValue([{ ...candidate, lockedAt, attempts: 1 }] as never);
        vi.mocked(prisma.battleOutbox.updateMany).mockResolvedValue({ count: 1 } as never);

        const claimed = await claimOutbox([OUTBOX_TOPICS.compute], 'worker-b', 10, NOW);

        expect(claimed).toHaveLength(1);
        // The takeover counts as an attempt, so a message that keeps killing its worker
        // still reaches the dead-letter path.
        expect(claimed[0]!.attempts).toBe(2);
        expect(vi.mocked(prisma.battleOutbox.updateMany).mock.calls[0]![0]).toMatchObject({
            where: { id: 'msg_1', lockedAt, processedAt: null },
            data: { lockedAt: NOW, lockedBy: 'worker-b' },
        });
    });

    it('does not claim a message another worker already locked', async () => {
        // The update is guarded on lockedAt: null, so the loser of the race updates zero
        // rows and simply does not get the message.
        vi.mocked(prisma.battleOutbox.findMany).mockResolvedValue([candidate] as never);
        vi.mocked(prisma.battleOutbox.updateMany).mockResolvedValue({ count: 0 } as never);

        expect(await claimOutbox([OUTBOX_TOPICS.compute], 'worker-b', 10, NOW)).toEqual([]);
    });

    it('claims oldest-due first', async () => {
        vi.mocked(prisma.battleOutbox.findMany).mockResolvedValue([] as never);
        await claimOutbox([OUTBOX_TOPICS.compute], 'worker-a', 5, NOW);
        expect(vi.mocked(prisma.battleOutbox.findMany).mock.calls[0]![0]).toMatchObject({
            orderBy: { availableAt: 'asc' },
            take: 5,
        });
    });
});

describe('nextOutboxDueAt', () => {
    it('returns when the earliest unlocked message becomes due', async () => {
        const availableAt = new Date(NOW.getTime() + 4_000);
        vi.mocked(prisma.battleOutbox.findFirst).mockResolvedValue({ availableAt } as never);

        expect(await nextOutboxDueAt([OUTBOX_TOPICS.awaitBeacon])).toBe(availableAt);
        expect(vi.mocked(prisma.battleOutbox.findFirst).mock.calls[0]![0]).toMatchObject({
            where: { processedAt: null, deadLetteredAt: null, lockedAt: null, topic: { in: [OUTBOX_TOPICS.awaitBeacon] } },
            orderBy: { availableAt: 'asc' },
        });
    });

    it('returns null when nothing is waiting', async () => {
        vi.mocked(prisma.battleOutbox.findFirst).mockResolvedValue(null);
        expect(await nextOutboxDueAt([OUTBOX_TOPICS.compute])).toBeNull();
    });
});

describe('failOutbox', () => {
    it('schedules a backed-off retry while attempts remain', async () => {
        const result = await failOutbox({ id: 'msg_1', attempts: 3 }, 'beacon fetch failed', NOW);

        expect(result.deadLettered).toBe(false);
        expect(result.retryAt).toEqual(new Date(NOW.getTime() + retryDelaySeconds(3) * 1000));
        const data = vi.mocked(prisma.battleOutbox.update).mock.calls[0]![0].data as Record<string, unknown>;
        expect(data).toMatchObject({ lockedAt: null, lastError: 'beacon fetch failed' });
        expect(data.deadLetteredAt).toBeUndefined();
    });

    it('dead-letters once attempts are exhausted', async () => {
        const result = await failOutbox({ id: 'msg_1', attempts: MAX_OUTBOX_ATTEMPTS }, 'still failing', NOW);

        expect(result).toEqual({ deadLettered: true, retryAt: null });
        const data = vi.mocked(prisma.battleOutbox.update).mock.calls[0]![0].data as Record<string, unknown>;
        expect(data.deadLetteredAt).toBe(NOW);
    });

    it('backs off exponentially and then caps', async () => {
        // Matters most during a drand outage, where the right behaviour is to keep retrying
        // the same round rather than give up on it.
        expect(retryDelaySeconds(1)).toBe(2);
        expect(retryDelaySeconds(2)).toBe(4);
        expect(retryDelaySeconds(3)).toBe(8);
        expect(retryDelaySeconds(20)).toBe(300);
    });
});

describe('completeOutbox', () => {
    it('marks the message processed and clears the lock', async () => {
        await completeOutbox('msg_1', NOW);
        expect(vi.mocked(prisma.battleOutbox.update).mock.calls[0]![0].data).toEqual({
            processedAt: NOW,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
        });
    });
});

describe('listDeadLetters', () => {
    it('surfaces dead letters newest first, for the alert rather than a retry loop', async () => {
        vi.mocked(prisma.battleOutbox.findMany).mockResolvedValue([
            { id: 'msg_9', battleId: 'btl_9', topic: 'sign', payload: {}, attempts: 8 },
        ] as never);

        const rows = await listDeadLetters();

        expect(rows).toEqual([{ id: 'msg_9', battleId: 'btl_9', topic: 'sign', payload: {}, attempts: 8 }]);
        expect(vi.mocked(prisma.battleOutbox.findMany).mock.calls[0]![0]).toMatchObject({
            where: { deadLetteredAt: { not: null } },
            orderBy: { deadLetteredAt: 'desc' },
        });
    });
});
