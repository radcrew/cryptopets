import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const GAME_LOGIC = '0x0000000000000000000000000000000000000001' as const;
const ENTROPY = '0x0000000000000000000000000000000000000002' as const;

let currentBlock = 100n;
type TestLog = { eventName: string; args: Record<string, unknown>; blockNumber?: bigint };
let gameLogicLiveLogs: TestLog[] = [];
let entropyLiveLogs: TestLog[] = [];

const publicClient = {
    getBlockNumber: vi.fn(async () => currentBlock),
    getBalance: vi.fn(async () => 1_000_000_000_000_000_000n), // 1 ETH, well above MIN_BALANCE_WEI
    getContractEvents: vi.fn(async (params: { address: string; eventName?: string; fromBlock: bigint; toBlock: bigint }) => {
        if (params.eventName === 'Revealed') {
            const out = entropyLiveLogs;
            entropyLiveLogs = [];
            return out;
        }
        // The one-time backfill scan uses the fixed [latestBlock - backfillBlocks, latestBlock]
        // window; every subsequent gameLogic call is the live watch's rolling window.
        if (params.fromBlock === 50n && params.toBlock === 100n) return backfillLogs;
        const out = gameLogicLiveLogs;
        gameLogicLiveLogs = [];
        return out;
    }),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'entropy') return ENTROPY;
        throw new Error(`unexpected readContract(${functionName})`);
    }),
};
const walletClient = { writeContract: vi.fn() };

let backfillLogs: TestLog[] = [];

vi.mock('viem', async () => {
    const actual = await vi.importActual<typeof import('viem')>('viem');
    return {
        ...actual,
        createPublicClient: () => publicClient,
        createWalletClient: () => walletClient,
        http: vi.fn(() => 'http-transport'),
        webSocket: vi.fn(() => 'ws-transport'),
    };
});
vi.mock('viem/accounts', () => ({
    privateKeyToAccount: () => ({ address: '0xAccount' }),
}));

const submit = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/features/settle-keeper/submitter', () => ({
    createSubmitter: () => ({ submit }),
}));

import { startKeeper, type SettleKeeperConfig } from '../../../src/features/settle-keeper/keeper';

const baseConfig: SettleKeeperConfig = {
    rpcUrl: 'http://127.0.0.1:8545',
    privateKey: '0xabc',
    chainId: 31337,
    gameLogicAddress: GAME_LOGIC,
    backfillBlocks: 50n,
    mockReveal: false,
};

