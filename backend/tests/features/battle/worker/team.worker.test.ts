import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPublishedRulesetCache } from '@features/battle/ledger/rulesetBundle.store';

import {
    assertAnyBattleReceipt,
    hashAnyBattleReceipt,
    parseRulesetBundle,
    replayTeamBattle,
    teamReceiptFromWire,
    type WireTeamBattleReceipt,
} from '@cryptopets/protocol';

vi.mock('@config/env', () => ({ env: { battle: { cooldownSeconds: 900 }, inventory: { dropsEnabled: true } } }));
vi.mock('@config/prisma', () => ({
    prisma: {
        battleRuleset: { findUnique: vi.fn() },
        battleReceipt: { findFirst: vi.fn() },
        battleCommitment: { findUnique: vi.fn() },
        petBattleProgress: { findMany: vi.fn() },
    },
}));
vi.mock('@features/battle/ledger', async () => ({
    applyTransition: vi.fn(),
    completeOutbox: vi.fn(),
    decodeStoredTeamSnapshot: (await vi.importActual<typeof import('../../../../src/features/battle/ledger/snapshot.codec')>(
        '../../../../src/features/battle/ledger/snapshot.codec',
    )).decodeStoredTeamSnapshot,
    OUTBOX_TOPICS: { verify: 'verify', sign: 'sign', publish: 'publish' },
    ...(await vi.importActual<typeof import('@features/battle/ledger/rulesetBundle.store')>(
        '@features/battle/ledger/rulesetBundle.store',
    )),
}));
vi.mock('@features/battle/signer', () => ({
    activeSigningKey: vi.fn(),
    sign: vi.fn(),
    signerBackendError: vi.fn(),
    SignerRefusedError: class SignerRefusedError extends Error {},
}));
vi.mock('@features/inventory', () => ({ recordBattleDrops: vi.fn() }));
vi.mock('@grpc-client/verifyBattle', async () => ({
    ...(await vi.importActual<object>('@grpc-client/verifyBattle')),
    callVerifyTeamBattle: vi.fn(),
}));
vi.mock('@ws/battleRoomSocket', () => ({ notifyBattleRoomIfPresent: vi.fn() }));

import { prisma } from '@config/prisma';
import { applyTransition } from '@features/battle/ledger';
import { activeSigningKey, sign } from '@features/battle/signer';
import { recordBattleDrops } from '@features/inventory';
import { callVerifyTeamBattle } from '@grpc-client/verifyBattle';
import { processTeamCompute, processTeamSign, processTeamVerify } from '../../../../src/features/battle/worker/team.worker';

/**
 * The team stages driven with the first team receipt in protocol-team.json: its frozen
 * snapshot, real beacon, seed and geared ruleset. Each stage has to land exactly where that
 * receipt says, and signing has to produce that receipt byte for byte.
 */
const vectors = JSON.parse(readFileSync(join(__dirname, '../../../../../contracts/test-vectors/protocol-team.json'), 'utf8')) as {
    rulesets: { name: string; bundle: string }[];
    teamReceipts: { receipt: WireTeamBattleReceipt; expectedReceiptHash: string }[];
};
const WIRE = vectors.teamReceipts[0]!.receipt;
const EXPECTED_HASH = vectors.teamReceipts[0]!.expectedReceiptHash;
const RECEIPT = teamReceiptFromWire(WIRE);
const BUNDLE = JSON.parse(vectors.rulesets.find((r) => r.name === 'team-geared')!.bundle) as unknown;
const MESSAGE = { id: 'msg_1', battleId: WIRE.battleId } as never;

/** The ledger row as accept and the earlier stages would have left it. */
function row(state: string, patch: Record<string, unknown> = {}) {
    return {
        battleId: WIRE.battleId,
        kind: 'team',
        chainId: WIRE.domain.chainId,
        deploymentId: WIRE.domain.deploymentId,
        state,
        intentHash: WIRE.intentHash,
        defensePlanHash: WIRE.defensePlanHash,
        attackerOwner: WIRE.snapshot.attackers[0]!.pet.owner,
        defenderOwner: WIRE.snapshot.roster[0]!.pet.owner,
        snapshot: WIRE.snapshot,
        rulesetHash: WIRE.rulesetHash,
        rulesetVersion: WIRE.rulesetVersion,
        drandChainHash: WIRE.beacon.chainHash,
        drandRound: BigInt(WIRE.beacon.round),
        beaconSignature: WIRE.beacon.signature,
        beaconRandomness: WIRE.beacon.randomness,
        seed: WIRE.seed,
        roomId: null,
        verificationDetail: null,
        ...patch,
    } as never;
}

/** What compute stores, taken from the receipt rather than from compute itself. */
const COMPUTED = {
    attackerWon: WIRE.result.attackerWon,
    rounds: WIRE.result.rounds,
    winnerHpRemaining: WIRE.result.winnerHpRemaining,
    combatLogHash: WIRE.combatLogHash,
    progression: WIRE.progression,
};

let transitions: { request: Record<string, unknown>; tx: Record<string, Record<string, ReturnType<typeof vi.fn>>> }[];

beforeEach(() => {
    clearPublishedRulesetCache();
    vi.clearAllMocks();
    transitions = [];
    vi.mocked(prisma.battleRuleset.findUnique).mockResolvedValue({ bundle: BUNDLE } as never);
    vi.mocked(applyTransition).mockImplementation((async (request: Record<string, unknown> & { onApplied?: (tx: unknown) => Promise<void> }) => {
        const tx = {
            petBattleLock: { deleteMany: vi.fn() },
            battleReceipt: { create: vi.fn() },
            petBattleProgress: { update: vi.fn() },
        };
        await request.onApplied?.(tx);
        transitions.push({ request, tx });
        return { applied: true, state: request.to };
    }) as never);
});

