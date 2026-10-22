import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BattleState } from '@generated/prisma/enums';

/**
 * The transaction client every transition runs against. `$transaction` hands the callback
 * this object, so the tests can assert that the state change, the outbox write, and the
 * lock release all happened against the *same* client, which is what makes them atomic.
 */
const tx = {
    battleLedger: { updateMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    battleOutbox: { createMany: vi.fn() },
    petBattleLock: { create: vi.fn(), deleteMany: vi.fn() },
    battleIntent: { updateMany: vi.fn() },
    petBattleProgress: { findMany: vi.fn() },
};

vi.mock('@config/prisma', () => ({
    prisma: {
        $transaction: vi.fn(),
        battleLedger: { findUnique: vi.fn(), findMany: vi.fn() },
    },
}));

import { prisma } from '@config/prisma';

import {
    abandonBattle,
    applyTransition,
    expireOrphanedAccepts,
    failBattle,
    IllegalTransitionError,
    openBattle,
    shouldReleaseLocks,
    OUTBOX_TOPICS,
    sortPetIds,
} from '@features/battle/ledger';

beforeEach(() => {
    vi.clearAllMocks();
    // Run the callback inline with the fake client, and record the isolation level so the
    // serializable requirement is testable.
    vi.mocked(prisma.$transaction).mockImplementation(((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx))) as never);
    tx.battleLedger.updateMany.mockResolvedValue({ count: 1 });
    tx.battleLedger.create.mockResolvedValue({ battleId: 'btl_1', chainId: 'eip155:84532' });
    tx.battleOutbox.createMany.mockResolvedValue({ count: 1 });
    tx.petBattleLock.create.mockResolvedValue({});
    tx.petBattleLock.deleteMany.mockResolvedValue({ count: 2 });
    tx.battleIntent.updateMany.mockResolvedValue({ count: 1 });
});

describe('applyTransition', () => {
    it('advances the state and enqueues in one transaction', async () => {
        const result = await applyTransition({
            battleId: 'btl_1',
            from: BattleState.accepted,
            to: BattleState.committed,
            patch: { drandRound: 1002n },
            outbox: [{ battleId: 'btl_1', topic: OUTBOX_TOPICS.awaitBeacon }],
        });

        expect(result).toEqual({ applied: true, state: BattleState.committed });
        expect(tx.battleLedger.updateMany).toHaveBeenCalledWith({
            where: { battleId: 'btl_1', state: BattleState.accepted },
            data: { drandRound: 1002n, state: BattleState.committed },
        });
        expect(tx.battleOutbox.createMany).toHaveBeenCalledTimes(1);
    });

    it('runs at serializable isolation', async () => {
        await applyTransition({ battleId: 'btl_1', from: BattleState.accepted, to: BattleState.committed });
        expect(vi.mocked(prisma.$transaction).mock.calls[0]![1]).toEqual({ isolationLevel: 'Serializable' });
    });

    it('guards the update on the expected current state', async () => {
        // This guard is the concurrency control: only the caller that finds the battle in
        // `from` gets to move it, so there is no read-then-write race to lose.
        await applyTransition({ battleId: 'btl_1', from: BattleState.seeded, to: BattleState.computed });
        const where = tx.battleLedger.updateMany.mock.calls[0]![0].where;
        expect(where).toEqual({ battleId: 'btl_1', state: BattleState.seeded });
    });

    it('reports a lost race as not applied, with the state that won', async () => {
        tx.battleLedger.updateMany.mockResolvedValue({ count: 0 });
        tx.battleLedger.findUnique.mockResolvedValue({ state: BattleState.computed });

        const result = await applyTransition({
            battleId: 'btl_1',
            from: BattleState.seeded,
            to: BattleState.computed,
            outbox: [{ battleId: 'btl_1', topic: OUTBOX_TOPICS.verify }],
        });

        expect(result).toEqual({ applied: false, state: BattleState.computed });
        // Nothing else may happen on a lost race: enqueueing anyway would double-schedule
        // the follow-up work the winner already scheduled.
        expect(tx.battleOutbox.createMany).not.toHaveBeenCalled();
    });

    it('treats a repeat of the same state as a no-op without touching the database', async () => {
        const result = await applyTransition({
            battleId: 'btl_1',
            from: BattleState.computed,
            to: BattleState.computed,
            outbox: [{ battleId: 'btl_1', topic: OUTBOX_TOPICS.verify }],
        });

        expect(result).toEqual({ applied: false, state: BattleState.computed });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws for an illegal move rather than silently ignoring it', async () => {
        await expect(
            applyTransition({ battleId: 'btl_1', from: BattleState.committed, to: BattleState.rejected }),
        ).rejects.toBeInstanceOf(IllegalTransitionError);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws when the battle does not exist', async () => {
        tx.battleLedger.updateMany.mockResolvedValue({ count: 0 });
        tx.battleLedger.findUnique.mockResolvedValue(null);
        await expect(
            applyTransition({ battleId: 'missing', from: BattleState.accepted, to: BattleState.committed }),
        ).rejects.toThrow(/does not exist/);
    });

    it('releases both pet locks on a terminal state', async () => {
        await applyTransition({ battleId: 'btl_1', from: BattleState.published, to: BattleState.batched });
        expect(tx.petBattleLock.deleteMany).toHaveBeenCalledWith({ where: { battleId: 'btl_1' } });
    });

    it('releases locks on a failure terminal state too', async () => {
        // A pet stuck locked because its battle failed is indistinguishable from a pet in a
        // battle, and it would keep the owner from playing.
        await applyTransition({ battleId: 'btl_1', from: BattleState.committed, to: BattleState.forfeited });
        expect(tx.petBattleLock.deleteMany).toHaveBeenCalledWith({ where: { battleId: 'btl_1' } });
    });

    it('keeps locks while a battle is still in flight', async () => {
        await applyTransition({ battleId: 'btl_1', from: BattleState.seeded, to: BattleState.computed });
        expect(tx.petBattleLock.deleteMany).not.toHaveBeenCalled();
    });

    it('skips the outbox write when there is nothing to enqueue', async () => {
        await applyTransition({ battleId: 'btl_1', from: BattleState.signed, to: BattleState.published });
        expect(tx.battleOutbox.createMany).not.toHaveBeenCalled();
    });
});

