import type { Prisma } from '@generated/prisma/client';

import { prisma } from '@config/prisma';

import { MAX_OUTBOX_ATTEMPTS, OUTBOX_TOPICS, STALE_LOCK_MS } from './constants';

/**
 * Transactional outbox for the battle workflow (§J).
 *
 * A state transition and the message scheduling whatever comes next are written in one
 * transaction, so a crash between them is impossible. Without that, a battle can end up
 * `committed` with nobody waiting for its beacon: not lost exactly, but stalled until
 * someone notices, which for a player is the same thing.
 *
 * Delivery is at least once, never exactly once. Handlers therefore have to be idempotent,
 * which is what `classifyTransition`'s `noop` case is for.
 */

export type OutboxTopic = (typeof OUTBOX_TOPICS)[keyof typeof OUTBOX_TOPICS];

/** First retry delay; doubles each attempt up to the cap. */
const BASE_RETRY_SECONDS = 2;
const MAX_RETRY_SECONDS = 300;

/** A message ready to be enqueued. */
export interface OutboxMessage {
    battleId: string;
    topic: OutboxTopic;
    payload?: Prisma.InputJsonValue;
    /** Earliest time a worker may claim it. Used to wait for a round rather than spin. */
    availableAt?: Date;
}

/** A claimed message, handed to a worker. */
export interface ClaimedMessage {
    id: string;
    battleId: string;
    topic: string;
    payload: Prisma.JsonValue;
    attempts: number;
}

/** Minimal surface both `prisma` and a `$transaction` client satisfy. */
export type OutboxClient = Pick<Prisma.TransactionClient, 'battleOutbox'>;

/**
 * Enqueues messages. Takes a client so it can join the caller's transaction: enqueueing
 * outside the transition's transaction is the bug this parameter exists to prevent.
 */
export async function enqueueOutbox(client: OutboxClient, messages: readonly OutboxMessage[]): Promise<void> {
    if (messages.length === 0) {
        return;
    }
    await client.battleOutbox.createMany({
        data: messages.map((message) => ({
            battleId: message.battleId,
            topic: message.topic,
            payload: message.payload ?? {},
            ...(message.availableAt ? { availableAt: message.availableAt } : {}),
        })),
    });
}

/**
 * Claims up to `limit` due messages for `workerId`.
 *
 * Claiming is a two-step read-then-update rather than a single `SELECT ... FOR UPDATE
 * SKIP LOCKED`, because Prisma cannot express the latter without raw SQL. The update is
 * guarded on the `lockedAt` value the read saw, so two workers racing for one message
 * means one of them updates zero rows and simply does not get it. That is safe precisely
 * because handlers are idempotent; if they were not, this would need the raw query.
 *
 * A lock older than `STALE_LOCK_MS` is taken over. Its worker died mid-message, which a
 * serverless host does routinely when a function hits its time limit, and nothing else
 * ever clears a lock: without this, that battle would never move again. No handler holds
 * a lock for long, since waiting on a beacon reschedules the message rather than blocking.
 * A takeover counts as an attempt, so a message that keeps killing its worker still ends
 * in the dead-letter path.
 */
export async function claimOutbox(
    topics: readonly OutboxTopic[],
    workerId: string,
    limit: number,
    now: Date,
): Promise<ClaimedMessage[]> {
    const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
    const candidates = await prisma.battleOutbox.findMany({
        where: {
            processedAt: null,
            deadLetteredAt: null,
            OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
            availableAt: { lte: now },
            topic: { in: [...topics] },
        },
        orderBy: { availableAt: 'asc' },
        take: limit,
    });

    const claimed: ClaimedMessage[] = [];
    for (const candidate of candidates) {
        const { count } = await prisma.battleOutbox.updateMany({
            where: { id: candidate.id, lockedAt: candidate.lockedAt ?? null, processedAt: null },
            data: { lockedAt: now, lockedBy: workerId, attempts: { increment: 1 } },
        });
        if (count === 1) {
            claimed.push({
                id: candidate.id,
                battleId: candidate.battleId,
                topic: candidate.topic,
                payload: candidate.payload,
                attempts: candidate.attempts + 1,
            });
        }
    }
    return claimed;
}

/**
 * When the next unlocked message for these topics becomes due, or null if none is waiting.
 * Lets a worker that runs per request wait out a short gap, such as a drand round a few
 * seconds away, instead of stopping and leaving the battle for a later request.
 */