describe('compute', () => {
    it('lands on the receipt result, log hash and progression, and keeps every pet locked', async () => {
        await processTeamCompute(row('seeded'), MESSAGE, RECEIPT.createdAt);
        const [{ request, tx }] = transitions as [(typeof transitions)[number]];
        expect(request).toMatchObject({ from: 'seeded', to: 'computed' });
        const patch = request.patch as Record<string, unknown>;
        expect(patch).toMatchObject({ attackerWon: COMPUTED.attackerWon, rounds: COMPUTED.rounds, combatLogHash: COMPUTED.combatLogHash });
        expect(patch).not.toHaveProperty('drawn');
        expect(patch.progression).toEqual(COMPUTED.progression);
        // All six pets fought, so none is released before the battle settles.
        expect(tx.petBattleLock!.deleteMany).not.toHaveBeenCalled();
    });
});

describe('verify', () => {
    /** What an honest Go port answers: an independent replay, in the wire's shape. */
    function goResponse() {
        const outcome = replayTeamBattle(RECEIPT.snapshot, RECEIPT.seed, parseRulesetBundle(JSON.stringify(BUNDLE)));
        return {
            attackerWins: outcome.result.attackerWins,
            rounds: outcome.result.rounds,
            winnerHpRemaining: outcome.result.winnerHpRemaining,
            attackerStartHp: outcome.startHp[0].map(Number),
            defenderStartHp: outcome.startHp[1].map(Number),
            log: outcome.log.map((s) => ({ ...s, damage: String(s.damage), heal: String(s.heal), healed: s.healed ?? -1, victimHpAfter: Number(s.victimHpAfter) })),
            progression: WIRE.progression,
        };
    }

    it('sends both squads with their placements, and moves to verified when Go agrees', async () => {
        vi.mocked(callVerifyTeamBattle).mockResolvedValue({ ok: true, response: goResponse() } as never);
        await processTeamVerify(row('computed', COMPUTED), MESSAGE, RECEIPT.createdAt);

        const sent = vi.mocked(callVerifyTeamBattle).mock.calls[0]?.[0];
        expect(sent?.attackers).toHaveLength(3);
        expect(sent?.roster.map((p) => [p.pet.petId, p.col, p.row, p.tactic])).toEqual(
            WIRE.snapshot.roster.map((m) => [m.pet.petId, m.col, m.row, m.tactic]),
        );
        expect(transitions[0]?.request).toMatchObject({ from: 'computed', to: 'verified' });
    });

    it('fails verification when one strike differs, even with the result unchanged', async () => {
        const response = goResponse();
        response.log[0] = { ...response.log[0]!, damage: String(Number(response.log[0]!.damage) + 1) };
        vi.mocked(callVerifyTeamBattle).mockResolvedValue({ ok: true, response } as never);
        await processTeamVerify(row('computed', COMPUTED), MESSAGE, RECEIPT.createdAt);
        expect(transitions[0]?.request).toMatchObject({ to: 'verification_failed' });
        expect(String((transitions[0]?.request.patch as { failureReason: string }).failureReason)).toMatch(/combatLogHash/);
    });

    it('treats an unreachable verifier as a retry, never as a pass', async () => {
        vi.mocked(callVerifyTeamBattle).mockResolvedValue({ ok: false, reason: 'transport-error', detail: 'down' } as never);
        await expect(processTeamVerify(row('computed', COMPUTED), MESSAGE, RECEIPT.createdAt)).rejects.toThrow(/unavailable/);
        expect(transitions).toHaveLength(0);
    });
});

describe('sign', () => {
    it('signs exactly the canonical receipt the protocol vectors pin, and pays out once', async () => {
        vi.mocked(prisma.battleReceipt.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.petBattleProgress.findMany).mockResolvedValue([]);
        vi.mocked(prisma.battleCommitment.findUnique).mockResolvedValue({ commitmentHash: WIRE.commitmentHash } as never);
        vi.mocked(activeSigningKey).mockReturnValue({ keyId: WIRE.signingKeyId } as never);
        // The signer validates and hashes what it is given; doing the same here proves the
        // receipt the worker built is one the protocol accepts.
        vi.mocked(sign).mockImplementation((async (request: { receipt: Parameters<typeof assertAnyBattleReceipt>[0] }) => ({
            digest: hashAnyBattleReceipt(assertAnyBattleReceipt(request.receipt)),
            signature: `0x${'44'.repeat(65)}`,
            keyId: WIRE.signingKeyId,
        })) as never);

        await processTeamSign(row('verified', COMPUTED), MESSAGE, RECEIPT.createdAt);

        const [{ request, tx }] = transitions as [(typeof transitions)[number]];
        expect(request).toMatchObject({ from: 'verified', to: 'signed' });
        const stored = tx.battleReceipt!.create.mock.calls[0]?.[0] as { data: { receiptHash: string; fighters: { create: { petId: string }[] } } };
        expect(stored.data.receiptHash).toBe(EXPECTED_HASH);
        expect(stored.data.fighters.create.map((f) => f.petId)).toEqual(RECEIPT.progression.map((p) => p.petId.toString()));
        expect(stored.data).not.toHaveProperty('attackerPetId');

        // Six fighters progress and cool down; the benched two are untouched.
        expect(tx.petBattleProgress!.update).toHaveBeenCalledTimes(6);
        expect(recordBattleDrops).toHaveBeenCalledTimes(1);
    });
});