describe('failBattle', () => {
    it('records why it failed', async () => {
        await failBattle('btl_1', BattleState.computed, BattleState.verification_failed, 'winner mismatch: ts=1 go=2');
        expect(tx.battleLedger.updateMany.mock.calls[0]![0].data).toEqual({
            failureReason: 'winner mismatch: ts=1 go=2',
            state: BattleState.verification_failed,
        });
    });
});

describe('openBattle', () => {
    it('creates the row, locks both pets, and enqueues in one transaction', async () => {
        const result = await openBattle({
            ledger: { chainId: 'eip155:84532' } as never,
            petIds: ['9', '10'],
            outbox: [{ battleId: 'btl_1', topic: OUTBOX_TOPICS.awaitBeacon }],
        });

        expect(result).toEqual({ ok: true, battleId: 'btl_1' });
        expect(tx.battleLedger.create).toHaveBeenCalledTimes(1);
        expect(tx.petBattleLock.create).toHaveBeenCalledTimes(2);
        expect(tx.battleOutbox.createMany).toHaveBeenCalledTimes(1);
        expect(vi.mocked(prisma.$transaction).mock.calls[0]![1]).toEqual({ isolationLevel: 'Serializable' });
    });

    it('takes locks in ascending numeric pet-id order', async () => {
        // Deadlock avoidance: two battles over the same pair contend on the same row first,
        // so one fails cleanly on the primary key instead of both waiting on each other.
        await openBattle({ ledger: { chainId: 'eip155:84532' } as never, petIds: ['10', '9'] });
        const order = tx.petBattleLock.create.mock.calls.map((call) => call[0].data.petId);
        expect(order).toEqual(['9', '10']);
    });

    it('consumes the originating intent in the same transaction, guarded on it not already being spent', async () => {
        await openBattle({
            ledger: { chainId: 'eip155:84532' } as never,
            petIds: ['9', '10'],
            consumeIntentHash: '0xabc',
        });
        expect(tx.battleIntent.updateMany).toHaveBeenCalledWith({
            where: { intentHash: '0xabc', consumedAt: null },
            data: { consumedAt: expect.any(Date) },
        });
    });

    it('aborts without creating a ledger row when the intent was already consumed', async () => {
        // Two accept calls racing on one intent must not both succeed. The abort has to roll
        // back everything in the transaction, not just skip the ledger create.
        tx.battleIntent.updateMany.mockResolvedValue({ count: 0 });
        const result = await openBattle({
            ledger: { chainId: 'eip155:84532' } as never,
            petIds: ['9', '10'],
            consumeIntentHash: '0xabc',
        });
        expect(result).toEqual({ ok: false, reason: 'intent-already-consumed' });
        expect(tx.battleLedger.create).not.toHaveBeenCalled();
    });

    it('reports which pet was already locked, rather than a raw database error', async () => {
        tx.petBattleLock.create.mockResolvedValueOnce({}).mockRejectedValueOnce(
            Object.assign(new Error('unique'), { code: 'P2002' }),
        );
        const result = await openBattle({ ledger: { chainId: 'eip155:84532' } as never, petIds: ['9', '10'] });
        expect(result).toEqual({ ok: false, reason: 'pet-locked', petId: '10' });
    });

    it('rethrows an unexpected lock error rather than reporting a conflict', async () => {
        tx.petBattleLock.create.mockRejectedValueOnce(new Error('connection reset'));
        await expect(
            openBattle({ ledger: { chainId: 'eip155:84532' } as never, petIds: ['9', '10'] }),
        ).rejects.toThrow(/connection reset/);
    });

    describe('with the progress the snapshots froze', () => {
        const PROGRESS_9 = { petId: '9', level: 5, xp: 40, streak: 1, lastOpponentId: '10', readyAt: 1_000n };
        const PROGRESS_10 = { petId: '10', level: 7, xp: 90, streak: 0, lastOpponentId: '0', readyAt: 900n };
        const request = () => ({
            ledger: { chainId: 'eip155:84532' } as never,
            petIds: ['9', '10'],
            expectedProgress: [PROGRESS_9, PROGRESS_10],
        });

        beforeEach(() => {
            tx.battleLedger.create.mockResolvedValue({
                battleId: 'btl_1',
                chainId: 'eip155:84532',
                deploymentId: 'base-sepolia-v2',
            });
        });

        it('opens the battle when neither pet changed', async () => {
            tx.petBattleProgress.findMany.mockResolvedValue([PROGRESS_10, PROGRESS_9]);
            expect(await openBattle(request())).toEqual({ ok: true, battleId: 'btl_1' });
            expect(tx.petBattleProgress.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { chainId: 'eip155:84532', deploymentId: 'base-sepolia-v2', petId: { in: ['9', '10'] } },
                }),
            );
        });

        it('rechecks after taking the locks, so a finished battle is visible', async () => {
            tx.petBattleProgress.findMany.mockResolvedValue([PROGRESS_9, PROGRESS_10]);
            await openBattle(request());
            const lastLock = Math.max(...tx.petBattleLock.create.mock.invocationCallOrder);
            expect(tx.petBattleProgress.findMany.mock.invocationCallOrder[0]!).toBeGreaterThan(lastLock);
        });

        it('aborts when another battle moved a pet on after its snapshot was taken', async () => {
            // The other battle signed and released its lock in between: same pet, a later
            // cooldown and more XP than the snapshot holds.
            tx.petBattleProgress.findMany.mockResolvedValue([
                PROGRESS_9,
                { ...PROGRESS_10, xp: 130, readyAt: 1_600n },
            ]);
            expect(await openBattle(request())).toEqual({ ok: false, reason: 'pet-progress-changed', petId: '10' });
            expect(tx.battleOutbox.createMany).not.toHaveBeenCalled();
        });

        it('aborts when a pet has no progress row at all', async () => {
            tx.petBattleProgress.findMany.mockResolvedValue([PROGRESS_10]);
            expect(await openBattle(request())).toEqual({ ok: false, reason: 'pet-progress-changed', petId: '9' });
        });
    });
});