export async function nextOutboxDueAt(topics: readonly OutboxTopic[]): Promise<Date | null> {
    const next = await prisma.battleOutbox.findFirst({
        where: { processedAt: null, deadLetteredAt: null, lockedAt: null, topic: { in: [...topics] } },
        orderBy: { availableAt: 'asc' },
        select: { availableAt: true },
    });
    return next?.availableAt ?? null;
}

/** Marks a message done. */
export async function completeOutbox(id: string, now: Date): Promise<void> {
    await prisma.battleOutbox.update({
        where: { id },
        data: { processedAt: now, lockedAt: null, lockedBy: null, lastError: null },
    });
}

/**
 * Records a failure and either schedules a retry or dead-letters the message.
 *
 * Dead-lettering is an incident, not a dropped job: the battle is stuck in a non-terminal
 * state and something has to look at it. The backoff is exponential and capped, which
 * matters most for `await-beacon` during a drand outage, where the right behaviour is to
 * keep retrying the *same* round rather than give up on it (§E).
 */
export async function failOutbox(
    message: Pick<ClaimedMessage, 'id' | 'attempts'>,
    error: string,
    now: Date,
): Promise<{ deadLettered: boolean; retryAt: Date | null }> {
    if (message.attempts >= MAX_OUTBOX_ATTEMPTS) {
        await prisma.battleOutbox.update({
            where: { id: message.id },
            data: { deadLetteredAt: now, lockedAt: null, lockedBy: null, lastError: error },
        });
        return { deadLettered: true, retryAt: null };
    }
    const retryAt = new Date(now.getTime() + retryDelaySeconds(message.attempts) * 1000);
    await prisma.battleOutbox.update({
        where: { id: message.id },
        data: { lockedAt: null, lockedBy: null, lastError: error, availableAt: retryAt },
    });
    return { deadLettered: false, retryAt };
}

/**
 * Reschedules a message without treating the wait as a failure.
 *
 * Waiting for a drand round to publish is the expected, common case for `await-beacon`, not an
 * error: `failOutbox`'s exponential backoff and eventual dead-lettering exist for something
 * actually going wrong, and applying them here would dead-letter a perfectly healthy battle
 * just because its committed round has not arrived yet. `attempts` and `lastError` are left
 * untouched, so a genuine failure later still starts its own backoff from zero.
 */
export async function rescheduleOutbox(id: string, availableAt: Date): Promise<void> {
    await prisma.battleOutbox.update({
        where: { id },
        data: { availableAt, lockedAt: null, lockedBy: null },
    });
}

/** Exponential backoff in seconds for the nth attempt (1-based), capped. */
export function retryDelaySeconds(attempts: number): number {
    const delay = BASE_RETRY_SECONDS * 2 ** Math.max(0, attempts - 1);
    return Math.min(delay, MAX_RETRY_SECONDS);
}

/**
 * Messages that failed permanently. Surfaced for the §J alert rather than for a retry
 * loop: a dead letter means a human decides what happens to that battle.
 */
export async function listDeadLetters(limit = 100): Promise<ClaimedMessage[]> {
    const rows = await prisma.battleOutbox.findMany({
        where: { deadLetteredAt: { not: null } },
        orderBy: { deadLetteredAt: 'desc' },
        take: limit,
    });
    return rows.map((row) => ({
        id: row.id,
        battleId: row.battleId,
        topic: row.topic,
        payload: row.payload,
        attempts: row.attempts,
    }));
}

/**
 * Puts a dead-lettered message back in the queue, once a human has decided it should run
 * again.
 *
 * The deliberate counterpart to `listDeadLetters`: dead-lettering is not automatic retry
 * exhaustion to be undone by a cron, it is a battle parked for a person to look at, and this
 * is what that person calls after fixing whatever parked it. `attempts` resets so the
 * backoff starts fresh rather than dead-lettering again on the first hiccup.
 *
 * `lastError` is deliberately left in place. It is the record of why this message died, and
 * a requeue is not evidence that the cause is gone — the next genuine failure overwrites it
 * anyway.
 *
 * Returns false when the id is unknown or was never dead-lettered, so a mistyped id during
 * an incident reads as "nothing happened" instead of silently succeeding.
 */
export async function requeueDeadLetter(id: string, now: Date): Promise<boolean> {
    const { count } = await prisma.battleOutbox.updateMany({
        where: { id, deadLetteredAt: { not: null } },
        data: { deadLetteredAt: null, attempts: 0, lockedAt: null, lockedBy: null, availableAt: now },
    });
    return count > 0;
}
