import { BattleState } from '@generated/prisma/enums';
import type { Prisma } from '@generated/prisma/client';

import { prisma } from '@config/prisma';

import { OPEN_BATTLE_REFUSALS } from './constants';
import { enqueueOutbox, type OutboxMessage } from './outbox';
import {
    canForfeitFrom,
    classifyTransition,
    IllegalTransitionError,
    shouldReleaseLocks,
} from './state';

/**
 * Transactional state transitions for the battle ledger (§J).
 *
 * Every transition here does three things in one transaction: move the state, write the
 * fields that move with it, and enqueue the outbox message for whatever comes next. If any
 * of those can happen without the others, a battle can end up advanced with nothing
 * scheduled, or scheduled twice.
 *
 * Concurrency is handled by guarding the update on the expected current state rather than
 * by reading first and hoping. Two workers racing on the same transition means one updates
 * zero rows, which is reported as a no-op, not an error: the work was done, just not by
 * this caller.
 */

/** Fields a transition may write alongside the state change. */
export type BattleLedgerPatch = Omit<Prisma.BattleLedgerUncheckedUpdateInput, 'state' | 'battleId'>;

export interface TransitionRequest {
    battleId: string;
    /** The state the caller believes the battle is in. */
    from: BattleState;
    to: BattleState;
    /** Columns to write as part of the same transaction. */
    patch?: BattleLedgerPatch;
    /** Messages to enqueue atomically with the transition. */
    outbox?: readonly OutboxMessage[];
    /**
     * Extra work to run in the same transaction, after the state guard succeeds and before
     * the outbox write. For a transition that also creates a related row — the accept flow's
     * `accepted` -> `committed` move creates the `BattleCommitment` row alongside it — so that
     * row cannot exist without the state change that produced it, or vice versa.
     */
    onApplied?: (tx: Prisma.TransactionClient) => Promise<void>;
}

export interface TransitionResult {
    /** False when the battle was already in the target state, or another worker got there first. */
    applied: boolean;
    state: BattleState;
}

/**
 * Applies one transition.
 *
 * Throws `IllegalTransitionError` for a move the state machine does not allow, which is a
 * bug rather than a race. Returns `applied: false` for a retry or a lost race, which is
 * normal under at-least-once delivery.
 */
export async function applyTransition(request: TransitionRequest): Promise<TransitionResult> {
    const kind = classifyTransition(request.from, request.to);
    if (kind === 'illegal') {
        throw new IllegalTransitionError(request.battleId, request.from, request.to);
    }
    if (kind === 'noop') {
        return { applied: false, state: request.to };
    }

    return prisma.$transaction(
        async (tx) => {
            const { count } = await tx.battleLedger.updateMany({
                // The guard is the concurrency control: only the caller that finds the
                // battle in `from` gets to move it.
                where: { battleId: request.battleId, state: request.from },
                data: { ...(request.patch ?? {}), state: request.to },
            });
            if (count === 0) {
                const current = await tx.battleLedger.findUnique({
                    where: { battleId: request.battleId },
                    select: { state: true },
                });
                if (!current) {
                    throw new Error(`battle ${request.battleId} does not exist`);
                }
                // Someone else advanced it, or it was never in `from`. Either way this
                // caller has nothing to do; the state it reports is the truth.
                return { applied: false, state: current.state };
            }

            if (request.onApplied) {
                await request.onApplied(tx);
            }
            if (request.outbox && request.outbox.length > 0) {
                await enqueueOutbox(tx, request.outbox);
            }
            if (shouldReleaseLocks(request.to)) {
                // Terminal states free both pets. Doing it here rather than in a follow-up
                // job means a pet cannot stay locked because a cleanup message was lost.
                await tx.petBattleLock.deleteMany({ where: { battleId: request.battleId } });
            }

            return { applied: true, state: request.to };
        },
        { isolationLevel: 'Serializable' },
    );
}

/** What opening a battle needs, beyond the ledger row's own columns. */
export interface OpenBattleRequest {
    ledger: Prisma.BattleLedgerUncheckedCreateInput;
    /** Pet ids to lock for the duration, as decimal strings. */
    petIds: readonly string[];
    outbox?: readonly OutboxMessage[];
    /**
     * Marks the originating intent consumed in the same transaction, guarded on it not
     * already being consumed. Two accept calls racing on one intent must not both succeed:
     * whichever loses this guard gets `intentAlreadyConsumed`, never a second ledger row.
     */
    consumeIntentHash?: string;
    /**
     * The progress each pet's snapshot was built from, rechecked after the locks are taken.
     *
     * The snapshot is read before this transaction, so a pet still finishing another battle
     * can be photographed mid-way: its lock is released when that battle signs, this
     * transaction then takes the lock, and the snapshot holds progress from before that
     * battle. Fighting on it would skip that battle's cooldown, and signing it would write
     * progression computed from the old values over that battle's result.
     */
    expectedProgress?: readonly ExpectedProgress[];
}

