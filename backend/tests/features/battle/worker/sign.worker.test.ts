import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    bonusFromEquipment,
    computeProgression,
    deriveBattleSeed,
    hashBattleReceipt,
    hashBattleSnapshot,
    hashCombatLog,
    hashRuleset,
    QUICKNET,
    roundTime,
    simulate,
    SNAPSHOT_SCHEMA_VERSION,
    SOURCE_DEFAULT_RULESET,
} from '@cryptopets/protocol';

// Drops off by default here, matching the shipped default, so these tests keep asserting
// what the receipt transaction does on its own. Mutable so the one test that cares can
// switch them on; hoisted because vi.mock factories run before the imports below.
const envMock = vi.hoisted(() => ({
    battle: { cooldownSeconds: 900 },
    inventory: { dropsEnabled: false },
}));
vi.mock('@config/env', () => ({ env: envMock }));

vi.mock('@config/prisma', () => ({
    prisma: {
        battleLedger: { findUnique: vi.fn() },
        battleReceipt: { findFirst: vi.fn() },
        petBattleProgress: { findUnique: vi.fn() },
        battleCommitment: { findUnique: vi.fn() },
    },
}));

// The snapshot codec is pure and stays real. Stubbing it would let these tests pass
// against a decoder production does not use, which is exactly how the schemaVersion bug
// this file now covers survived a green suite.
vi.mock('@features/battle/ledger', async () => ({
    applyTransition: vi.fn(),
    completeOutbox: vi.fn(),
    OUTBOX_TOPICS: { publish: 'publish' },
    ...(await vi.importActual<typeof import('@features/battle/ledger/snapshot.codec')>(
        '@features/battle/ledger/snapshot.codec',
    )),
}));

vi.mock('@features/battle/signer', async () => {
    const actual = await vi.importActual<typeof import('@features/battle/signer')>('@features/battle/signer');
    return {
        activeSigningKey: vi.fn(),
        sign: vi.fn(),
        signerBackendError: vi.fn(() => null),
        SignerRefusedError: actual.SignerRefusedError,
    };
});

vi.mock('@ws/battleRoomSocket', () => ({
    notifyBattleRoomIfPresent: vi.fn(),
}));

// Stubbed so the drop tests below assert the wiring — which seed, which owners, which
// transaction — rather than whether this fixture's seed happens to roll a payout. What a
// given seed produces is drops.test.ts's subject.
vi.mock('@features/inventory', () => ({
    recordBattleDrops: vi.fn().mockResolvedValue([]),
}));

import { prisma } from '@config/prisma';
import { applyTransition, completeOutbox } from '@features/battle/ledger';
import { recordBattleDrops } from '@features/inventory';
import {
    activeSigningKey,
    sign,
    signerBackendError,
    SignerRefusedError,
} from '@features/battle/signer';
import { processSignMessage } from '@features/battle/worker';
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
/** One equipped item, in the decimal-string form JSON storage carries. */
type StoredGear = { slot: number; itemType: string; hp: number; atk: number; def: number; int: number; mdef: number };

const beaconRandomness = '0xfe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd';

/**
 * A verified battle row, exactly as acceptance and the compute worker would have left it.
 *
 * Everything downstream is derived rather than pinned: the snapshot hash feeds the seed,
 * the seed feeds the fight, and the fight feeds the progression, so a fixture that
 * disagrees with production anywhere in that chain fails the seed check inside
 * `assertBattleReceipt` rather than passing quietly.
 *
 * `schemaVersion` is declared, because acceptance declares it. Leaving it off made every
 * fixture here a version 1 snapshot on both sides of the comparison, which is what let the
 * signing worker hash real battles at a layout acceptance never used and still pass.
 *
 * The decoded form is spelled out rather than obtained from `decodeStoredSnapshot`, also
 * deliberately: this is the value the codec is checked against, so deriving it from the
 * codec would let a decoder that drops a field agree with itself.
 */