describe('sortPetIds', () => {
    it('sorts numerically, not lexicographically', () => {
        // Pet ids are decimal strings, and "10" < "9" as text. Getting this wrong would give
        // two concurrent battles opposite lock orders, which is the deadlock.
        expect(sortPetIds(['9', '10', '2'])).toEqual(['2', '9', '10']);
    });

    it('handles ids beyond Number.MAX_SAFE_INTEGER', () => {
        const big = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
        expect(sortPetIds([big, '7'])).toEqual(['7', big]);
    });

    it('does not mutate the input', () => {
        const input = ['10', '9'];
        sortPetIds(input);
        expect(input).toEqual(['10', '9']);
    });
});

describe('abandonBattle', () => {
    /** The state `prisma.battleLedger.findUnique` reports for the battle under test. */
    const currently = (state: BattleState | null) =>
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(
            (state === null ? null : { state }) as never,
        );

    // The gap this closes: a dead-lettered step left the battle non-terminal, and locks are
    // released by reaching a terminal state, so both its pets were stuck for good.
    it('forfeits a battle stuck in computed and releases its locks', async () => {
        currently(BattleState.computed);

        const result = await abandonBattle('btl_1', 'verify gave up');

        expect(result).toEqual({ abandoned: true, state: BattleState.forfeited });
        expect(tx.battleLedger.updateMany).toHaveBeenCalledWith({
            where: { battleId: 'btl_1', state: BattleState.computed },
            data: { failureReason: 'verify gave up', state: BattleState.forfeited },
        });
        // Terminal, so the locks go with it — in the same transaction.
        expect(tx.petBattleLock.deleteMany).toHaveBeenCalledWith({ where: { battleId: 'btl_1' } });
    });

    // `verification_failed` means the two engines disagreed and is a ruleset-wide circuit
    // breaker (§F). A verifier that never answered has disagreed with nothing.
    it('does not mark an unreachable verifier as a verification failure', async () => {
        currently(BattleState.computed);

        await abandonBattle('btl_1', 'indexer-go unavailable');

        const data = tx.battleLedger.updateMany.mock.calls[0]![0].data;
        expect(data.state).toBe(BattleState.forfeited);
        expect(data.state).not.toBe(BattleState.verification_failed);
    });

    it('leaves a state with no legal forfeit exactly as it is', async () => {
        currently(BattleState.verified);

        const result = await abandonBattle('btl_1', 'sign gave up');

        expect(result).toEqual({ abandoned: false, state: BattleState.verified });
        // Untouched: the battle is still live and may yet be signed, so its pets stay locked.
        expect(tx.battleLedger.updateMany).not.toHaveBeenCalled();
        expect(tx.petBattleLock.deleteMany).not.toHaveBeenCalled();
    });

    it('reports nothing to do for a battle that does not exist', async () => {
        currently(null);

        await expect(abandonBattle('btl_missing', 'whatever')).resolves.toEqual({
            abandoned: false,
            state: null,
        });
    });
});


