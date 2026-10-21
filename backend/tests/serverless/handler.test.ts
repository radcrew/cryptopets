import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const battle = vi.hoisted(() => ({ enabled: true }));
vi.mock('@config/env', () => ({ env: { battle } }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('@features/battle/worker', () => ({ drainBattleWorker: vi.fn() }));
vi.mock('@config/prisma', () => ({ prisma: { battleLedger: { findUnique: vi.fn() } } }));
// The real terminal-state list, without loading the whole ledger module.
vi.mock('@features/battle/ledger', async () => ({
    isTerminal: (await vi.importActual<typeof import('../../src/features/battle/ledger/state')>(
        '../../src/features/battle/ledger/state',
    )).isTerminal,
}));
vi.mock('../../src/app', () => ({ default: vi.fn() }));
vi.mock('../../src/serverless/runtime', () => ({ ensureBattleRuntime: vi.fn() }));
vi.mock('../../src/serverless/cron', () => ({ isAuthorizedCron: vi.fn(), runCronJob: vi.fn() }));

import { waitUntil } from '@vercel/functions';
import { prisma } from '@config/prisma';
import { drainBattleWorker } from '@features/battle/worker';
import app from '../../src/app';
import { isAuthorizedCron, runCronJob } from '../../src/serverless/cron';
import { ensureBattleRuntime } from '../../src/serverless/runtime';
import handler, { hasWorkerSteps, shouldDrainAfter } from '../../src/serverless/handler';

/** A response that records what was written and can be finished on demand. */
function mockRes() {
    const res = Object.assign(new EventEmitter(), {
        writableFinished: false,
        statusCode: 0,
        body: '',
        writeHead: vi.fn(function (this: { statusCode: number }, status: number) {
            this.statusCode = status;
            return res;
        }),
        end: vi.fn((body?: string) => {
            res.body = body ?? '';
        }),
    });
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
    battle.enabled = true;
});

describe('shouldDrainAfter', () => {
    it.each([
        ['POST', '/api/battle/intents/0xabc/accept'],
        ['GET', '/api/battle/btl_123'],
    ])('drains after %s %s', (method, path) => {
        expect(shouldDrainAfter(method, path)).toBe(true);
    });

    it.each([
        ['GET', '/api/battle/config'],
        ['GET', '/api/battle/signing-keys'],
        ['GET', '/api/battle/rulesets'],
        ['GET', '/api/battle/btl_123/receipt'],
        ['POST', '/api/battle/intents'],
        ['GET', '/api/health'],
        ['POST', '/api/battle/btl_123'],
    ])('does not drain after %s %s', (method, path) => {
        expect(shouldDrainAfter(method, path)).toBe(false);
    });

    it('never drains when battle mode is off', () => {
        battle.enabled = false;
        expect(shouldDrainAfter('GET', '/api/battle/btl_123')).toBe(false);
    });
});

describe('handler', () => {
    it('waits for the runtime setup, then passes the request to Express', async () => {
        const req = { method: 'GET', url: '/api/health', headers: {} };
        const res = mockRes();
        await handler(req as never, res as never);
        expect(ensureBattleRuntime).toHaveBeenCalled();
        expect(app).toHaveBeenCalledWith(req, res);
        expect(waitUntil).not.toHaveBeenCalled();
    });

    it('drains the battle queue only after the response is sent', async () => {
        vi.mocked(drainBattleWorker).mockResolvedValue({ processed: 1 });
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ state: 'seeded' } as never);
        const res = mockRes();
        await handler({ method: 'GET', url: '/api/battle/btl_1?x=1', headers: {} } as never, res as never);

        expect(waitUntil).toHaveBeenCalledTimes(1);
        expect(drainBattleWorker).not.toHaveBeenCalled();
        res.statusCode = 200;
        res.emit('finish');
        await vi.mocked(waitUntil).mock.calls[0]![0];
        expect(drainBattleWorker).toHaveBeenCalledTimes(1);
    });

    it('does not drain after a state read for a battle that does not exist', async () => {
        const res = mockRes();
        await handler({ method: 'GET', url: '/api/battle/made_up', headers: {} } as never, res as never);
        res.statusCode = 404;
        res.emit('finish');
        await vi.mocked(waitUntil).mock.calls[0]![0];

        expect(prisma.battleLedger.findUnique).not.toHaveBeenCalled();
        expect(drainBattleWorker).not.toHaveBeenCalled();
    });

    it('refuses a cron path without the secret, and never reaches Express', async () => {
        vi.mocked(isAuthorizedCron).mockReturnValue(false);
        const res = mockRes();
        await handler({ method: 'GET', url: '/api/cron/battle-worker', headers: {} } as never, res as never);
        expect(res.statusCode).toBe(401);
        expect(runCronJob).not.toHaveBeenCalled();
        expect(app).not.toHaveBeenCalled();
    });

    it('runs an authorized cron job and returns its result', async () => {
        vi.mocked(isAuthorizedCron).mockReturnValue(true);
        vi.mocked(runCronJob).mockResolvedValue({ processed: 2 });
        const res = mockRes();
        await handler(
            { method: 'GET', url: '/api/cron/battle-worker', headers: { authorization: 'Bearer s' } } as never,
            res as never,
        );
        expect(runCronJob).toHaveBeenCalledWith('/api/cron/battle-worker');
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ processed: 2 });
    });

    it('answers 404 for an authorized but unknown cron path', async () => {
        vi.mocked(isAuthorizedCron).mockReturnValue(true);
        vi.mocked(runCronJob).mockResolvedValue(null);
        const res = mockRes();
        await handler({ method: 'GET', url: '/api/cron/nope', headers: {} } as never, res as never);
        expect(res.statusCode).toBe(404);
    });
});

describe('hasWorkerSteps', () => {
    it('is false for a failed request, without touching the database', async () => {
        expect(await hasWorkerSteps('GET', '/api/battle/btl_1', 404)).toBe(false);
        expect(await hasWorkerSteps('POST', '/api/battle/intents/0xabc/accept', 409)).toBe(false);
        expect(prisma.battleLedger.findUnique).not.toHaveBeenCalled();
    });

    it('is true after a successful accept, without a lookup', async () => {
        expect(await hasWorkerSteps('POST', '/api/battle/intents/0xabc/accept', 201)).toBe(true);
        expect(prisma.battleLedger.findUnique).not.toHaveBeenCalled();
    });

    it.each(['accepted', 'committed', 'seeded', 'computed', 'verified', 'signed'])(
        'is true for a battle in state %s',
        async (state) => {
            vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ state } as never);
            expect(await hasWorkerSteps('GET', '/api/battle/btl_1', 200)).toBe(true);
        },
    );

    it.each(['published', 'batched', 'rejected', 'expired', 'verification_failed', 'signing_failed', 'forfeited'])(
        'is false for a battle in state %s',
        async (state) => {
            vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ state } as never);
            expect(await hasWorkerSteps('GET', '/api/battle/btl_1', 200)).toBe(false);
        },
    );

    it('looks the battle up by the id in the path', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(null);
        expect(await hasWorkerSteps('GET', '/api/battle/btl%3A1', 200)).toBe(false);
        expect(prisma.battleLedger.findUnique).toHaveBeenCalledWith({ where: { battleId: 'btl:1' }, select: { state: true } });
    });

    it('is false for a path with broken percent-encoding', async () => {
        expect(await hasWorkerSteps('GET', '/api/battle/%E0%A4%A', 200)).toBe(false);
        expect(prisma.battleLedger.findUnique).not.toHaveBeenCalled();
    });
});
