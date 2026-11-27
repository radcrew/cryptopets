import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPublishedRulesetCache } from '@features/battle/ledger/rulesetBundle.store';

import {
    computeProgression,
    deriveBattleSeed,
    hashCombatLog,
    hashRuleset,
    publishRuleset,
    QUICKNET,
    roundTime,
    simulate,
    SOURCE_DEFAULT_RULESET,
} from '@cryptopets/protocol';

vi.mock('@config/prisma', () => ({
    prisma: {
        battleLedger: { findUnique: vi.fn() },
        battleRuleset: { findUnique: vi.fn() },
    },
}));

// The snapshot codec is pure and stays real. Stubbing it would let these tests pass
// against a decoder production does not use, which is exactly how the signing worker's
// schemaVersion bug survived a green suite.
vi.mock('@features/battle/ledger', async () => ({
    applyTransition: vi.fn(),
    completeOutbox: vi.fn(),
    OUTBOX_TOPICS: { sign: 'sign' },
    ...(await vi.importActual<typeof import('@features/battle/ledger/rulesetBundle.store')>(
        '@features/battle/ledger/rulesetBundle.store',
    )),
    ...(await vi.importActual<typeof import('@features/battle/ledger/snapshot.codec')>(
        '@features/battle/ledger/snapshot.codec',
    )),
}));

// Only the network call is replaced; verifyPetInputs is a pure mapping and stays real.
vi.mock('@grpc-client/verifyBattle', async () => ({
    ...(await vi.importActual<object>('@grpc-client/verifyBattle')),
    callVerifyBattle: vi.fn(),
}));

vi.mock('@ws/battleRoomSocket', () => ({
    notifyBattleRoomIfPresent: vi.fn(),
}));

import { prisma } from '@config/prisma';
import { applyTransition, completeOutbox } from '@features/battle/ledger';
import { processVerifyMessage } from '@features/battle/worker';
import { callVerifyBattle } from '@grpc-client/verifyBattle';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

const RULESET_HASH = hashRuleset(SOURCE_DEFAULT_RULESET);
const NOW = roundTime(QUICKNET, 1000) + 5;
const DOMAIN = { chainId: 'eip155:84532', deploymentId: 'base-sepolia-live' };

const ATTACKER_FIXTURE = {
    petId: '1',
    owner: '0xabcdef0123456789abcdef0123456789abcdef01',
    dna: '1234567890123456',
    rarity: 3,
    level: 10,
    skill: 4,
    xp: 120,
    lastOpponentId: '0',
    streak: 0,
    readyAt: NOW - 100,
    sourceVersion: '1000',
};
const DEFENDER_FIXTURE = {
    ...ATTACKER_FIXTURE,
    petId: '2',
    owner: '0x2222222222222222222222222222222222222222',
    dna: '6543210987654321',
    rarity: 2,
    level: 11,
    skill: 7,
    lastOpponentId: '1',
    streak: 2,
};

const SNAPSHOT = { domain: DOMAIN, attacker: ATTACKER_FIXTURE, defender: DEFENDER_FIXTURE, takenAt: NOW - 6 };

const seed = deriveBattleSeed({
    domain: DOMAIN as never,
    drandRandomness: '0xfe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
    battleId: 'btl_1',
    snapshotHash: `0x${'11'.repeat(32)}`,
    rulesetHash: RULESET_HASH,
});

const outcome = simulate(
    BigInt(ATTACKER_FIXTURE.dna),
    ATTACKER_FIXTURE.rarity,
    ATTACKER_FIXTURE.level,
    ATTACKER_FIXTURE.skill,
    BigInt(DEFENDER_FIXTURE.dna),
    DEFENDER_FIXTURE.rarity,
    DEFENDER_FIXTURE.level,
    DEFENDER_FIXTURE.skill,
    seed.value,
    SOURCE_DEFAULT_RULESET.skillConfig,
);
const combatLogHash = hashCombatLog(outcome);
const progression = computeProgression(
    {
        domain: DOMAIN as never,
        attacker: {
            ...ATTACKER_FIXTURE,
            petId: 1n,
            dna: BigInt(ATTACKER_FIXTURE.dna),
            lastOpponentId: 0n,
            sourceVersion: BigInt(ATTACKER_FIXTURE.sourceVersion),
        } as never,
        defender: {
            ...DEFENDER_FIXTURE,
            petId: 2n,
            dna: BigInt(DEFENDER_FIXTURE.dna),
            lastOpponentId: 1n,
            sourceVersion: BigInt(DEFENDER_FIXTURE.sourceVersion),
        } as never,
        takenAt: SNAPSHOT.takenAt,
    },
    outcome.result.firstWins,
);

