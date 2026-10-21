import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// An in-memory stand-in for the auth_nonce table. `deleteMany` supports the two filters the
// store uses: the expiry sweep (`lte`) and the single-use claim (`nonce` and `gt`).
const rows = vi.hoisted(() => new Map<string, Date>());
type Where = { nonce?: string; expiresAt: { lte?: Date; gt?: Date } };
vi.mock('@config/prisma', () => ({
    prisma: {
        authNonce: {
            create: vi.fn(async ({ data }: { data: { nonce: string; expiresAt: Date } }) => {
                rows.set(data.nonce, data.expiresAt);
                return data;
            }),
            deleteMany: vi.fn(async ({ where }: { where: Where }) => {
                let count = 0;
                for (const [nonce, expiresAt] of rows) {
                    if (where.nonce !== undefined && nonce !== where.nonce) continue;
                    if (where.expiresAt.lte && !(expiresAt <= where.expiresAt.lte)) continue;
                    if (where.expiresAt.gt && !(expiresAt > where.expiresAt.gt)) continue;
                    rows.delete(nonce);
                    count++;
                }
                return { count };
            }),
        },
    },
}));

import { storeNonce, consumeNonce } from '../../../src/features/auth/nonce.store';

const TTL_MS = 5 * 60 * 1000;

describe('nonce.store', () => {
    beforeEach(() => {
        rows.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('accepts a freshly issued nonce exactly once', async () => {
        await storeNonce('abc');
        expect(await consumeNonce('abc')).toBe(true);
    });

    it('rejects a nonce that was never issued', async () => {
        expect(await consumeNonce('never-issued')).toBe(false);
    });

    it('rejects a replay of an already-consumed nonce', async () => {
        await storeNonce('once');
        expect(await consumeNonce('once')).toBe(true);
        expect(await consumeNonce('once')).toBe(false);
    });

    it('accepts a nonce just before its TTL expires', async () => {
        await storeNonce('fresh');
        vi.advanceTimersByTime(TTL_MS - 1);
        expect(await consumeNonce('fresh')).toBe(true);
    });

    it('rejects a nonce once its TTL has elapsed', async () => {
        await storeNonce('stale');
        vi.advanceTimersByTime(TTL_MS + 1);
        expect(await consumeNonce('stale')).toBe(false);
    });

    it('never accepts an expired nonce, on any later attempt either', async () => {
        await storeNonce('expired');
        vi.advanceTimersByTime(TTL_MS + 1);
        expect(await consumeNonce('expired')).toBe(false);
        expect(await consumeNonce('expired')).toBe(false);
    });

    it('tracks multiple independent nonces', async () => {
        await storeNonce('a');
        await storeNonce('b');
        expect(await consumeNonce('b')).toBe(true);
        expect(await consumeNonce('a')).toBe(true);
        expect(await consumeNonce('a')).toBe(false);
    });

    it('purges expired entries when a new nonce is stored (lazy eviction)', async () => {
        await storeNonce('old');
        vi.advanceTimersByTime(TTL_MS + 1);
        await storeNonce('fresh2');
        expect(rows.has('old')).toBe(false);
        expect(rows.has('fresh2')).toBe(true);
    });

    it('lets only one of two concurrent attempts use a nonce', async () => {
        await storeNonce('race');
        const results = await Promise.all([consumeNonce('race'), consumeNonce('race')]);
        expect(results.sort()).toEqual([false, true]);
    });
});
