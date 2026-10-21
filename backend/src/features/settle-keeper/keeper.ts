import {
    createPublicClient,
    createWalletClient,
    http,
    webSocket,
    type Abi,
    type Address,
    type Chain,
    type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ENTROPY_ABI, GAME_LOGIC_ABI } from './abi';
import {
    buildPendingMap,
    isSettledEvent,
    requestTypeForEvent,
    settleFunctionFor,
    type DecodedGameLogicLog,
    type TrackedRequestType,
} from './requests';
import { createSubmitter } from './submitter';

export interface SettleKeeperConfig {
    rpcUrl: string;
    privateKey: `0x${string}`;
    chainId: number;
    gameLogicAddress: Address;
    backfillBlocks: bigint;
    /** Local-dev only: also act as the Entropy provider, auto-revealing every
     *  tracked request against MockEntropy so breeds/mints actually progress
     *  without a human calling mockReveal by hand. */
    mockReveal: boolean;
}

export interface SettleKeeperHandle {
    stop(): void;
}

/** eth_getLogs range cap for the backfill scan and the live poll. Base Sepolia's public
 *  endpoint now rejects a range over 200 blocks ("eth_getLogs is limited to a 200 range").
 *  A query spans this many blocks plus one, so 199 stays inside the limit. */
const MAX_LOG_RANGE_BLOCKS = 199n;

const POLL_INTERVAL_MS = 4_000;

/** Below this, settle txs (~800k gas, see SETTLE_GAS_LIMIT) risk failing outright on an
 *  unfunded keeper wallet — nothing tops the wallet up automatically, so this is just a
 *  loud, periodic reminder to do it manually from `withdraw()` proceeds. */
const MIN_BALANCE_WEI = 20_000_000_000_000_000n; // 0.02 ETH
const BALANCE_CHECK_INTERVAL_MS = 10 * 60_000;

/** A tracked request is only ever settled once from the entropy watcher's `Revealed`
 *  handler — if that single attempt fails for a transient reason (RPC hiccup, gas spike,
 *  a momentarily low balance, a stuck/underpriced tx), nothing re-triggers it again until
 *  a restart. This periodically re-attempts every still-tracked request; submitter.submit
 *  simulates first, so retrying something not yet ready or already settled is a cheap,
 *  harmless no-op. */
const RETRY_INTERVAL_MS = 30_000;

/**
 * Drop-in replacement for viem's `publicClient.watchContractEvent` that never touches
 * eth_newFilter/eth_getFilterChanges. viem's own watcher tries to create a filter first and
 * only falls back to eth_getLogs if *creating* the filter fails — but public, load-balanced
 * RPCs (e.g. Base Sepolia's default endpoint) successfully create filters and then silently
 * lose them on a later request (a different backend node answers), which viem treats as
 * "recreate the filter and keep trying," not "fall back to getLogs." That produces an endless
 * "filter not found" retry loop that only delivers logs by luck (if a freshly recreated filter
 * happens to survive until the next poll). This sidesteps the problem entirely: it always polls
 * plain getContractEvents (eth_getLogs under the hood) on a fixed interval, tracking the
 * last-seen block itself. No filter is ever created.
 */
