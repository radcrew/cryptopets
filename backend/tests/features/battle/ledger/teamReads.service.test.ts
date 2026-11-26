import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@config/env', () => ({ env: { battle: { deploymentId: 'base-sepolia-live', chainIds: ['eip155:84532'] } } }));
vi.mock('@config/prisma', () => ({
    prisma: { defensePlan: { findMany: vi.fn() }, petRoster: { findMany: vi.fn() } },
}));
// The overlay has its own tests; here it bumps every level by 5, so a test can see it ran.
vi.mock('@repositories/battleProgress.overlay', () => ({
    withBattleProgress: vi.fn(async (_chain: string, pets: { level: number }[]) => pets.map((pet) => ({ ...pet, level: pet.level + 5 }))),
}));
vi.mock('@repositories/roster.mapping', () => ({
    mapRosterRowToRosterPet: (row: Record<string, unknown>) => row,
}));

import { prisma } from '@config/prisma';
import { listTeamOpponents } from '@features/battle/ledger';

const NOW = 1893456000;
const DEFENDER = '0x2222222222222222222222222222222222222222';
const CALLER = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01';
const RULESET = `0x${'cd'.repeat(32)}`;

const roster = (ids: string[]) => ids.map((petId, i) => ({ petId, col: i, row: 1, tactic: 'focus' }));
const plan = (planHash: string, ids: string[]) => ({
    planHash, defenderOwner: DEFENDER, roster: roster(ids), minLevel: 1, maxLevel: 30, expiresAt: BigInt(NOW + 3600),
});
const rosterRow = (petId: string, owner = DEFENDER, readyAt = NOW - 10) => ({
    petId, owner, name: `Pet ${petId}`, level: 10, rarity: 2, dna: '1234567890123456', speciesId: 3, readyAt: BigInt(readyAt),
});

const list = () => listTeamOpponents({ chainId: 'eip155:84532', caller: CALLER, servedRulesetHash: RULESET, nowSeconds: NOW });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('listTeamOpponents', () => {
    it('asks only for plans that could be accepted now, and never the caller own', async () => {
        vi.mocked(prisma.defensePlan.findMany).mockResolvedValue([]);
        expect(await list()).toEqual([]);
        expect(prisma.defensePlan.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                chainId: 'eip155:84532',
                deploymentId: 'base-sepolia-live',
                revokedAt: null,
                rulesetHash: RULESET,
                notBefore: { lte: BigInt(NOW) },
                expiresAt: { gt: BigInt(NOW) },
                defenderOwner: { not: CALLER.toLowerCase() },
            },
        }));
        expect(prisma.petRoster.findMany).not.toHaveBeenCalled();
    });

    it('lists each plan with its pets, in one roster read, with progression merged', async () => {
        vi.mocked(prisma.defensePlan.findMany).mockResolvedValue([plan('0xp1', ['21', '22', '23'])] as never);
        vi.mocked(prisma.petRoster.findMany).mockResolvedValue(['21', '22', '23'].map((id) => rosterRow(id)) as never);

        const [opponent] = await list();
        expect(prisma.petRoster.findMany).toHaveBeenCalledTimes(1);
        expect(opponent).toMatchObject({ planHash: '0xp1', defenderOwner: DEFENDER, ready: true });
        expect(opponent?.roster).toHaveLength(3);
        expect(opponent?.roster[0]).toMatchObject({ petId: '21', col: 0, row: 1, name: 'Pet 21', level: 15 });
    });

    it('leaves out a plan whose pet changed hands or is no longer indexed, since acceptance would refuse it', async () => {
        vi.mocked(prisma.defensePlan.findMany).mockResolvedValue([
            plan('0xsold', ['21', '22', '23']),
            plan('0xgone', ['31', '32', '33']),
            plan('0xgood', ['41', '42', '43']),
        ] as never);
        vi.mocked(prisma.petRoster.findMany).mockResolvedValue([
            ...['21', '22'].map((id) => rosterRow(id)),
            rosterRow('23', '0x9999999999999999999999999999999999999999'),
            ...['31', '32'].map((id) => rosterRow(id)),
            ...['41', '42', '43'].map((id) => rosterRow(id)),
        ] as never);

        expect((await list()).map((o) => o.planHash)).toEqual(['0xgood']);
    });

    it('flags a team as resting while any of its pets is on cooldown', async () => {
        vi.mocked(prisma.defensePlan.findMany).mockResolvedValue([plan('0xp1', ['21', '22', '23'])] as never);
        vi.mocked(prisma.petRoster.findMany).mockResolvedValue([
            ...['21', '22'].map((id) => rosterRow(id)),
            rosterRow('23', DEFENDER, NOW + 300),
        ] as never);
        expect((await list())[0]?.ready).toBe(false);
    });
});
