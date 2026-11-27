import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@config/env', () => ({
    env: { battle: { workerBatchSize: 10, workerPollIntervalMs: 2000 } },
}));

vi.mock('@features/battle/ledger', () => ({
    claimOutbox: vi.fn(),
    failOutbox: vi.fn(),
    abandonBattle: vi.fn(),
    expireOrphanedAccepts: vi.fn(),
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

import { abandonBattle, claimOutbox, failOutbox } from '@features/battle/ledger';
import { processAwaitBeaconMessage } from '@features/battle/worker/beacon.worker';
import { processComputeMessage } from '@features/battle/worker/compute.worker';
import { processVerifyMessage } from '@features/battle/worker/verify.worker';
import { runBattleWorkerOnce, startBattleWorker } from '@features/battle/worker/runner';

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

describe('startBattleWorker', () => {
    const message = (id: string) => ({ id, battleId: 'btl_1', topic: 'compute', payload: {}, attempts: 1 });

    /** Advances fake time in small steps, letting each pass's awaits finish between them. */
    const runFor = async (ms: number) => {
        for (let elapsed = 0; elapsed < ms; elapsed += 50) {
            await vi.advanceTimersByTimeAsync(50);
            for (let i = 0; i < 20; i++) await Promise.resolve();
        }
    };

    it("runs the next pass at once after one that did work, so a battle's next step does not wait out the interval", async () => {
        vi.useFakeTimers();
        const worker = startBattleWorker('w');
        try {
            const start = Date.now();
            const passesAt: number[] = [];
            const work = [[message('m1')], [message('m2')]];
            vi.mocked(claimOutbox).mockImplementation(async () => {
                passesAt.push(Date.now() - start);
                return work.shift() ?? [];
            });

            await runFor(4100);
            // The first pass waits one interval. The two that follow work start at once (Node
            // clamps a zero delay to 1 ms), and the pass after an idle one waits a full interval.
            expect(passesAt).toEqual([2000, 2001, 2002, 4002]);
        } finally {
            worker.stop();
            vi.useRealTimers();
        }
    });

    it('never starts a pass while the previous one is still running, and stops when asked', async () => {
        vi.useFakeTimers();
        const worker = startBattleWorker('w');
        try {
            let finish: (messages: never[]) => void = () => {};
            vi.mocked(claimOutbox)
                .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve as never)))
                .mockResolvedValue([]);

            await runFor(12_000); // a slow database: the first pass is still out
            expect(claimOutbox).toHaveBeenCalledTimes(1);
            finish([]);
            await runFor(2100);
            expect(claimOutbox).toHaveBeenCalledTimes(2);

            worker.stop();
            await runFor(6000);
            expect(claimOutbox).toHaveBeenCalledTimes(2);
        } finally {
            worker.stop();
            vi.useRealTimers();
        }
    });
});