export interface ExpectedProgress {
    petId: string;
    level: number;
    xp: number;
    streak: number;
    lastOpponentId: string;
    readyAt: bigint;
}

export type OpenBattleResult =
    | { ok: true; battleId: string }
    | { ok: false; reason: typeof OPEN_BATTLE_REFUSALS.PET_LOCKED; petId: string }
    | { ok: false; reason: typeof OPEN_BATTLE_REFUSALS.PET_PROGRESS_CHANGED; petId: string }
    | { ok: false; reason: typeof OPEN_BATTLE_REFUSALS.INTENT_ALREADY_CONSUMED };

/**
 * Signals a clean, expected abort of the `openBattle` transaction.
 *
 * Prisma's interactive transactions only roll back when the callback throws; returning a
 * value, even one that *looks* like a failure, commits whatever ran so far. So an aborted
 * ledger row or a lock taken before the conflict must be undone by throwing, not by returning
 * `{ ok: false }` directly from inside the callback.
 */
class OpenBattleAbort extends Error {
    constructor(readonly result: Extract<OpenBattleResult, { ok: false }>) {
        super(`openBattle aborted: ${result.reason}`);
    }
}

/**
 * Creates a ledger row, locks both pets, consumes the originating intent, and enqueues the
 * first message, all atomically.
 *
 * Lock rows are inserted in ascending numeric pet-id order. Two battles involving the same
 * pair, submitted at the same moment, therefore contend on the same row first, so one of
 * them fails cleanly on the primary key instead of the two deadlocking against each other
 * (threat T11). Numeric rather than lexicographic, because pet ids are decimal strings and
 * `"10" < "9"` as text.
 *
 * Read Committed, not Serializable. Every check here is a write that Postgres resolves
 * against the latest committed row: the intent and progress guards are guarded updates, which
 * re-evaluate their `where` once a concurrent writer commits, and the pet locks are inserts
 * against a primary key. So a concurrent accept or a battle that signed meanwhile ends in its
 * matching refusal rather than a serialization failure that would need a retry.
 */
export async function openBattle(request: OpenBattleRequest): Promise<OpenBattleResult> {
    const petIds = sortPetIds(request.petIds);

    try {
        return await prisma.$transaction(
            async (tx) => {
                if (request.consumeIntentHash) {
                    const { count } = await tx.battleIntent.updateMany({
                        where: { intentHash: request.consumeIntentHash, consumedAt: null },
                        data: { consumedAt: new Date() },
                    });
                    if (count === 0) {
                        throw new OpenBattleAbort({ ok: false, reason: OPEN_BATTLE_REFUSALS.INTENT_ALREADY_CONSUMED });
                    }
                }

                const ledger = await tx.battleLedger.create({ data: request.ledger });
                for (const petId of petIds) {
                    // Sequential on purpose: the ordering is the deadlock avoidance, and
                    // issuing these in parallel would throw it away.
                    try {
                        await tx.petBattleLock.create({
                            data: { chainId: ledger.chainId, petId, battleId: ledger.battleId },
                        });
                    } catch (error) {
                        if ((error as { code?: string }).code === 'P2002') {
                            throw new OpenBattleAbort({ ok: false, reason: OPEN_BATTLE_REFUSALS.PET_LOCKED, petId });
                        }
                        throw error;
                    }
                }
                if (request.expectedProgress) {
                    await assertProgressUnchanged(tx, ledger.chainId, ledger.deploymentId, request.expectedProgress);
                }
                if (request.outbox && request.outbox.length > 0) {
                    await enqueueOutbox(tx, request.outbox);
                }
                return { ok: true, battleId: ledger.battleId };
            },
            { isolationLevel: 'ReadCommitted' },
        );
    } catch (error) {
        if (error instanceof OpenBattleAbort) {
            return error.result;
        }
        throw error;
    }
}

/**
 * A guarded write, not a read. It runs after the pet locks, so a battle that signed and
 * released its lock while this transaction waited on that lock has already committed its
 * progress: the update matches no row and the accept is refused. One still writing the row
 * holds its row lock, so this update waits for it and then re-checks the `where` against what
 * it wrote. Taken in lock order, so two transactions over the same rows queue instead of
 * deadlocking.
 */
async function assertProgressUnchanged(
    tx: Prisma.TransactionClient,
    chainId: string,
    deploymentId: string,
    expected: readonly ExpectedProgress[],
): Promise<void> {
    const byPetId = new Map(expected.map((pet) => [pet.petId, pet]));
    for (const petId of sortPetIds([...byPetId.keys()])) {
        const pet = byPetId.get(petId)!;
        const { count } = await tx.petBattleProgress.updateMany({
            where: {
                chainId,
                deploymentId,
                petId,
                level: pet.level,
                xp: pet.xp,
                streak: pet.streak,
                lastOpponentId: pet.lastOpponentId,
                readyAt: pet.readyAt,
            },
            // Writes back the value it matched on: the point is the row lock and the
            // conflict check, not a change.
            data: { level: pet.level },
        });
        if (count === 0) {
            throw new OpenBattleAbort({ ok: false, reason: OPEN_BATTLE_REFUSALS.PET_PROGRESS_CHANGED, petId });
        }
    }
}