/**
 * Pets held by a battle that never left `accepted` are released.
 *
 * Nothing else can release them. Locks are freed by reaching a terminal state, the
 * dead-letter path calls `abandonBattle` which declines because `accepted` cannot forfeit,
 * and until this existed nothing ever wrote `expired` at all. So a crash between accept and
 * commit locked both pets permanently, and the only symptom was a unique-constraint error
 * on `pet_battle_lock` the next time either tried to fight.
 */
describe('expireOrphanedAccepts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('expires an accepted battle older than the cutoff, which frees its locks', async () => {
        vi.mocked(prisma.battleLedger.findMany).mockResolvedValue([{ battleId: 'btl_old' }] as never);
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ state: 'accepted' } as never);
        vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
                battleLedger: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
                petBattleLock: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
                battleOutbox: { createMany: vi.fn() },
            })) as never);

        expect(await expireOrphanedAccepts(10_000)).toEqual({ expired: 1 });

        // `expired` is terminal, which is what makes `shouldReleaseLocks` drop the rows.
        expect(shouldReleaseLocks('expired' as never)).toBe(true);
    });

    it('only looks at battles still in accepted', async () => {
        vi.mocked(prisma.battleLedger.findMany).mockResolvedValue([] as never);

        await expireOrphanedAccepts(10_000);

        const { where } = vi.mocked(prisma.battleLedger.findMany).mock.calls[0]![0]!;
        expect(where).toMatchObject({ state: 'accepted' });
        // A cutoff in the past, never "everything": expiring a battle mid-accept would
        // strand a player who has already signed.
        expect((where as { createdAt: { lt: Date } }).createdAt.lt.getTime()).toBeLessThan(10_000 * 1000);
    });

    it('does nothing when there are no orphans', async () => {
        vi.mocked(prisma.battleLedger.findMany).mockResolvedValue([] as never);
        expect(await expireOrphanedAccepts(10_000)).toEqual({ expired: 0 });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
