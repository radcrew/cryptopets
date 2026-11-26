import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashRuleset, hashTeamBattleSnapshot, QUICKNET, roundTime, TEAM_SOURCE_DEFAULT_RULESET } from '@cryptopets/protocol';

const battleEnv = vi.hoisted(() => ({ enabled: true, teamEnabled: true, deploymentId: 'base-sepolia-live', chainIds: ['eip155:84532'] }));
vi.mock('@config/env', () => ({ env: { battle: battleEnv } }));

vi.mock('@config/prisma', () => ({
    prisma: {
        battleIntent: { findUnique: vi.fn() },
        defensePlan: { findUnique: vi.fn() },
        battleRuleset: { findUnique: vi.fn(), create: vi.fn() },
        battleCommitment: { findFirst: vi.fn() },
    },
}));

vi.mock('../../../../src/features/battle/ledger/ruleset.builder', async () => {
    const protocol = await vi.importActual<typeof import('@cryptopets/protocol')>('@cryptopets/protocol');
    return {
        servedRuleset: vi.fn(async () => protocol.SOURCE_DEFAULT_RULESET),
        servedRulesetHash: vi.fn(async () => protocol.hashRuleset(protocol.SOURCE_DEFAULT_RULESET)),
        servedTeamRuleset: vi.fn(async () => protocol.TEAM_SOURCE_DEFAULT_RULESET),
        servedTeamRulesetHash: vi.fn(async () => protocol.hashRuleset(protocol.TEAM_SOURCE_DEFAULT_RULESET)),
    };
});
vi.mock('../../../../src/features/battle/ledger/snapshot.builder', () => ({ buildPetSnapshot: vi.fn() }));
vi.mock('../../../../src/features/battle/ledger/defensePlan.service', async () => ({
    ...(await vi.importActual<object>('../../../../src/features/battle/ledger/defensePlan.service')),
    consumePlanDailyBudget: vi.fn(),
}));
vi.mock('../../../../src/features/battle/randomness', () => ({
    chooseCommitmentRound: vi.fn(),
    roundPublishTime: vi.fn((round: number) => new Date(roundTime(QUICKNET, round) * 1000)),
}));
vi.mock('../../../../src/features/battle/signer', () => ({
    activeSigningKey: vi.fn(),
    sign: vi.fn(),
    SignerRefusedError: class SignerRefusedError extends Error {},
}));
vi.mock('../../../../src/features/battle/ledger/transitions', () => ({ openBattle: vi.fn(), applyTransition: vi.fn() }));

import { prisma } from '@config/prisma';
import { acceptChallenge, acceptTeamBattle } from '@features/battle/ledger';
import { chooseCommitmentRound } from '@features/battle/randomness';
import { activeSigningKey, sign } from '@features/battle/signer';
import { consumePlanDailyBudget } from '../../../../src/features/battle/ledger/defensePlan.service';
import { decodeStoredTeamSnapshot } from '../../../../src/features/battle/ledger/snapshot.codec';
import { buildPetSnapshot } from '../../../../src/features/battle/ledger/snapshot.builder';
import { applyTransition, openBattle } from '../../../../src/features/battle/ledger/transitions';

const NOW = roundTime(QUICKNET, 1000) + 1;
const ATTACKER = '0xabcdef0123456789abcdef0123456789abcdef01';
const DEFENDER = '0x2222222222222222222222222222222222222222';
const TEAM_HASH = hashRuleset(TEAM_SOURCE_DEFAULT_RULESET);
const PLAN_HASH = `0x${'77'.repeat(32)}`;
const INTENT_HASH = `0x${'aa'.repeat(32)}`;

const pet = (petId: bigint, owner: string, level = 10) => ({
    petId, owner, dna: 1234567890123456n + petId, rarity: 2, level, skill: 99, xp: 0,
    lastOpponentId: 0n, streak: 0, readyAt: NOW - 100, sourceVersion: BigInt(NOW - 50),
});
let pets: Map<string, ReturnType<typeof pet>>;

