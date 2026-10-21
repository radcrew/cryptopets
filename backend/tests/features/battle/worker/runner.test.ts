import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@config/env', () => ({
    env: { battle: { workerBatchSize: 10, workerPollIntervalMs: 2000 } },
}));

vi.mock('@features/battle/ledger', () => ({
    claimOutbox: vi.fn(),
    failOutbox: vi.fn(),
    abandonBattle: vi.fn(),
    expireOrphanedAccepts: vi.fn(),
    nextOutboxDueAt: vi.fn(),
    // Must list every real topic. A missing one is not a smaller map — it registers as an
    // `undefined` key and the dispatcher claims a topic called "undefined".
    OUTBOX_TOPICS: {
        awaitBeacon: 'await-beacon',
        compute: 'compute',
        verify: 'verify',
        sign: 'sign',
        publish: 'publish',
    },
}));

vi.mock('@features/battle/worker/beacon.worker', () => ({
    processAwaitBeaconMessage: vi.fn(),
}));
vi.mock('@features/battle/worker/compute.worker', () => ({
    processComputeMessage: vi.fn(),
}));
vi.mock('@features/battle/worker/verify.worker', () => ({
    processVerifyMessage: vi.fn(),
}));
vi.mock('@features/battle/worker/sign.worker', () => ({
    processSignMessage: vi.fn(),
}));
vi.mock('@features/battle/worker/publish.worker', () => ({
    processPublishMessage: vi.fn(),
}));

import { abandonBattle, claimOutbox, failOutbox, nextOutboxDueAt } from '@features/battle/ledger';
import { processAwaitBeaconMessage } from '@features/battle/worker/beacon.worker';
import { processComputeMessage } from '@features/battle/worker/compute.worker';
import { processVerifyMessage } from '@features/battle/worker/verify.worker';
import { drainBattleWorker, runBattleWorkerOnce } from '@features/battle/worker/runner';

const NOW = new Date('2026-07-26T12:00:00.000Z');

beforeEach(() => {
    vi.clearAllMocks();
    // The default: a failure that still has retries left. Tests wanting the last attempt
    // override this.
    vi.mocked(failOutbox).mockResolvedValue({ deadLettered: false, retryAt: new Date(0) });
    vi.mocked(abandonBattle).mockResolvedValue({ abandoned: true, state: 'forfeited' as never });
});

describe('dispatch', () => {
    it('routes each message to its topic handler', async () => {
        vi.mocked(claimOutbox).mockResolvedValue([
            { id: 'm1', battleId: 'btl_1', topic: 'await-beacon', payload: {}, attempts: 1 },
            { id: 'm2', battleId: 'btl_2', topic: 'compute', payload: {}, attempts: 1 },
        ]);

        const result = await runBattleWorkerOnce('worker-a', NOW);

        expect(result).toEqual({ processed: 2 });
        expect(processAwaitBeaconMessage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'm1' }),
            Math.floor(NOW.getTime() / 1000),
        );
        expect(processComputeMessage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'm2' }),
            Math.floor(NOW.getTime() / 1000),
        );
    });

    it('claims only the topics this worker owns, with the configured batch size', async () => {
        vi.mocked(claimOutbox).mockResolvedValue([]);
        await runBattleWorkerOnce('worker-a', NOW);
        expect(claimOutbox).toHaveBeenCalledWith(
            ['await-beacon', 'compute', 'verify', 'sign', 'publish'],
            'worker-a',
            10,
            NOW,
        );
    });

    it('sends a real handler failure through failOutbox for backoff, not a silent swallow', async () => {
        vi.mocked(claimOutbox).mockResolvedValue([
            { id: 'm1', battleId: 'btl_1', topic: 'compute', payload: {}, attempts: 1 },
        ]);
        vi.mocked(processComputeMessage).mockRejectedValue(new Error('kms unreachable'));

        await runBattleWorkerOnce('worker-a', NOW);

        expect(failOutbox).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'm1' }),
            'kms unreachable',
            NOW,
        );
    });

    it('dead-letters a message whose topic has no handler, rather than leaving it claimed forever', async () => {
        // Unreachable while the claim list is derived from `HANDLERS` — the dispatcher can
        // only be handed a topic it registered. This pins the fallback for the day those two
        // stop being the same object (a worker claiming a topic set from config, say), since
        // the alternative is a message claimed and then silently left claimed forever.
        vi.mocked(claimOutbox).mockResolvedValue([
            { id: 'm1', battleId: 'btl_1', topic: 'reticulate-splines', payload: {}, attempts: 1 },
        ]);

        await runBattleWorkerOnce('worker-a', NOW);

        expect(failOutbox).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'm1' }),
            expect.stringContaining('no handler'),
            NOW,
        );
    });

    it('processes nothing when there is nothing due', async () => {
        vi.mocked(claimOutbox).mockResolvedValue([]);
        expect(await runBattleWorkerOnce('worker-a', NOW)).toEqual({ processed: 0 });
    });
});


