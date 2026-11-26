import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyBattleMock = vi.hoisted(() => vi.fn());
const verifyTeamBattleMock = vi.hoisted(() => vi.fn());
const envMock = vi.hoisted(() => ({
    indexerGrpc: { addr: 'localhost:50051' as string | undefined, protoPath: undefined },
}));

vi.mock('@config/env', () => ({ env: envMock }));

vi.mock('../../src/grpc/gameData', () => ({
    loadGameDataService: () =>
        class {
            verifyBattle = verifyBattleMock;
            verifyTeamBattle = verifyTeamBattleMock;
        },
}));

import {
    callVerifyBattle,
    callVerifyTeamBattle,
    resetVerifyBattleClient,
    type VerifyTeamBattleParams,
} from '../../src/grpc/verifyBattle';

const PARAMS = {
    attacker: { petId: '1', dna: '1234567890123456', rarity: 3, level: 10, skill: 4, xp: 0, lastOpponentId: '0', streak: 0 },
    defender: { petId: '2', dna: '6543210987654321', rarity: 2, level: 11, skill: 7, xp: 0, lastOpponentId: '0', streak: 0 },
    seed: `0x${'ab'.repeat(32)}`,
    skillConfig: {
        tankHpMult: 120,
        shellDefMult: 125,
        swiftCritBonus: 50,
        cunningCritCap: 4000,
        furyDmgMult: 130,
        furyHpThreshold: 3000,
        sageMdefMult: 125,
        bloodlustBps: 150,
    },
    maxLevel: 100,
};

beforeEach(() => {
    vi.clearAllMocks();
    resetVerifyBattleClient();
    envMock.indexerGrpc.addr = 'localhost:50051';
});

afterEach(() => {
    resetVerifyBattleClient();
});

describe('fail-closed by contract', () => {
    it('reports not-configured rather than resolving as if verification passed', async () => {
        envMock.indexerGrpc.addr = undefined;
        const result = await callVerifyBattle(PARAMS);
        expect(result).toMatchObject({ ok: false, reason: 'not-configured' });
        expect(verifyBattleMock).not.toHaveBeenCalled();
    });

    it('surfaces a transport error as a failure, never as a silent pass', async () => {
        verifyBattleMock.mockImplementation((_req, _opts, cb) => cb({ message: 'deadline exceeded' }, null));
        const result = await callVerifyBattle(PARAMS);
        expect(result).toMatchObject({ ok: false, reason: 'transport-error', detail: 'deadline exceeded' });
    });

    it('opens the breaker after repeated failures and still reports a failure, not a pass', async () => {
        verifyBattleMock.mockImplementation((_req, _opts, cb) => cb({ message: 'down' }, null));
        await callVerifyBattle(PARAMS);
        await callVerifyBattle(PARAMS);
        await callVerifyBattle(PARAMS);

        const result = await callVerifyBattle(PARAMS);
        expect(result).toMatchObject({ ok: false, reason: 'breaker-open' });
        // The breaker being open must not translate into fewer gRPC attempts being treated
        // as a pass: only 3 real attempts happened, this 4th was skipped and still failed.
        expect(verifyBattleMock).toHaveBeenCalledTimes(3);
    });
});

describe('a successful call', () => {
    it('resolves ok with the response and encodes the seed as raw bytes', async () => {
        verifyBattleMock.mockImplementation((req, _opts, cb) => {
            expect(req.seed).toBeInstanceOf(Buffer);
            expect((req.seed as Buffer).length).toBe(32);
            cb(null, { firstWins: true, rounds: 5, winnerHpRemaining: 100, log: [], attacker: {}, defender: {} });
        });
        const result = await callVerifyBattle(PARAMS);
        expect(result).toMatchObject({ ok: true });
    });
});

const pet = (petId: string) => ({
    petId,
    dna: '1234567890123456',
    rarity: 2,
    level: 10,
    skill: 4,
    xp: 0,
    lastOpponentId: '0',
    streak: 0,
    bonusHp: 0,
    bonusAtk: 0,
    bonusDef: 0,
    bonusInt: 0,
    bonusMdef: 0,
});

const TEAM_PARAMS: VerifyTeamBattleParams = {
    attackers: [0, 1, 2].map((i) => ({ pet: pet(String(11 + i)), col: 2, row: i, tactic: 'focus' as const, rank: 0 })),
    roster: [0, 1, 2, 3, 4].map((i) => ({ pet: pet(String(21 + i)), col: i % 3, row: Math.floor(i / 3), tactic: 'focus' as const, rank: i + 1 })),
    seed: `0x${'cd'.repeat(32)}`,
    skillConfig: PARAMS.skillConfig,
    teamConfig: { turnOrder: 'int', comboStepPct: 10, exposePct: 120, auraPct: 110, tailwindBps: 200, longShotPct: 85, temperamentPct: 105 },
    maxLevel: 100,
};

describe('VerifyTeamBattle', () => {
    it('is fail-closed when no address is configured', async () => {
        envMock.indexerGrpc.addr = undefined;
        expect(await callVerifyTeamBattle(TEAM_PARAMS)).toMatchObject({ ok: false, reason: 'not-configured' });
        expect(verifyTeamBattleMock).not.toHaveBeenCalled();
    });

    it('surfaces a transport error as a failure, never as a silent pass', async () => {
        verifyTeamBattleMock.mockImplementation((_req, _opts, cb) => cb({ message: 'unavailable' }, null));
        expect(await callVerifyTeamBattle(TEAM_PARAMS)).toMatchObject({ ok: false, reason: 'transport-error', detail: 'unavailable' });
    });

    it('sends the whole roster and the seed as raw bytes, and returns the response', async () => {
        const response = { drawn: [0, 2, 3], attackerWins: true, rounds: 6, winnerHpRemaining: 400, log: [], progression: [] };
        verifyTeamBattleMock.mockImplementation((req, _opts, cb) => {
            expect(req.attackers).toHaveLength(3);
            expect(req.roster).toHaveLength(5);
            expect(req.roster[4]).toMatchObject({ rank: 5, pet: { petId: '25' } });
            expect(req.teamConfig).toEqual(TEAM_PARAMS.teamConfig);
            expect(req.seed).toBeInstanceOf(Buffer);
            expect((req.seed as Buffer).length).toBe(32);
            cb(null, response);
        });
        expect(await callVerifyTeamBattle(TEAM_PARAMS)).toEqual({ ok: true, response });
    });

    // One Go process answers both calls, so repeated team failures must also stop duel
    // verification attempts, and still as a failure rather than a pass.
    it('shares the breaker with VerifyBattle', async () => {
        verifyTeamBattleMock.mockImplementation((_req, _opts, cb) => cb({ message: 'down' }, null));
        await callVerifyTeamBattle(TEAM_PARAMS);
        await callVerifyTeamBattle(TEAM_PARAMS);
        await callVerifyTeamBattle(TEAM_PARAMS);

        expect(await callVerifyBattle(PARAMS)).toMatchObject({ ok: false, reason: 'breaker-open' });
        expect(verifyBattleMock).not.toHaveBeenCalled();
    });
});