const ROSTER = [21, 22, 23].map((id, i) => ({ petId: String(id), col: i, row: 1, tactic: 'focus' }));
const PLAN = {
    planHash: PLAN_HASH, chainId: 'eip155:84532', deploymentId: 'base-sepolia-live', defenderOwner: DEFENDER, roster: ROSTER,
    rulesetHash: TEAM_HASH, minLevel: 1, maxLevel: 12, maxBattlesPerDay: 5, notBefore: BigInt(NOW - 1000),
    expiresAt: BigInt(NOW + 100000), revocationNonce: 0, revokedAt: null as Date | null,
};
const INTENT = {
    intentHash: INTENT_HASH, kind: 'team', chainId: 'eip155:84532', deploymentId: 'base-sepolia-live',
    attackerOwner: ATTACKER, defenderOwner: DEFENDER, attackerPetId: null, defenderPetId: null,
    attackers: [
        { petId: '11', col: 2, row: 1, tactic: 'focus' },
        { petId: '12', col: 1, row: 1, tactic: 'breaker' },
        { petId: '13', col: 1, row: 2, tactic: 'hunter' },
    ],
    defensePlanHash: PLAN_HASH, rulesetHash: TEAM_HASH, consumedAt: null as Date | null, expiresAt: BigInt(NOW + 300),
};

const accept = () => acceptTeamBattle({ intentHash: INTENT_HASH, nowSeconds: NOW });

beforeEach(() => {
    vi.clearAllMocks();
    battleEnv.enabled = true;
    battleEnv.teamEnabled = true;
    pets = new Map(
        [pet(11n, ATTACKER), pet(12n, ATTACKER, 11), pet(13n, ATTACKER), ...[21n, 22n, 23n].map((id) => pet(id, DEFENDER))].map((p) => [
            p.petId.toString(),
            p,
        ]),
    );
    vi.mocked(prisma.battleIntent.findUnique).mockResolvedValue(INTENT as never);
    vi.mocked(prisma.defensePlan.findUnique).mockResolvedValue(PLAN as never);
    vi.mocked(prisma.battleRuleset.findUnique).mockResolvedValue({} as never);
    vi.mocked(prisma.battleCommitment.findFirst).mockResolvedValue(null);
    vi.mocked(buildPetSnapshot).mockImplementation((async (_chain: string, petId: string) => pets.get(petId) ?? null) as never);
    vi.mocked(consumePlanDailyBudget).mockResolvedValue({ ok: true, used: 1 });
    vi.mocked(chooseCommitmentRound).mockResolvedValue({ ok: true, round: 1002, latestVerified: 1000 });
    vi.mocked(activeSigningKey).mockReturnValue({ keyId: 'battle-signer-test' } as never);
    vi.mocked(openBattle).mockImplementation((async (req: { ledger: { battleId: string } }) => ({ ok: true, battleId: req.ledger.battleId })) as never);
    vi.mocked(sign).mockImplementation((async () => ({
        digest: `0x${'33'.repeat(32)}`, signature: `0x${'44'.repeat(65)}`, keyId: 'battle-signer-test',
    })) as never);
    vi.mocked(applyTransition).mockImplementation((async (req: { onApplied?: (tx: unknown) => Promise<void> }) => {
        await req.onApplied?.({ battleCommitment: { create: vi.fn().mockResolvedValue({}) } });
        return { applied: true, state: 'committed' };
    }) as never);
});