/** Flush the microtask chain of any in-flight (unawaited) `void tick()` calls. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    currentBlock = 100n;
    gameLogicLiveLogs = [];
    entropyLiveLogs = [];
    backfillLogs = [];
    publicClient.getBlockNumber.mockImplementation(async () => currentBlock);
    publicClient.getBalance.mockResolvedValue(1_000_000_000_000_000_000n);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('startKeeper', () => {
    it('backfills still-pending requests on startup and attempts to settle them', async () => {
        backfillLogs = [{ eventName: 'BreedRandomnessRequested', args: { requestId: 7n } }];

        const handle = await startKeeper(baseConfig);
        await flush();

        expect(submit).toHaveBeenCalledWith('settleBreed', 7n);
        handle.stop();
    });

    it('re-attempts a still-tracked request periodically, so a transient settle failure is not permanent', async () => {
        // Mirrors the real gap this closes: the entropy watcher only ever calls trySettle
        // once per Revealed event, so if that single attempt failed transiently (RPC
        // hiccup, gas spike, momentarily low balance), nothing would retry it without
        // this sweep. A still-tracked (never untracked) request should keep getting
        // re-attempted on a timer regardless of what triggered the first attempt.
        backfillLogs = [{ eventName: 'BreedRandomnessRequested', args: { requestId: 7n } }];

        const handle = await startKeeper(baseConfig);
        await flush();
        expect(submit).toHaveBeenCalledTimes(1); // the initial backfill-triggered attempt

        await vi.advanceTimersByTimeAsync(30_000);
        expect(submit).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(submit).toHaveBeenCalledTimes(3);

        handle.stop();
    });

    it('stops re-attempting a request once it is settled (untracked)', async () => {
        backfillLogs = [{ eventName: 'BreedRandomnessRequested', args: { requestId: 7n } }];
        const handle = await startKeeper(baseConfig);
        await flush();
        submit.mockClear();

        // The settlement lands on the live watch (by us or anyone else) — untracks it.
        currentBlock = 101n;
        gameLogicLiveLogs = [{ eventName: 'BreedSettled', args: { requestId: 7n } }];
        await vi.advanceTimersByTimeAsync(4_000);
        submit.mockClear();

        await vi.advanceTimersByTimeAsync(30_000);
        expect(submit).not.toHaveBeenCalled();

        handle.stop();
    });

    it('does not resettle a backfilled request whose settlement is also in the backfill window', async () => {
        backfillLogs = [
            { eventName: 'BreedRandomnessRequested', args: { requestId: 7n } },
            { eventName: 'BreedSettled', args: { requestId: 7n } },
        ];

        const handle = await startKeeper(baseConfig);
        await flush();

        expect(submit).not.toHaveBeenCalled();
        handle.stop();
    });

    it('warns when a still-pending backfilled request sits near the oldest edge of the backfill window', async () => {
        // backfillBlocks=50n, currentBlock=100n -> window is [50n, 100n], staleness edge at 55n.
        backfillLogs = [{ eventName: 'BreedRandomnessRequested', args: { requestId: 7n }, blockNumber: 52n }];
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const handle = await startKeeper(baseConfig);
        await flush();

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('now-invisible siblings'));
        errorSpy.mockRestore();
        handle.stop();
    });

    it('does not warn when a still-pending backfilled request is well inside the backfill window', async () => {
        backfillLogs = [{ eventName: 'BreedRandomnessRequested', args: { requestId: 7n }, blockNumber: 90n }];
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const handle = await startKeeper(baseConfig);
        await flush();

        expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('now-invisible siblings'));
        errorSpy.mockRestore();
        handle.stop();
    });

    it('tracks a new request from the live watch and settles it once entropy reveals', async () => {
        const handle = await startKeeper(baseConfig);
        await flush();
        submit.mockClear();

        // A new block arrives with a fresh breed request and, in the same window, its
        // entropy reveal — mirrors the real sequence (request confirms, then some blocks
        // later Pyth's callback lands).
        currentBlock = 101n;
        gameLogicLiveLogs = [{ eventName: 'BreedRandomnessRequested', args: { requestId: 9n } }];
        entropyLiveLogs = [
            { eventName: 'Revealed', args: { caller: GAME_LOGIC, sequenceNumber: 9n, callbackFailed: false, randomNumber: '0x01' } },
        ];

        await vi.advanceTimersByTimeAsync(4_000);

        expect(submit).toHaveBeenCalledWith('settleBreed', 9n);
        handle.stop();
    });

    it('skips settling when the entropy callback failed', async () => {
        const handle = await startKeeper(baseConfig);
        await flush();
        submit.mockClear();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        currentBlock = 101n;
        gameLogicLiveLogs = [{ eventName: 'BreedRandomnessRequested', args: { requestId: 11n } }];
        entropyLiveLogs = [
            { eventName: 'Revealed', args: { caller: GAME_LOGIC, sequenceNumber: 11n, callbackFailed: true } },
        ];

        await vi.advanceTimersByTimeAsync(4_000);

        expect(submit).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('entropy callback failed'));
        errorSpy.mockRestore();
        handle.stop();
    });

    it('untracks a request once its settlement is observed on the live watch, so a later reveal is a no-op', async () => {
        backfillLogs = [{ eventName: 'BreedRandomnessRequested', args: { requestId: 7n } }];
        const handle = await startKeeper(baseConfig);
        await flush();
        submit.mockClear();

        currentBlock = 101n;
        gameLogicLiveLogs = [{ eventName: 'BreedSettled', args: { requestId: 7n } }];
        await vi.advanceTimersByTimeAsync(4_000);

        currentBlock = 102n;
        entropyLiveLogs = [
            { eventName: 'Revealed', args: { caller: GAME_LOGIC, sequenceNumber: 7n, callbackFailed: false, randomNumber: '0x01' } },
        ];
        await vi.advanceTimersByTimeAsync(4_000);

        expect(submit).not.toHaveBeenCalled();
        handle.stop();
    });

    it('stop() halts both watchers so no further polling occurs', async () => {
        const handle = await startKeeper(baseConfig);
        await flush();
        const callsBefore = publicClient.getBlockNumber.mock.calls.length;

        handle.stop();
        await vi.advanceTimersByTimeAsync(20_000);

        expect(publicClient.getBlockNumber.mock.calls.length).toBe(callsBefore);
    });

    it('starts the live watch from the backfill snapshot, not a later block, so nothing in between is skipped', async () => {
        // Simulate more blocks landing between the backfill snapshot and any later
        // getBlockNumber call the live watch makes for itself (e.g. to compute the
        // current tick's `toBlock`). The watch's *starting* cursor must stay pinned to
        // the backfill's own latestBlock+1 regardless of what a fresh call would return.
        publicClient.getBlockNumber
            .mockResolvedValueOnce(100n) // backfill's snapshot
            .mockResolvedValue(105n); // every later call sees blocks that arrived meanwhile

        const handle = await startKeeper(baseConfig);
        await flush();

        const gameLogicLiveCalls = publicClient.getContractEvents.mock.calls
            .map(([params]) => params)
            .filter((p) => p.eventName === undefined && !(p.fromBlock === 50n && p.toBlock === 100n));

        expect(gameLogicLiveCalls[0]?.fromBlock).toBe(101n);
        handle.stop();
    });

    it('keeps every eth_getLogs call inside a 200-block range', async () => {
        // Base Sepolia's public RPC rejects a wider range, and a backfill or a live poll that
        // fell behind would otherwise ask for one.
        publicClient.getBlockNumber.mockResolvedValueOnce(1_000n).mockResolvedValue(1_500n);

        const handle = await startKeeper({ ...baseConfig, backfillBlocks: 500n });
        await flush();
        await vi.advanceTimersByTimeAsync(8_000);

        const gameLogicCalls = publicClient.getContractEvents.mock.calls
            .map(([params]) => params)
            .filter((p) => p.eventName === undefined);
        for (const { fromBlock, toBlock } of gameLogicCalls) {
            expect(toBlock - fromBlock + 1n).toBeLessThanOrEqual(200n);
        }
        // The backfill covers 500..1000 in chunks, and the live poll resumes right after it,
        // one capped range per tick.
        expect(gameLogicCalls.map((p) => [p.fromBlock, p.toBlock])).toEqual([
            [500n, 699n],
            [700n, 899n],
            [900n, 1_000n],
            [1_001n, 1_200n],
            [1_201n, 1_400n],
            [1_401n, 1_500n],
        ]);
        handle.stop();
    });

    it('warns when the keeper wallet balance is below the minimum threshold', async () => {
        publicClient.getBalance.mockResolvedValue(1n); // effectively empty
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const handle = await startKeeper(baseConfig);
        await flush();

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('balance is low'));
        errorSpy.mockRestore();
        handle.stop();
    });

    it('does not warn when the keeper wallet balance is sufficient', async () => {
        publicClient.getBalance.mockResolvedValue(1_000_000_000_000_000_000n); // 1 ETH
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const handle = await startKeeper(baseConfig);
        await flush();

        expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('balance is low'));
        errorSpy.mockRestore();
        handle.stop();
    });

    it('re-checks the wallet balance periodically', async () => {
        const handle = await startKeeper(baseConfig);
        await flush();
        const callsBefore = publicClient.getBalance.mock.calls.length;

        await vi.advanceTimersByTimeAsync(10 * 60_000);

        expect(publicClient.getBalance.mock.calls.length).toBeGreaterThan(callsBefore);
        handle.stop();
    });
});