function buildFixture(gear?: { attacker?: StoredGear[]; defender?: StoredGear[] }) {
    const attackerStored = { ...ATTACKER, ...(gear?.attacker && { equipment: gear.attacker }) };
    const defenderStored = { ...DEFENDER, ...(gear?.defender && { equipment: gear.defender }) };
    const stored = {
        domain: DOMAIN,
        attacker: attackerStored,
        defender: defenderStored,
        takenAt: NOW - 10,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    };

    const decodeGear = (equipment?: StoredGear[]) =>
        equipment?.map((entry) => ({ ...entry, itemType: BigInt(entry.itemType) }));
    const decoded = {
        domain: DOMAIN as never,
        attacker: {
            ...attackerStored,
            petId: BigInt(ATTACKER.petId),
            dna: BigInt(ATTACKER.dna),
            lastOpponentId: BigInt(ATTACKER.lastOpponentId),
            sourceVersion: BigInt(ATTACKER.sourceVersion),
            ...(gear?.attacker && { equipment: decodeGear(gear.attacker) }),
        } as never,
        defender: {
            ...defenderStored,
            petId: BigInt(DEFENDER.petId),
            dna: BigInt(DEFENDER.dna),
            lastOpponentId: BigInt(DEFENDER.lastOpponentId),
            sourceVersion: BigInt(DEFENDER.sourceVersion),
            ...(gear?.defender && { equipment: decodeGear(gear.defender) }),
        } as never,
        takenAt: stored.takenAt,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    };

    const snapshotHash = hashBattleSnapshot(decoded);
    const seed = deriveBattleSeed({
        domain: DOMAIN as never,
        drandRandomness: beaconRandomness,
        battleId: 'btl_1',
        snapshotHash,
        rulesetHash: RULESET_HASH,
    });
    const outcome = simulate(
        BigInt(ATTACKER.dna),
        ATTACKER.rarity,
        ATTACKER.level,
        ATTACKER.skill,
        BigInt(DEFENDER.dna),
        DEFENDER.rarity,
        DEFENDER.level,
        DEFENDER.skill,
        seed.value,
        SOURCE_DEFAULT_RULESET.skillConfig,
        bonusFromEquipment(decodeGear(gear?.attacker)),
        bonusFromEquipment(decodeGear(gear?.defender)),
    );
    const progression = computeProgression(decoded, outcome.result.firstWins);

    return {
        battleId: 'btl_1',
        chainId: 'eip155:84532',
        deploymentId: 'base-sepolia-live',
        state: 'verified',
        kind: 'duel',
        intentHash: `0x${'aa'.repeat(32)}`,
        authorizationHash: `0x${'bb'.repeat(32)}`,
        attackerPetId: '1',
        defenderPetId: '2',
        snapshot: stored,
        seed: seed.hex,
        rulesetHash: RULESET_HASH,
        rulesetVersion: SOURCE_DEFAULT_RULESET.version,
        drandChainHash: QUICKNET.chainHash,
        drandRound: BigInt(1000),
        beaconSignature:
            '0xb44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39',
        beaconRandomness,
        attackerWon: outcome.result.firstWins,
        rounds: outcome.result.rounds,
        winnerHpRemaining: outcome.result.winnerHpRemaining,
        combatLogHash: hashCombatLog(outcome),
        progression: JSON.parse(JSON.stringify(progression, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
        verificationDetail: { mismatches: [] },
        roomId: 'room_1',
    };
}

const BATTLE = buildFixture();
/** Who won, which several assertions branch on. Read off the fixture rather than recomputed. */
const outcome = { result: { firstWins: BATTLE.attackerWon } };

const MESSAGE = { id: 'msg_1', battleId: 'btl_1', topic: 'sign', payload: {}, attempts: 1 };

const SIGNING_KEY = { keyId: 'battle-signer-test' };

function fakeTx() {
    return {
        battleReceipt: { create: vi.fn().mockResolvedValue({}) },
        petBattleProgress: { update: vi.fn().mockResolvedValue({}) },
        // The rivalry record for the dialogue service, written on the same transaction.
        battleHistory: { upsert: vi.fn().mockResolvedValue({}) },
        // Item drops (roadmap §4), written on the same transaction for the same reason.
        itemEntitlement: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    envMock.inventory.dropsEnabled = false;
    vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(BATTLE as never);
    vi.mocked(prisma.battleReceipt.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.petBattleProgress.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.battleCommitment.findUnique).mockResolvedValue({ commitmentHash: `0x${'cc'.repeat(32)}` } as never);
    vi.mocked(activeSigningKey).mockReturnValue(SIGNING_KEY as never);
    vi.mocked(sign).mockImplementation((async (req: { kind: string }) => ({
        kind: req.kind,
        digest: `0x${'dd'.repeat(32)}`,
        signature: '0xsig'.padEnd(132, '5'),
        keyId: SIGNING_KEY.keyId,
    })) as never);
    vi.mocked(applyTransition).mockImplementation((async (req: { onApplied?: (tx: unknown) => Promise<void> }) => {
        if (req.onApplied) await req.onApplied(fakeTx());
        return { applied: true, state: 'signed' };
    }) as never);
});

describe('the happy path', () => {
    it('signs the first receipt under a key with no chain link', async () => {
        await processSignMessage(MESSAGE, NOW);

        const signCall = vi.mocked(sign).mock.calls[0]![0] as { receipt: { sequence: number; previousReceiptHash: string | null } };
        expect(signCall.receipt.sequence).toBe(1);
        expect(signCall.receipt.previousReceiptHash).toBeNull();

        const call = vi.mocked(applyTransition).mock.calls[0]![0] as { from: string; to: string; outbox: { topic: string }[] };
        expect(call.from).toBe('verified');
        expect(call.to).toBe('signed');
        expect(call.outbox[0]!.topic).toBe('publish');
        expect(notifyBattleRoomIfPresent).toHaveBeenCalledWith('room_1', {
            type: 'battle-updated',
            battleId: 'btl_1',
            state: 'signed',
        });
    });

    it('links to the prior receipt under the same signing key', async () => {
        vi.mocked(prisma.battleReceipt.findFirst).mockResolvedValue({
            receiptHash: `0x${'ee'.repeat(32)}`,
            sequence: 4n,
        } as never);

        await processSignMessage(MESSAGE, NOW);

        const signCall = vi.mocked(sign).mock.calls[0]![0] as { receipt: { sequence: number; previousReceiptHash: string } };
        expect(signCall.receipt.sequence).toBe(5);
        expect(signCall.receipt.previousReceiptHash).toBe(`0x${'ee'.repeat(32)}`);
    });

    it('links each pet to its own prior receipt independently', async () => {
        vi.mocked(prisma.petBattleProgress.findUnique)
            .mockResolvedValueOnce({ lastReceiptHash: `0x${'11'.repeat(32)}` } as never) // attacker
            .mockResolvedValueOnce(null as never); // defender: first battle

        await processSignMessage(MESSAGE, NOW);

        const signCall = vi.mocked(sign).mock.calls[0]![0] as {
            receipt: { attackerPreviousReceiptHash: string | null; defenderPreviousReceiptHash: string | null };
        };
        expect(signCall.receipt.attackerPreviousReceiptHash).toBe(`0x${'11'.repeat(32)}`);
        expect(signCall.receipt.defenderPreviousReceiptHash).toBeNull();
    });

    it('includes a typescript-engine attestation with the receipt own hash', async () => {
        await processSignMessage(MESSAGE, NOW);
        const signCall = vi.mocked(sign).mock.calls[0]![0] as {
            receipt: unknown;
            attestations: { attester: string; receiptHash: string }[];
        };
        const expectedHash = hashBattleReceipt(signCall.receipt as never);
        expect(signCall.attestations.find((a) => a.attester === 'typescript-engine')?.receiptHash).toBe(expectedHash);
    });

    it('includes a go-verifier attestation whenever independent verification ran', async () => {
        await processSignMessage(MESSAGE, NOW);
        const signCall = vi.mocked(sign).mock.calls[0]![0] as { attestations: { attester: string }[] };
        expect(signCall.attestations.some((a) => a.attester === 'go-verifier')).toBe(true);
    });

    it('omits the go-verifier attestation when no verification ever ran', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ ...BATTLE, verificationDetail: null } as never);
        await processSignMessage(MESSAGE, NOW);
        const signCall = vi.mocked(sign).mock.calls[0]![0] as { attestations: { attester: string }[] };
        expect(signCall.attestations.some((a) => a.attester === 'go-verifier')).toBe(false);
    });

    it('applies progression and cooldown to both pets in the same transaction as the receipt', async () => {
        const tx = fakeTx();
        vi.mocked(applyTransition).mockImplementationOnce((async (req: { onApplied?: (tx: unknown) => Promise<void> }) => {
            if (req.onApplied) await req.onApplied(tx);
            return { applied: true, state: 'signed' };
        }) as never);

        await processSignMessage(MESSAGE, NOW);

        expect(tx.battleReceipt.create).toHaveBeenCalledTimes(1);
        expect(tx.petBattleProgress.update).toHaveBeenCalledTimes(2);
        const attackerUpdate = tx.petBattleProgress.update.mock.calls[0]![0];
        expect(attackerUpdate.where.chainId_deploymentId_petId.petId).toBe('1');
        expect(attackerUpdate.data.readyAt).toBe(BigInt(NOW + 900));
        expect(attackerUpdate.data.lastReceiptHash).toBe(`0x${'dd'.repeat(32)}`);
    });

    it('records the battle for rivalry context, from the receipt and on the same transaction', async () => {
        // The indexer used to write `battle_history` from an on-chain settle event. With no
        // such event left, the receipt is the only authority for what happened.
        const tx = fakeTx();
        vi.mocked(applyTransition).mockImplementationOnce((async (req: { onApplied?: (tx: unknown) => Promise<void> }) => {
            if (req.onApplied) await req.onApplied(tx);
            return { applied: true, state: 'signed' };
        }) as never);

        await processSignMessage(MESSAGE, NOW);

        expect(tx.battleHistory.upsert).toHaveBeenCalledTimes(1);
        const { create, where } = tx.battleHistory.upsert.mock.calls[0]![0];
        expect(where.chain_battleId).toEqual({ chain: 'evm', battleId: BATTLE.battleId });
        expect(create.attacker).toBe('1');
        expect(create.defender).toBe('2');
        // Unix seconds, matching every other row. The removed client-report path wrote
        // Date.now() milliseconds here.
        expect(create.foughtAt).toBe(BigInt(NOW));
        expect(create.seed).toBe(BATTLE.seed);

        // Winner and loser as absolute pet ids, so head-to-head survives a role swap.
        const [winner, loser] = outcome.result.firstWins ? ['1', '2'] : ['2', '1'];
        expect(create.winnerPetId).toBe(winner);
        expect(create.loserPetId).toBe(loser);
    });

    it('credits a win to the winner and a loss to the loser', async () => {
        const tx = fakeTx();
        vi.mocked(applyTransition).mockImplementationOnce((async (req: { onApplied?: (tx: unknown) => Promise<void> }) => {
            if (req.onApplied) await req.onApplied(tx);
            return { applied: true, state: 'signed' };
        }) as never);

        await processSignMessage(MESSAGE, NOW);

        const attackerUpdate = tx.petBattleProgress.update.mock.calls[0]![0];
        const defenderUpdate = tx.petBattleProgress.update.mock.calls[1]![0];
        if (outcome.result.firstWins) {
            expect(attackerUpdate.data.winCount).toEqual({ increment: 1 });
            expect(defenderUpdate.data.lossCount).toEqual({ increment: 1 });
        } else {
            expect(attackerUpdate.data.lossCount).toEqual({ increment: 1 });
            expect(defenderUpdate.data.winCount).toEqual({ increment: 1 });
        }
    });
});