describe('the end of the retry road', () => {
    const dying = (topic: string) => {
        vi.mocked(claimOutbox).mockResolvedValue([
            { id: 'm1', battleId: 'btl_1', topic, payload: {}, attempts: 8 },
        ]);
        vi.mocked(failOutbox).mockResolvedValue({ deadLettered: true, retryAt: null });
    };

    // Locks are released by reaching a terminal state, so a battle left non-terminal keeps
    // both its pets out of the game for good. This is what closes that.
    it('ends the battle when a message dead-letters, freeing its pets', async () => {
        dying('verify');
        vi.mocked(processVerifyMessage).mockRejectedValue(new Error('indexer-go unavailable'));

        await runBattleWorkerOnce('w1');

        expect(abandonBattle).toHaveBeenCalledWith(
            'btl_1',
            expect.stringContaining('verify gave up after 8 attempts'),
        );
    });

    it('leaves the battle alone while retries remain', async () => {
        vi.mocked(claimOutbox).mockResolvedValue([
            { id: 'm1', battleId: 'btl_1', topic: 'verify', payload: {}, attempts: 2 },
        ]);
        vi.mocked(processVerifyMessage).mockRejectedValue(new Error('transient'));

        await runBattleWorkerOnce('w1');

        expect(failOutbox).toHaveBeenCalled();
        expect(abandonBattle).not.toHaveBeenCalled();
    });

    it('also ends one dead-lettered for having no handler at all', async () => {
        dying('nonsense');

        await runBattleWorkerOnce('w1');

        expect(abandonBattle).toHaveBeenCalledWith('btl_1', expect.stringContaining('no handler'));
    });
});

describe('drainBattleWorker', () => {
    const message = (id: string) => ({ id, battleId: 'btl_1', topic: 'compute', payload: {}, attempts: 1 });

    it('keeps running passes while there is work, then stops when nothing is waiting', async () => {
        vi.mocked(claimOutbox)
            .mockResolvedValueOnce([message('m1')])
            .mockResolvedValueOnce([message('m2')])
            .mockResolvedValue([]);
        vi.mocked(nextOutboxDueAt).mockResolvedValue(null);
        const sleep = vi.fn(async () => {});

        const result = await drainBattleWorker('w', { budgetMs: 10_000, sleep });

        expect(result.processed).toBe(2);
        expect(processComputeMessage).toHaveBeenCalledTimes(2);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('waits for a message that is due soon, such as the committed drand round', async () => {
        vi.mocked(claimOutbox).mockResolvedValueOnce([]).mockResolvedValueOnce([message('m1')]).mockResolvedValue([]);
        vi.mocked(nextOutboxDueAt)
            .mockResolvedValueOnce(new Date(Date.now() + 3_000))
            .mockResolvedValue(null);
        const sleep = vi.fn(async () => {});

        const result = await drainBattleWorker('w', { budgetMs: 10_000, sleep });

        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep.mock.calls[0]![0]).toBeGreaterThan(2_000);
        expect(result.processed).toBe(1);
    });

    it('does not wait for a message due later than maxWaitMs', async () => {
        vi.mocked(claimOutbox).mockResolvedValue([]);
        vi.mocked(nextOutboxDueAt).mockResolvedValue(new Date(Date.now() + 60_000));
        const sleep = vi.fn(async () => {});

        await drainBattleWorker('w', { budgetMs: 10_000, maxWaitMs: 8_000, sleep });

        expect(sleep).not.toHaveBeenCalled();
    });

    it('does not wait past its budget', async () => {
        vi.mocked(claimOutbox).mockResolvedValue([]);
        vi.mocked(nextOutboxDueAt).mockResolvedValue(new Date(Date.now() + 5_000));
        const sleep = vi.fn(async () => {});

        await drainBattleWorker('w', { budgetMs: 2_000, sleep });

        expect(sleep).not.toHaveBeenCalled();
    });

    it('waits at least 250 ms for a message that is due now but locked elsewhere', async () => {
        vi.mocked(claimOutbox).mockResolvedValue([]);
        vi.mocked(nextOutboxDueAt).mockResolvedValueOnce(new Date(Date.now() - 1_000)).mockResolvedValue(null);
        const sleep = vi.fn(async () => {});

        await drainBattleWorker('w', { budgetMs: 10_000, sleep });

        expect(sleep).toHaveBeenCalledWith(250);
    });
});
