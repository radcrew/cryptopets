import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPublishedRulesetCache } from '@features/battle/ledger/rulesetBundle.store';

import { deriveBattleSeed, hashRuleset, publishRuleset, QUICKNET, roundTime, SOURCE_DEFAULT_RULESET } from '@cryptopets/protocol';

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
    OUTBOX_TOPICS: { verify: 'verify' },
    ...(await vi.importActual<typeof import('@features/battle/ledger/rulesetBundle.store')>(
        '@features/battle/ledger/rulesetBundle.store',
    )),
    ...(await vi.importActual<typeof import('@features/battle/ledger/snapshot.codec')>(
        '@features/battle/ledger/snapshot.codec',
    )),
}));

vi.mock('@ws/battleRoomSocket', () => ({
    notifyBattleRoomIfPresent: vi.fn(),
}));

import { prisma } from '@config/prisma';
import { applyTransition, completeOutbox } from '@features/battle/ledger';
import { processComputeMessage } from '@features/battle/worker';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

const RULESET_HASH = hashRuleset(SOURCE_DEFAULT_RULESET);
const NOW = roundTime(QUICKNET, 1000) + 5;
const DOMAIN = { chainId: 'eip155:84532', deploymentId: 'base-sepolia-live' };

const ATTACKER = {
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
const DEFENDER = {
    ...ATTACKER,
    petId: '2',
    owner: '0x2222222222222222222222222222222222222222',
    dna: '6543210987654321',
    rarity: 2,
    level: 11,
    skill: 7,
    lastOpponentId: '1',
    streak: 2,
};

const SNAPSHOT = { domain: DOMAIN, attacker: ATTACKER, defender: DEFENDER, takenAt: NOW - 6 };

const seed = deriveBattleSeed({
    domain: DOMAIN as never,
    drandRandomness: '0xfe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
    battleId: 'btl_1',
    snapshotHash: `0x${'11'.repeat(32)}`,
    rulesetHash: RULESET_HASH,
});

const BATTLE = {
    battleId: 'btl_1',
    chainId: 'eip155:84532',
    deploymentId: 'base-sepolia-live',
    state: 'seeded',
    seed: seed.hex,
    snapshot: SNAPSHOT,
    rulesetHash: RULESET_HASH,
    roomId: 'room_1',
};

const MESSAGE = { id: 'msg_1', battleId: 'btl_1', topic: 'compute', payload: {}, attempts: 1 };

beforeEach(() => {
    clearPublishedRulesetCache();
    vi.clearAllMocks();
    vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(BATTLE as never);
    const { json } = publishRuleset(SOURCE_DEFAULT_RULESET);
    vi.mocked(prisma.battleRuleset.findUnique).mockResolvedValue({ bundle: JSON.parse(json) } as never);
});

describe('running the fight', () => {
    it('computes the result, progression, and combat log hash, then moves to computed', async () => {
        await processComputeMessage(MESSAGE, NOW);

        const call = vi.mocked(applyTransition).mock.calls[0]![0] as {
            from: string;
            to: string;
            patch: { rounds: number; combatLogHash: string; combatLog: unknown; progression: unknown };
            outbox: { topic: string }[];
        };
        expect(call.from).toBe('seeded');
        expect(call.to).toBe('computed');
        expect(call.patch.rounds).toBeGreaterThan(0);
        expect(call.patch.combatLogHash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(Array.isArray(call.patch.combatLog)).toBe(true);
        expect(call.outbox[0]!.topic).toBe('verify');
        expect(completeOutbox).toHaveBeenCalledWith('msg_1', expect.any(Date));
        expect(notifyBattleRoomIfPresent).toHaveBeenCalledWith('room_1', {
            type: 'battle-updated',
            battleId: 'btl_1',
            state: 'computed',
        });
    });

    it('is deterministic: the same seeded battle always computes the same result', async () => {
        await processComputeMessage(MESSAGE, NOW);
        await processComputeMessage(MESSAGE, NOW + 1);
        const results = vi.mocked(applyTransition).mock.calls.map(
            (c) => (c[0] as { patch: { combatLogHash: string } }).patch.combatLogHash,
        );
        expect(results[0]).toBe(results[1]);
    });

    it('loads the ruleset the battle actually named, not whatever the process default is', async () => {
        await processComputeMessage(MESSAGE, NOW);
        expect(prisma.battleRuleset.findUnique).toHaveBeenCalledWith({ where: { rulesetHash: RULESET_HASH } });
    });

    it('rejects a published bundle whose hash does not match, rather than trusting it blindly', async () => {
        const { json } = publishRuleset({ ...SOURCE_DEFAULT_RULESET, version: 2 });
        vi.mocked(prisma.battleRuleset.findUnique).mockResolvedValue({ bundle: JSON.parse(json) } as never);
        await expect(processComputeMessage(MESSAGE, NOW)).rejects.toThrow(/ruleset hash mismatch/);
    });

    it('throws when no bundle was ever published for this hash', async () => {
        vi.mocked(prisma.battleRuleset.findUnique).mockResolvedValue(null);
        await expect(processComputeMessage(MESSAGE, NOW)).rejects.toThrow(/no published ruleset bundle/);
    });
});

describe('idempotence', () => {
    it('completes without recomputing when the battle has already moved on', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ ...BATTLE, state: 'computed' } as never);
        await processComputeMessage(MESSAGE, NOW);
        expect(applyTransition).not.toHaveBeenCalled();
        expect(completeOutbox).toHaveBeenCalled();
    });

    it('completes without acting when the battle no longer exists', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(null);
        await processComputeMessage(MESSAGE, NOW);
        expect(applyTransition).not.toHaveBeenCalled();
        expect(completeOutbox).toHaveBeenCalled();
    });

    it('throws if seeded but somehow missing its seed, rather than computing garbage', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ ...BATTLE, seed: null } as never);
        await expect(processComputeMessage(MESSAGE, NOW)).rejects.toThrow(/no seed recorded/);
    });
});