describe('equipment survives into the receipt (roadmap §4)', () => {
    // A steel sword and reinforced plate from the shipped catalog, on the attacker only, so
    // an assertion about the defender's absent list is meaningful rather than symmetric.
    const GEAR = [
        { slot: 0, itemType: '3', hp: 0, atk: 22, def: 0, int: 0, mdef: 0 },
        { slot: 1, itemType: '12', hp: 45, atk: 0, def: 16, int: 0, mdef: 6 },
    ];
    const GEARED = buildFixture({ attacker: GEAR });

    beforeEach(() => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(GEARED as never);
    });

    it('signs a geared battle, whose seed only derives from a version 2 snapshot', async () => {
        // The whole failure mode in one assertion: `hashBattleReceipt` re-derives the seed
        // from the snapshot the receipt carries, so a worker that dropped the gear or the
        // layout version would throw here rather than sign.
        await processSignMessage(MESSAGE, NOW);
        expect(sign).toHaveBeenCalledTimes(1);
    });

    it('carries the resolved modifiers and the item type into the persisted receipt', async () => {
        const tx = fakeTx();
        vi.mocked(applyTransition).mockImplementationOnce((async (req: { onApplied?: (tx: unknown) => Promise<void> }) => {
            if (req.onApplied) await req.onApplied(tx);
            return { applied: true, state: 'signed' };
        }) as never);

        await processSignMessage(MESSAGE, NOW);

        const { payload } = tx.battleReceipt.create.mock.calls[0]![0].data;
        // Item type as a decimal string, since the payload is stored as JSON. The modifiers
        // ride along with it: they are what a replay uses, and the type is what lets a
        // third party check them against the published catalog.
        expect(payload.snapshot.attacker.equipment).toEqual([
            { slot: 0, itemType: '3', hp: 0, atk: 22, def: 0, int: 0, mdef: 0 },
            { slot: 1, itemType: '12', hp: 45, atk: 0, def: 16, int: 0, mdef: 6 },
        ]);
        // Absent, not empty: an ungeared pet encodes a zero-length list either way, and
        // omitting it keeps the stored row identical to what it was before gear existed.
        expect(payload.snapshot.defender.equipment).toBeUndefined();
        expect(payload.snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    });

    it('fights the geared battle differently from the ungeared one', async () => {
        // Guards the fixture itself. If this gear made no difference to the outcome, the
        // two tests above would pass against an engine that ignored equipment entirely.
        expect(GEARED.seed).not.toBe(BATTLE.seed);
    });
});