describe('accepting a team challenge', () => {
    it('freezes and locks all six pets, spends one plan use, and signs a commitment over the team snapshot', async () => {
        const result = await accept();
        expect(result.ok).toBe(true);

        const opened = vi.mocked(openBattle).mock.calls[0]?.[0] as unknown as {
            petIds: string[];
            expectedProgress: unknown[];
            ledger: Record<string, unknown>;
        };
        expect(opened.petIds).toEqual(['11', '12', '13', '21', '22', '23']);
        expect(opened.expectedProgress).toHaveLength(6);
        expect(opened.ledger).toMatchObject({ kind: 'team', defensePlanHash: PLAN_HASH, attackerOwner: ATTACKER, defenderOwner: DEFENDER, rulesetHash: TEAM_HASH });
        expect(opened.ledger).not.toHaveProperty('authorizationHash');
        const snapshot = decodeStoredTeamSnapshot(opened.ledger.snapshot);
        expect(snapshot.schemaVersion).toBe(3);
        expect(opened.ledger.snapshotHash).toBe(hashTeamBattleSnapshot(snapshot));
        expect(snapshot.roster.map((m) => m.pet.petId)).toEqual([21n, 22n, 23n]);

        expect(consumePlanDailyBudget).toHaveBeenCalledTimes(1);
        // The commitment layout is shared: its consent field carries the plan, its snapshot the team one.
        const committed = vi.mocked(sign).mock.calls[0]?.[0] as unknown as {
            commitment: { defenseAuthorizationHash: string; snapshot: { schemaVersion: number; roster: unknown[] } };
        };
        expect(committed.commitment.defenseAuthorizationHash).toBe(PLAN_HASH);
        expect(committed.commitment.snapshot.schemaVersion).toBe(3);
        expect(committed.commitment.snapshot.roster).toHaveLength(3);
    });

    it('is refused once team battles are switched off', async () => {
        battleEnv.teamEnabled = false;
        expect(await accept()).toMatchObject({ ok: false, reason: 'team-battles-disabled' });
    });

    it('needs the plan to exist and still stand', async () => {
        vi.mocked(prisma.defensePlan.findUnique).mockResolvedValue(null);
        expect(await accept()).toMatchObject({ ok: false, reason: 'no-authorization' });
        vi.mocked(prisma.defensePlan.findUnique).mockResolvedValue({ ...PLAN, revokedAt: new Date(0) } as never);
        expect(await accept()).toMatchObject({ ok: false, reason: 'revoked' });
    });

    it('refuses a pet that changed hands, on either side', async () => {
        pets.set('23', { ...pets.get('23')!, owner: ATTACKER });
        expect(await accept()).toMatchObject({ ok: false, reason: 'pet-owner-changed' });
        pets.set('23', { ...pets.get('23')!, owner: DEFENDER });
        pets.set('12', { ...pets.get('12')!, owner: DEFENDER });
        expect(await accept()).toMatchObject({ ok: false, reason: 'pet-owner-changed' });
    });

    it('needs every pet on both sides off cooldown', async () => {
        pets.set('23', { ...pets.get('23')!, readyAt: NOW + 60 });
        expect(await accept()).toMatchObject({ ok: false, reason: 'defender-not-ready' });
        pets.set('23', { ...pets.get('23')!, readyAt: NOW - 1 });
        pets.set('13', { ...pets.get('13')!, readyAt: NOW + 60 });
        expect(await accept()).toMatchObject({ ok: false, reason: 'attacker-not-ready' });
    });

    it('bands the squad by its highest level, so a strong pet cannot hide behind weak ones', async () => {
        pets.set('13', { ...pets.get('13')!, level: 13 });
        expect(await accept()).toMatchObject({ ok: false, reason: 'attacker-level-above-band' });
    });

    it('refuses a challenge signed under rules that are no longer served', async () => {
        vi.mocked(prisma.battleIntent.findUnique).mockResolvedValue({ ...INTENT, rulesetHash: `0x${'ab'.repeat(32)}` } as never);
        expect(await accept()).toMatchObject({ ok: false, reason: 'intent-ruleset-stale' });
    });

    it('checks the gear of every defending pet, not only the first', async () => {
        // Item type 9 is in no catalog: the ruleset cannot price it, so verification would fail.
        pets.set('23', { ...pets.get('23')!, equipment: [{ slot: 0, itemType: 9n, hp: 0, atk: 5, def: 0, int: 0, mdef: 0 }] } as never);
        expect(await accept()).toMatchObject({ ok: false, reason: 'equipment-catalog-mismatch' });
        expect(openBattle).not.toHaveBeenCalled();
    });
});

describe('acceptChallenge', () => {
    it('routes a team intent to team acceptance', async () => {
        expect((await acceptChallenge({ intentHash: INTENT_HASH, nowSeconds: NOW })).ok).toBe(true);
        expect(prisma.defensePlan.findUnique).toHaveBeenCalled();
    });

    it('leaves an unknown intent to the duel flow, which refuses it', async () => {
        vi.mocked(prisma.battleIntent.findUnique).mockResolvedValue(null);
        expect(await acceptChallenge({ intentHash: INTENT_HASH, nowSeconds: NOW })).toMatchObject({ ok: false, reason: 'intent-not-found' });
    });
});