const BATTLE = {
    battleId: 'btl_1',
    rulesetHash: RULESET_HASH,
    snapshot: SNAPSHOT,
    seed: seed.hex,
    state: 'computed',
    attackerWon: outcome.result.firstWins,
    rounds: outcome.result.rounds,
    winnerHpRemaining: outcome.result.winnerHpRemaining,
    combatLogHash,
    progression: JSON.parse(JSON.stringify(progression, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
    roomId: 'room_1',
};

const MESSAGE = { id: 'msg_1', battleId: 'btl_1', topic: 'verify', payload: {}, attempts: 1 };

/** Converts the real TS outcome/progression into the shape Go's wire response takes. */
function goWireAgreeing() {
    return {
        firstWins: outcome.result.firstWins,
        rounds: outcome.result.rounds,
        winnerHpRemaining: outcome.result.winnerHpRemaining,
        startHp1: Number(outcome.startHp1),
        startHp2: Number(outcome.startHp2),
        log: outcome.log.map((e) => ({
            round: e.round,
            attacker: e.attacker,
            isMagic: e.isMagic,
            crit: e.crit,
            damage: e.damage.toString(),
            heal: e.heal.toString(),
            elementMult: e.elementMult,
            furyTriggered: e.furyTriggered,
            rebirthTriggered: e.rebirthTriggered,
            hp1After: Number(e.hp1After),
            hp2After: Number(e.hp2After),
        })),
        attacker: {
            petId: progression.attacker.petId.toString(),
            won: progression.attacker.won,
            decayShift: progression.attacker.decayShift,
            xpAwarded: progression.attacker.xpAwarded,
            lastOpponentId: progression.attacker.lastOpponentId.toString(),
            streak: progression.attacker.streak,
            level: progression.attacker.level,
            xp: progression.attacker.xp,
            leveledUp: progression.attacker.leveledUp,
        },
        defender: {
            petId: progression.defender.petId.toString(),
            won: progression.defender.won,
            decayShift: progression.defender.decayShift,
            xpAwarded: progression.defender.xpAwarded,
            lastOpponentId: progression.defender.lastOpponentId.toString(),
            streak: progression.defender.streak,
            level: progression.defender.level,
            xp: progression.defender.xp,
            leveledUp: progression.defender.leveledUp,
        },
    };
}

beforeEach(() => {
    clearPublishedRulesetCache();
    vi.clearAllMocks();
    vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(BATTLE as never);
    const { json } = publishRuleset(SOURCE_DEFAULT_RULESET);
    vi.mocked(prisma.battleRuleset.findUnique).mockResolvedValue({ bundle: JSON.parse(json) } as never);
});

describe('agreement', () => {
    it('moves to verified and enqueues sign when everything matches', async () => {
        vi.mocked(callVerifyBattle).mockResolvedValue({ ok: true, response: goWireAgreeing() as never });

        await processVerifyMessage(MESSAGE, NOW);

        const call = vi.mocked(applyTransition).mock.calls[0]![0] as { from: string; to: string; outbox: { topic: string }[] };
        expect(call.from).toBe('computed');
        expect(call.to).toBe('verified');
        expect(call.outbox[0]!.topic).toBe('sign');
        expect(completeOutbox).toHaveBeenCalled();
        expect(notifyBattleRoomIfPresent).toHaveBeenCalledWith('room_1', {
            type: 'battle-updated',
            battleId: 'btl_1',
            state: 'verified',
        });
    });

    it('recomputes the combat-log hash from Go structured log using the real canonical encoder', async () => {
        // Not comparing a hash Go sent — Go never sends one. This is the property that
        // makes the check meaningful: the same encoder, fed two engines' outputs.
        vi.mocked(callVerifyBattle).mockResolvedValue({ ok: true, response: goWireAgreeing() as never });
        await processVerifyMessage(MESSAGE, NOW);
        expect(vi.mocked(applyTransition).mock.calls[0]![0]).toMatchObject({ to: 'verified' });
    });
});

describe('disagreement', () => {
    it('moves to verification_failed and retains both outputs when the winner disagrees', async () => {
        const wire = goWireAgreeing();
        wire.firstWins = !wire.firstWins;
        vi.mocked(callVerifyBattle).mockResolvedValue({ ok: true, response: wire as never });

        await processVerifyMessage(MESSAGE, NOW);

        const call = vi.mocked(applyTransition).mock.calls.at(-1)![0] as {
            to: string;
            patch: { failureReason: string; verificationDetail: { mismatches: string[] } };
        };
        expect(call.to).toBe('verification_failed');
        expect(call.patch.failureReason).toContain('winner');
        expect(call.patch.verificationDetail.mismatches.length).toBeGreaterThan(0);
        expect(notifyBattleRoomIfPresent).toHaveBeenCalledWith('room_1', {
            type: 'battle-updated',
            battleId: 'btl_1',
            state: 'verification_failed',
        });
    });

    it('flags a progression mismatch even when the fight result agrees', async () => {
        const wire = goWireAgreeing();
        wire.attacker.xp = wire.attacker.xp + 9999;
        vi.mocked(callVerifyBattle).mockResolvedValue({ ok: true, response: wire as never });

        await processVerifyMessage(MESSAGE, NOW);

        const call = vi.mocked(applyTransition).mock.calls[0]![0] as { to: string; patch: { failureReason: string } };
        expect(call.to).toBe('verification_failed');
        expect(call.patch.failureReason).toContain('attacker.xp');
    });

    it('flags a combat-log divergence even when the summary result agrees', async () => {
        const wire = goWireAgreeing();
        wire.log[0]!.damage = String(BigInt(wire.log[0]!.damage) + 1n);
        vi.mocked(callVerifyBattle).mockResolvedValue({ ok: true, response: wire as never });

        await processVerifyMessage(MESSAGE, NOW);

        const call = vi.mocked(applyTransition).mock.calls[0]![0] as { to: string; patch: { failureReason: string } };
        expect(call.to).toBe('verification_failed');
        expect(call.patch.failureReason).toContain('combatLogHash');
    });

    it('never signs on a mismatch: no sign message is ever enqueued', async () => {
        const wire = goWireAgreeing();
        wire.rounds = wire.rounds + 1;
        vi.mocked(callVerifyBattle).mockResolvedValue({ ok: true, response: wire as never });

        await processVerifyMessage(MESSAGE, NOW);

        const call = vi.mocked(applyTransition).mock.calls[0]![0] as { outbox?: unknown[] };
        expect(call.outbox ?? []).toEqual([]);
    });
});

describe('a verification failure is not a disagreement', () => {
    it('throws when indexer-go is unreachable, rather than treating it as a mismatch', async () => {
        vi.mocked(callVerifyBattle).mockResolvedValue({
            ok: false,
            reason: 'transport-error',
            detail: 'deadline exceeded',
        });

        await expect(processVerifyMessage(MESSAGE, NOW)).rejects.toThrow(/deadline exceeded/);
        // A real failure must go through the dispatcher's backoff, not be recorded as a
        // verified/verification_failed transition.
        expect(applyTransition).not.toHaveBeenCalled();
    });

    it('throws when indexer-go is not configured', async () => {
        vi.mocked(callVerifyBattle).mockResolvedValue({
            ok: false,
            reason: 'not-configured',
            detail: 'INDEXER_GRPC_ADDR is not set',
        });
        await expect(processVerifyMessage(MESSAGE, NOW)).rejects.toThrow(/not-configured|not set/);
    });
});

describe('idempotence', () => {
    it('completes without acting when the battle has already moved on', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ ...BATTLE, state: 'verified' } as never);
        await processVerifyMessage(MESSAGE, NOW);
        expect(applyTransition).not.toHaveBeenCalled();
        expect(completeOutbox).toHaveBeenCalled();
    });

    it('completes without acting when the battle no longer exists', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(null);
        await processVerifyMessage(MESSAGE, NOW);
        expect(applyTransition).not.toHaveBeenCalled();
        expect(completeOutbox).toHaveBeenCalled();
    });

    it('throws if computed but missing a computed field, rather than verifying garbage', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ ...BATTLE, combatLogHash: null } as never);
        await expect(processVerifyMessage(MESSAGE, NOW)).rejects.toThrow(/missing a computed field/);
    });
});