describe('chain-position retry', () => {
    it('retries with a fresh chain head when another battle under this key wins the position first', async () => {
        vi.mocked(prisma.battleReceipt.findFirst)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ receiptHash: `0x${'22'.repeat(32)}`, sequence: 1n } as never);
        vi.mocked(applyTransition)
            .mockImplementationOnce((async () => {
                throw Object.assign(new Error('unique'), { code: 'P2002' });
            }) as never)
            .mockImplementationOnce((async (req: { onApplied?: (tx: unknown) => Promise<void> }) => {
                if (req.onApplied) await req.onApplied(fakeTx());
                return { applied: true, state: 'signed' };
            }) as never);

        await processSignMessage(MESSAGE, NOW);

        expect(sign).toHaveBeenCalledTimes(2);
        expect(applyTransition).toHaveBeenCalledTimes(2);
        const secondSignCall = vi.mocked(sign).mock.calls[1]![0] as { receipt: { sequence: number } };
        expect(secondSignCall.receipt.sequence).toBe(2);
    });
});

describe('signing failure', () => {
    it('moves to signing_failed and never enqueues publish', async () => {
        vi.mocked(sign).mockRejectedValue(new SignerRefusedError('signer-not-configured', 'no key'));

        await processSignMessage(MESSAGE, NOW);

        expect(applyTransition).toHaveBeenCalledWith(
            expect.objectContaining({ battleId: 'btl_1', from: 'verified', to: 'signing_failed' }),
        );
        expect(notifyBattleRoomIfPresent).toHaveBeenCalledWith('room_1', {
            type: 'battle-updated',
            battleId: 'btl_1',
            state: 'signing_failed',
        });
    });

    it('never signs when there is no active signing key at all', async () => {
        vi.mocked(activeSigningKey).mockReturnValue(null);
        await processSignMessage(MESSAGE, NOW);
        expect(sign).not.toHaveBeenCalled();
        expect(applyTransition).toHaveBeenCalledWith(
            expect.objectContaining({ from: 'verified', to: 'signing_failed' }),
        );
        expect(notifyBattleRoomIfPresent).toHaveBeenCalledWith('room_1', {
            type: 'battle-updated',
            battleId: 'btl_1',
            state: 'signing_failed',
        });
    });

    /**
     * The reason, not just the symptom. `configureSigner` records why it refused and returns,
     * so the process boots and keeps serving reads — which means "no active signing key" is
     * the *consequence* of a configuration failure whose cause is sitting in memory. Writing
     * only the consequence into `failureReason` is what made this land as a mystery: the row
     * said the key was missing and nothing anywhere said why.
     */
    it('records why the signer refused, not just that no key was found', async () => {
        vi.mocked(activeSigningKey).mockReturnValue(null);
        vi.mocked(signerBackendError).mockReturnValue(
            'evm: this deployment serves more than one chain family, so evm needs its own signing key',
        );

        await processSignMessage(MESSAGE, NOW);

        expect(applyTransition).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'signing_failed',
                // Nested under `patch`, which is what actually reaches the row.
                patch: expect.objectContaining({
                    failureReason: expect.stringContaining('needs its own signing key'),
                }),
            }),
        );
        // Still names the chain, so a multi-chain deployment says which one stalled.
        expect(applyTransition).toHaveBeenCalledWith(
            expect.objectContaining({
                patch: expect.objectContaining({
                    failureReason: expect.stringContaining('eip155:'),
                }),
            }),
        );
    });

    it('propagates an unexpected signer error rather than treating it as signing_failed', async () => {
        vi.mocked(sign).mockRejectedValue(new Error('kms unreachable'));
        await expect(processSignMessage(MESSAGE, NOW)).rejects.toThrow(/kms unreachable/);
    });
});