/** Ascending numeric order, which is the lock-acquisition order. */
export function sortPetIds(petIds: readonly string[]): string[] {
    return [...petIds].sort((a, b) => {
        const left = BigInt(a);
        const right = BigInt(b);
        return left === right ? 0 : left < right ? -1 : 1;
    });
}

/** Current state, or null if the battle does not exist. */
export async function getBattleState(battleId: string): Promise<BattleState | null> {
    const row = await prisma.battleLedger.findUnique({ where: { battleId }, select: { state: true } });
    return row?.state ?? null;
}

/**
 * Records a failure transition with its reason.
 *
 * The reason is not decoration: `verification_failed` without saying what mismatched leaves
 * an operator diffing two engines by hand during an incident.
 */
export async function failBattle(
    battleId: string,
    from: BattleState,
    to: BattleState,
    reason: string,
): Promise<TransitionResult> {
    return applyTransition({ battleId, from, to, patch: { failureReason: reason } });
}

/**
 * Ends a battle whose pipeline can no longer make progress, freeing both pets.
 *
 * Called when an outbox message dead-letters. Until this existed, a battle whose step ran
 * out of retries stayed in a non-terminal state forever, and because locks are released by
 * reaching a terminal state, both its pets were unable to battle again — permanently, with
 * nothing surfacing why. That is how one unreachable verifier took two pets out of the
 * game for days.
 *
 * `forfeited` and deliberately not `verification_failed`: that state means the two engines
 * disagreed and is a ruleset-wide circuit breaker (§F). A verifier that never answered has
 * disagreed with nothing, and marking it failed would stop signing for every battle on
 * that ruleset because one service was down.
 *
 * States with no legal move to `forfeited` — `verified` awaiting a signature, say — are
 * left exactly as they are. Freeing the pets is not worth inventing a transition the state
 * machine does not allow, and the dead letter is still listed for a human either way.
 */
export async function abandonBattle(
    battleId: string,
    reason: string,
): Promise<{ abandoned: boolean; state: BattleState | null }> {
    const current = await prisma.battleLedger.findUnique({
        where: { battleId },
        select: { state: true },
    });
    if (!current) {
        return { abandoned: false, state: null };
    }

    const from = current.state as BattleState;
    if (!canForfeitFrom(from)) {
        return { abandoned: false, state: from };
    }

    const result = await applyTransition({
        battleId,
        from,
        to: BattleState.forfeited,
        patch: { failureReason: reason },
    });
    return { abandoned: result.applied, state: result.state };
}

/**
 * How long a battle may sit in `accepted` before it is treated as orphaned.
 *
 * `accepted` is meant to be transient: `acceptBattle` opens the ledger row and moves it to
 * `committed` a few statements later, in the same call. A battle still here minutes later
 * did not get slower, it stopped — the process died between the two, or the accept threw
 * after the row was written.
 *
 * Generous anyway, because the cost of being wrong is asymmetric: expiring a live battle
 * would strand a player who has already signed, while expiring a dead one late only means
 * their pets wait a few more minutes.
 */
const ACCEPTED_ORPHAN_SECONDS = 10 * 60;

/**
 * Expires battles orphaned in `accepted`, releasing the pets they hold.
 *
 * Without this a pet locked by an orphan is locked *forever*. Locks are freed by reaching a
 * terminal state, and `accepted` has no route to one that anything travels: the outbox
 * dead-letter path calls `abandonBattle`, which declines because `accepted` cannot forfeit,
 * and nothing else ever wrote `expired`. So the state existed in `ALLOWED_TRANSITIONS`,
 * described exactly this situation, and had no code behind it — a crash between accept and
 * commit permanently bricked both pets, with the only symptom a unique-constraint error on
 * `pet_battle_lock` the next time either one tried to fight.
 *
 * Runs on the worker tick rather than as a scheduled job, because it needs no coordination:
 * `applyTransition` guards on the `from` state, so two workers racing on one battle produce
 * one expiry and one no-op.
 */
export async function expireOrphanedAccepts(nowSeconds: number): Promise<{ expired: number }> {
    const cutoff = new Date((nowSeconds - ACCEPTED_ORPHAN_SECONDS) * 1000);
    const orphans = await prisma.battleLedger.findMany({
        where: { state: BattleState.accepted, createdAt: { lt: cutoff } },
        select: { battleId: true },
    });

    let expired = 0;
    for (const { battleId } of orphans) {
        const result = await applyTransition({
            battleId,
            from: BattleState.accepted,
            to: BattleState.expired,
            patch: { failureReason: `orphaned in accepted for over ${ACCEPTED_ORPHAN_SECONDS}s` },
        });
        if (result.applied) {
            expired += 1;
            console.warn(`[battle-worker] expired orphaned battle ${battleId}; its pets are released`);
        }
    }
    return { expired };
}
