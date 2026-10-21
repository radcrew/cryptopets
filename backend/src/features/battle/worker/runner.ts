import { env } from '@config/env';
import {
    abandonBattle,
    type ClaimedMessage,
    claimOutbox,
    expireOrphanedAccepts,
    failOutbox,
    nextOutboxDueAt,
    OUTBOX_TOPICS,
} from '@features/battle/ledger';

import { processAwaitBeaconMessage } from './beacon.worker';
import { processComputeMessage } from './compute.worker';
import { processPublishMessage } from './publish.worker';
import { processSignMessage } from './sign.worker';
import { processVerifyMessage } from './verify.worker';

/**
 * Dispatches claimed outbox messages to their handler.
 *
 * A handler that throws is a real failure — a network exception, a database error, a
 * programming bug — and goes through `failOutbox`'s backoff-then-dead-letter path. A handler
 * that returns normally is expected to have already called `completeOutbox`,
 * `rescheduleOutbox`, or `applyTransition` itself; the dispatcher does not call
 * `completeOutbox` a second time; a handler that does neither leaves the message claimed and
 * is a bug in that handler, not something this loop papers over.
 */
const HANDLERS: Record<string, (message: ClaimedMessage, nowSeconds: number) => Promise<void>> = {
    [OUTBOX_TOPICS.awaitBeacon]: processAwaitBeaconMessage,
    [OUTBOX_TOPICS.compute]: processComputeMessage,
    [OUTBOX_TOPICS.verify]: processVerifyMessage,
    [OUTBOX_TOPICS.sign]: processSignMessage,
    [OUTBOX_TOPICS.publish]: processPublishMessage,
};

/** One poll: claims due messages for the topics this worker owns and processes each in turn. */
export async function runBattleWorkerOnce(workerId: string, now: Date = new Date()): Promise<{ processed: number }> {
    const topics = Object.keys(HANDLERS) as (typeof OUTBOX_TOPICS)[keyof typeof OUTBOX_TOPICS][];
    const messages = await claimOutbox(topics, workerId, env.battle.workerBatchSize, now);
    const nowSeconds = Math.floor(now.getTime() / 1000);

    // Frees pets held by a battle that never left `accepted`. Nothing else can: the
    // dead-letter path declines because `accepted` cannot forfeit, so without this the lock
    // is permanent and the pet simply stops being able to battle, with no state anywhere
    // saying why. Failures here must not stop the dispatch below, which is the loop's job.
    try {
        await expireOrphanedAccepts(nowSeconds);
    } catch (error) {
        console.error('[battle-worker] could not expire orphaned accepts:', error);
    }

    for (const message of messages) {
        const handler = HANDLERS[message.topic];
        if (!handler) {
            // Claimed a topic this process does not know how to run. That is a deployment or
            // routing bug, not a transient failure, but dead-lettering it immediately is safer
            // than leaving it claimed forever with nothing to process it.
            await giveUp(message, `no handler for topic ${message.topic}`, now);
            continue;
        }
        try {
            await handler(message, nowSeconds);
        } catch (error) {
            await giveUp(message, (error as Error).message, now);
        }
    }

    return { processed: messages.length };
}

/**
 * Records the failure, and ends the battle if that was the last attempt.
 *
 * A dead letter used to stop at the message: the battle stayed in whatever non-terminal
 * state it was in, and since locks are freed by reaching a terminal state, both its pets
 * were left unable to battle again with nothing saying why. `abandonBattle` closes that,
 * and declines where the state machine has no legal way to forfeit — the dead letter is
 * still listed for a human in either case.
 */
async function giveUp(message: ClaimedMessage, error: string, now: Date): Promise<void> {
    const { deadLettered } = await failOutbox(message, error, now);
    if (!deadLettered) return;

    const { abandoned, state } = await abandonBattle(
        message.battleId,
        `${message.topic} gave up after ${message.attempts} attempts: ${error}`,
    );
    console.error(
        `[battle-worker] ${message.topic} dead-lettered for ${message.battleId}` +
            (abandoned ? ' — battle forfeited, pets released' : ` — left in ${state ?? 'unknown'}`),
    );
}

export interface BattleWorkerHandle {
    stop(): void;
}

export interface DrainOptions {
    /** Stop starting new work after this many milliseconds. */
    budgetMs: number;
    /** Wait for the next due message only if it is at most this far away. */
    maxWaitMs?: number;
    /** Injectable for tests. */
    sleep?: (ms: number) => Promise<void>;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs the worker until nothing is left to do, for a host with no long-lived process.
 *
 * A serverless function cannot keep `startBattleWorker`'s timer alive, so it calls this
 * after a request that may have queued battle work. A battle's next step is usually only
 * seconds away (the committed drand round), so it waits for a message that is due soon
 * rather than stopping and leaving the battle for the next request. Concurrent drains are
 * safe: the outbox lock gives each message to one worker.
 */
export async function drainBattleWorker(
    workerId: string,
    { budgetMs, maxWaitMs = 8_000, sleep = sleepFor }: DrainOptions,
): Promise<{ processed: number }> {
    const topics = Object.keys(HANDLERS) as (typeof OUTBOX_TOPICS)[keyof typeof OUTBOX_TOPICS][];
    const deadline = Date.now() + budgetMs;
    let processed = 0;

    while (Date.now() < deadline) {
        const pass = await runBattleWorkerOnce(workerId);
        processed += pass.processed;
        if (pass.processed > 0) continue;

        const next = await nextOutboxDueAt(topics);
        if (!next) break;
        const wait = Math.max(next.getTime() - Date.now(), 0);
        if (wait > maxWaitMs || Date.now() + wait >= deadline) break;
        // A short floor, so a message that is due "now" but locked elsewhere is not spun on.
        await sleep(Math.max(wait, 250));
    }
    return { processed };
}

/** Starts polling on an interval. `workerId` should be unique per process for the outbox lock. */
export function startBattleWorker(workerId: string): BattleWorkerHandle {
    const timer = setInterval(() => {
        void runBattleWorkerOnce(workerId).catch((error: Error) => {
            console.error(`[battle-worker] poll failed: ${error.message}`);
        });
    }, env.battle.workerPollIntervalMs);
    return { stop: () => clearInterval(timer) };
}