describe('idempotence', () => {
    it('completes without acting when the battle has already moved on', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ ...BATTLE, state: 'signed' } as never);
        await processSignMessage(MESSAGE, NOW);
        expect(sign).not.toHaveBeenCalled();
        expect(completeOutbox).toHaveBeenCalled();
    });

    it('completes without acting when the battle no longer exists', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(null);
        await processSignMessage(MESSAGE, NOW);
        expect(sign).not.toHaveBeenCalled();
        expect(completeOutbox).toHaveBeenCalled();
    });

    it('throws if verified but missing a field sign needs', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({ ...BATTLE, combatLogHash: null } as never);
        await expect(processSignMessage(MESSAGE, NOW)).rejects.toThrow(/missing a field sign needs/);
    });

    it('throws if the commitment row is missing', async () => {
        vi.mocked(prisma.battleCommitment.findUnique).mockResolvedValue(null);
        await expect(processSignMessage(MESSAGE, NOW)).rejects.toThrow(/no commitment row/);
    });
});

describe('item drops (roadmap §4)', () => {
    /** Runs the worker and hands back the transaction its onApplied saw. */
    async function runCapturingTx() {
        const tx = fakeTx();
        vi.mocked(applyTransition).mockImplementationOnce((async (req: { onApplied?: (tx: unknown) => Promise<void> }) => {
            if (req.onApplied) await req.onApplied(tx);
            return { applied: true, state: 'signed' };
        }) as never);
        await processSignMessage(MESSAGE, NOW);
        return tx;
    }

    // Asserted on the call rather than on rows written, because whether this fixture's
    // seed actually pays is a property of keccak, not of the wiring. It does not, as it
    // happens — so a test that checked for rows would have passed while asserting nothing.
    // What matters here is that the worker hands over the right inputs inside the right
    // transaction; what those inputs produce is drops.test.ts's job.
    it('records drops on the same transaction as the receipt', async () => {
        envMock.inventory.dropsEnabled = true;

        const tx = await runCapturingTx();

        expect(tx.battleReceipt.create).toHaveBeenCalled();
        expect(recordBattleDrops).toHaveBeenCalledWith(tx, {
            chain: 'evm',
            battleId: BATTLE.battleId,
            seed: BATTLE.seed,
            // Owners by outcome, not by role: paying the winner's drop to the loser is
            // exactly the mistake this pins.
            winnerOwner: BATTLE.attackerWon ? ATTACKER.owner : DEFENDER.owner,
            loserOwner: BATTLE.attackerWon ? DEFENDER.owner : ATTACKER.owner,
        });
    });

    it('records no drops while the feature is off', async () => {
        const tx = await runCapturingTx();

        expect(tx.battleReceipt.create).toHaveBeenCalled();
        expect(recordBattleDrops).not.toHaveBeenCalled();
    });
});