function pollContractEvents(
    publicClient: PublicClient,
    params: { address: Address; abi: Abi; eventName?: string },
    onLogs: (logs: DecodedGameLogicLog[]) => void,
    /** Block to start watching from. Pass the same snapshot the backfill scan used (its
     *  `latestBlock + 1n`) so there's no gap between "backfill covered up to here" and
     *  "live watch starts here" — otherwise a request landing in that gap is caught by
     *  neither. Omit to have the first tick fetch its own starting point. */
    initialFromBlock?: bigint,
): () => void {
    let stopped = false;
    let fromBlock: bigint | null = initialFromBlock ?? null;
    let inFlight = false;

    const tick = async () => {
        if (inFlight || stopped) return;
        inFlight = true;
        try {
            const latest = await publicClient.getBlockNumber();
            if (fromBlock === null) {
                fromBlock = latest + 1n; // start watching from now, backfill already covers history
                return;
            }
            if (latest < fromBlock) return;
            // Capped so a poll that fell behind catches up over several ticks, instead of
            // asking for a range the RPC rejects on every tick from then on.
            const toBlock = latest - fromBlock > MAX_LOG_RANGE_BLOCKS ? fromBlock + MAX_LOG_RANGE_BLOCKS : latest;
            const logs = await publicClient.getContractEvents({
                address: params.address,
                abi: params.abi,
                eventName: params.eventName as never,
                fromBlock,
                toBlock,
            });
            fromBlock = toBlock + 1n;
            if (!stopped && logs.length > 0) onLogs(logs);
        } catch {
            // Transient RPC error — try again next tick.
        } finally {
            inFlight = false;
        }
    };

    void tick();
    const timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

/** Starts watching for entropy-fulfilled requests and settling them. Throws if the RPC/wallet
 *  can't be reached; the caller (index.ts) decides how to handle that at boot. */
export async function startKeeper(config: SettleKeeperConfig): Promise<SettleKeeperHandle> {
    const chain: Chain = {
        id: config.chainId,
        name: `chain-${config.chainId}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
    };
    const transport = config.rpcUrl.startsWith('ws') ? webSocket(config.rpcUrl) : http(config.rpcUrl);
    const account = privateKeyToAccount(config.privateKey);

    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const submitter = createSubmitter(publicClient, walletClient, config.gameLogicAddress);
    const pending = new Map<bigint, TrackedRequestType>();

    function track(requestId: bigint, type: TrackedRequestType): void {
        pending.set(requestId, type);
    }
    function untrack(requestId: bigint): void {
        pending.delete(requestId);
    }
    function trySettle(requestId: bigint): void {
        const type = pending.get(requestId);
        if (!type) return;
        void submitter.submit(settleFunctionFor(type), requestId);
    }

    // Backfill: catch up on anything requested-but-not-settled while this keeper (or its
    // predecessor) was offline, so a restart self-heals instead of losing track.
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock > config.backfillBlocks ? latestBlock - config.backfillBlocks : 0n;
    // Chunked because many public RPCs (e.g. Base Sepolia's `sepolia.base.org`) reject
    // eth_getLogs across more than 200 blocks in one call, regardless of KEEPER_BACKFILL_BLOCKS.
    const allLogs: DecodedGameLogicLog[] = [];
    for (let start = fromBlock; start <= latestBlock; start += MAX_LOG_RANGE_BLOCKS + 1n) {
        const end = start + MAX_LOG_RANGE_BLOCKS > latestBlock ? latestBlock : start + MAX_LOG_RANGE_BLOCKS;
        allLogs.push(
            ...(await publicClient.getContractEvents({
                address: config.gameLogicAddress,
                abi: GAME_LOGIC_ABI,
                fromBlock: start,
                toBlock: end,
            })),
        );
    }
    const requestLogs = allLogs.filter((log) => requestTypeForEvent(log.eventName) !== undefined);
    const settledLogs = allLogs.filter((log) => isSettledEvent(log.eventName));
    const backfilled = buildPendingMap(requestLogs, settledLogs);
    for (const [requestId, type] of backfilled) track(requestId, type);
    console.log(
        `[settle-keeper] backfill (last ${config.backfillBlocks} blocks): ` +
            `${backfilled.size} request(s) still pending`,
    );
    for (const requestId of backfilled.keys()) trySettle(requestId);

    // fromBlock === 0n means the scan already reached genesis — nothing could have been
    // missed. Otherwise, a still-pending request whose original log sits in the oldest
    // tenth of the scanned window may have equally-old (or older) siblings that predate the
    // window entirely and would be silently dropped on the next restart — surface that now
    // rather than losing them without a trace later.
    if (fromBlock > 0n && backfilled.size > 0) {
        const stalenessEdge = fromBlock + (latestBlock - fromBlock) / 10n;
        const staleRequestIds = new Set(
            requestLogs
                .filter((log) => {
                    const requestId = log.args.requestId as bigint | undefined;
                    return requestId != null && backfilled.has(requestId)
                        && log.blockNumber != null && log.blockNumber <= stalenessEdge;
                })
                .map((log) => log.args.requestId as bigint),
        );
        if (staleRequestIds.size > 0) {
            console.error(
                `[settle-keeper] ${staleRequestIds.size} pending request(s) originated near the oldest edge ` +
                    `of the ${config.backfillBlocks}-block backfill window and may have older, now-invisible ` +
                    'siblings that a future restart would silently stop tracking — consider raising ' +
                    'KEEPER_BACKFILL_BLOCKS or investigating why they are taking this long to settle.',
            );
        }
    }

    // Live watch: new requests get tracked, settlements (by us or anyone else) get untracked.
    // Starts from the same latestBlock the backfill scan just covered up to, so nothing
    // requested in between is missed by either pass.
    const unwatchGameLogic = pollContractEvents(
        publicClient,
        { address: config.gameLogicAddress, abi: GAME_LOGIC_ABI },
        (logs) => {
            for (const log of logs) {
                const requestId = log.args.requestId as bigint | undefined;
                if (requestId == null) continue;
                if (isSettledEvent(log.eventName)) {
                    untrack(requestId);
                    continue;
                }
                const type = requestTypeForEvent(log.eventName);
                if (type) track(requestId, type);
            }
        },
        latestBlock + 1n,
    );

    const entropyAddress = (await publicClient.readContract({
        address: config.gameLogicAddress,
        abi: GAME_LOGIC_ABI,
        functionName: 'entropy',
    })) as Address;

    // Live watch: the moment entropy reveals, attempt to settle. `callbackFailed` means the
    // randomness was never stored on GameLogic's side (entropyCallback reverted) — settling
    // would revert with "Entropy not yet fulfilled", so skip it and just log.
    const unwatchEntropy = pollContractEvents(
        publicClient,
        { address: entropyAddress, abi: ENTROPY_ABI, eventName: 'Revealed' },
        (logs) => {
            for (const log of logs) {
                const caller = log.args.caller as string | undefined;
                const sequenceNumber = log.args.sequenceNumber as bigint | undefined;
                const callbackFailed = log.args.callbackFailed as boolean | undefined;
                if (caller?.toLowerCase() !== config.gameLogicAddress.toLowerCase()) continue;
                if (sequenceNumber == null) continue;
                if (callbackFailed) {
                    console.error(
                        `[settle-keeper] entropy callback failed for sequence ${sequenceNumber}; ` +
                            'randomness was not stored, skipping',
                    );
                    continue;
                }
                trySettle(sequenceNumber);
            }
        },
        latestBlock + 1n,
    );

    let unwatchMockRequests: (() => void) | undefined;
    if (config.mockReveal) {
        const provider = (await publicClient.readContract({
            address: entropyAddress,
            abi: ENTROPY_ABI,
            functionName: 'getDefaultProvider',
        })) as Address;

        unwatchMockRequests = pollContractEvents(
            publicClient,
            { address: config.gameLogicAddress, abi: GAME_LOGIC_ABI },
            (logs) => {
                for (const log of logs) {
                    const requestId = log.args.requestId as bigint | undefined;
                    if (requestId == null || !requestTypeForEvent(log.eventName)) continue;
                    const randomNumber = randomBytes32();
                    walletClient
                        .writeContract({
                            address: entropyAddress,
                            abi: ENTROPY_ABI,
                            functionName: 'mockReveal',
                            args: [provider, requestId, randomNumber],
                        })
                        .catch((err) =>
                            console.error(
                                `[settle-keeper] mockReveal(${requestId}) failed: ` +
                                    `${(err as Error).message.split('\n')[0]}`,
                            ),
                        );
                }
            },
        );
        console.log('[settle-keeper] KEEPER_MOCK_REVEAL enabled — acting as the Entropy provider (local dev only)');
    }

    console.log(`[settle-keeper] watching GameLogic ${config.gameLogicAddress} as ${account.address}`);

    async function checkBalance(): Promise<void> {
        try {
            const balance = await publicClient.getBalance({ address: account.address });
            if (balance < MIN_BALANCE_WEI) {
                console.error(
                    `[settle-keeper] wallet ${account.address} balance is low (${balance} wei, ` +
                        `min ${MIN_BALANCE_WEI} wei) — settle txs may start failing; top it up from withdraw() proceeds`,
                );
            }
        } catch (err) {
            console.error(`[settle-keeper] balance check failed: ${(err as Error).message.split('\n')[0]}`);
        }
    }
    void checkBalance();
    const balanceCheckTimer = setInterval(() => { void checkBalance(); }, BALANCE_CHECK_INTERVAL_MS);

    // See RETRY_INTERVAL_MS: re-attempts every still-tracked request on a timer, so a
    // settle that failed for a transient reason isn't stuck until the next restart.
    const retryTimer = setInterval(() => {
        for (const requestId of pending.keys()) trySettle(requestId);
    }, RETRY_INTERVAL_MS);

    return {
        stop() {
            unwatchGameLogic();
            unwatchEntropy();
            unwatchMockRequests?.();
            clearInterval(balanceCheckTimer);
            clearInterval(retryTimer);
        },
    };
}

function randomBytes32(): `0x${string}` {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return `0x${Buffer.from(bytes).toString('hex')}`;
}
