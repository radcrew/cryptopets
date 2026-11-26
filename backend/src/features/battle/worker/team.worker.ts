import {
    chainFamily,
    computeTeamProgression,
    hashTeamBattleReceipt,
    hashTeamCombatLog,
    type Hex,
    loadRulesetBundle,
    type PetProgression,
    replayTeamBattle,
    type Ruleset,
    type TeamBattleReceipt,
    type TeamOutcome,
} from '@cryptopets/protocol';
import type { Prisma } from '@generated/prisma/client';
import { BattleState } from '@generated/prisma/enums';

import { env } from '@config/env';
import { prisma } from '@config/prisma';
import { applyTransition, type ClaimedMessage, completeOutbox, decodeStoredTeamSnapshot, OUTBOX_TOPICS } from '@features/battle/ledger';
import { activeSigningKey, sign, signerBackendError, SignerRefusedError } from '@features/battle/signer';
import { recordBattleDrops } from '@features/inventory';
import { callVerifyTeamBattle, type VerifyTeamBattleWire, verifyPetInputs } from '@grpc-client/verifyBattle';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

import { buildAttestations, commitmentHashFor, failSigning, serializeBigints } from './sign.shared';

/**
 * The compute, verify and sign stages for a team battle (docs/plan-team-battles-3v3.md,
 * Phase 4). Each duel worker hands a team battle here as soon as it has loaded the row, so the
 * outbox topics, the state machine and the retry behaviour are the duel's; only the work done at
 * each stage differs.
 *
 * - compute: the team engine (`replayTeamBattle`) and six progressions.
 * - verify: the Go port recomputes the fight and the progressions (`VerifyTeamBattle`), and its
 *   strike log is hashed with the one canonical encoder, as for duels.
 * - sign: receipt schema 2, six fighter links, six progressions applied with their cooldowns, and
 *   drops once per battle. No `battle_history` rows: that table is head-to-head context for duel
 *   dialogue, and a three-on-three result is not a head-to-head between two pets.
 */

type LedgerRow = NonNullable<Awaited<ReturnType<typeof prisma.battleLedger.findUnique>>>;

const MAX_RECEIPT_CHAIN_RETRIES = 5;

export async function processTeamCompute(battle: LedgerRow, message: ClaimedMessage, nowSeconds: number): Promise<void> {
    if (battle.state !== BattleState.seeded) {
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    if (!battle.seed) {
        throw new Error(`battle ${battle.battleId} is seeded but has no seed recorded`);
    }
    const ruleset = await loadBattleRuleset(battle);
    const snapshot = decodeStoredTeamSnapshot(battle.snapshot);
    const outcome = replayTeamBattle(snapshot, battle.seed as Hex, ruleset);
    const progression = computeTeamProgression(snapshot, outcome.result.attackerWins, { maxLevel: ruleset.maxLevel });

    await applyTransition({
        battleId: battle.battleId,
        from: BattleState.seeded,
        to: BattleState.computed,
        patch: {
            attackerWon: outcome.result.attackerWins,
            rounds: outcome.result.rounds,
            winnerHpRemaining: outcome.result.winnerHpRemaining,
            // The start HP travels with the log: the log hash covers both, so a stored log
            // without them could not be re-hashed or replayed on its own.
            combatLog: serializeBigints({ startHp: outcome.startHp, log: outcome.log }),
            combatLogHash: hashTeamCombatLog(outcome),
            progression: serializeBigints(progression),
        },
        outbox: [{ battleId: battle.battleId, topic: OUTBOX_TOPICS.verify }],
    });
    notifyBattleRoomIfPresent(battle.roomId, { type: 'battle-updated', battleId: battle.battleId, state: BattleState.computed });
    await completeOutbox(message.id, new Date(nowSeconds * 1000));
}

export async function processTeamVerify(battle: LedgerRow, message: ClaimedMessage, nowSeconds: number): Promise<void> {
    if (battle.state !== BattleState.computed) {
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    if (!battle.seed || !battle.combatLogHash || battle.attackerWon === null || battle.rounds === null || battle.winnerHpRemaining === null) {
        throw new Error(`battle ${battle.battleId} is computed but is missing a computed field`);
    }
    const ruleset = await loadBattleRuleset(battle);
    if (!ruleset.teamConfig) {
        throw new Error(`ruleset ${battle.rulesetHash} has no team rules; cannot verify team battle ${battle.battleId}`);
    }
    const snapshot = decodeStoredTeamSnapshot(battle.snapshot);
    const go = await callVerifyTeamBattle({
        attackers: snapshot.attackers.map((m) => ({ pet: verifyPetInputs(m.pet), col: m.col, row: m.row, tactic: m.tactic })),
        roster: snapshot.roster.map((m) => ({ pet: verifyPetInputs(m.pet), col: m.col, row: m.row, tactic: m.tactic })),
        seed: battle.seed,
        skillConfig: ruleset.skillConfig,
        teamConfig: { ...ruleset.teamConfig, turnOrder: 'int' },
        maxLevel: ruleset.maxLevel,
    });
    if (!go.ok) {
        // Not a disagreement: the dispatcher's backoff retries it, as for duels.
        throw new Error(`indexer-go team verification unavailable (${go.reason}): ${go.detail}`);
    }

    const mismatches = compareTeam(battle, go.response);
    const verificationDetail = serializeBigints({ goResponse: go.response, mismatches, checkedAt: nowSeconds });
    const passed = mismatches.length === 0;
    await applyTransition({
        battleId: battle.battleId,
        from: BattleState.computed,
        to: passed ? BattleState.verified : BattleState.verification_failed,
        patch: passed ? { verificationDetail } : { failureReason: `engine mismatch: ${mismatches.join('; ')}`, verificationDetail },
        ...(passed && { outbox: [{ battleId: battle.battleId, topic: OUTBOX_TOPICS.sign }] }),
    });
    notifyBattleRoomIfPresent(battle.roomId, {
        type: 'battle-updated',
        battleId: battle.battleId,
        state: passed ? BattleState.verified : BattleState.verification_failed,
    });
    await completeOutbox(message.id, new Date(nowSeconds * 1000));
}

export async function processTeamSign(battle: LedgerRow, message: ClaimedMessage, nowSeconds: number): Promise<void> {
    if (battle.state !== BattleState.verified) {
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    if (
        !battle.seed ||
        !battle.combatLogHash ||
        !battle.beaconSignature ||
        !battle.beaconRandomness ||
        !battle.defensePlanHash ||
        !battle.progression ||
        battle.attackerWon === null ||
        battle.rounds === null ||
        battle.winnerHpRemaining === null
    ) {
        throw new Error(`team battle ${battle.battleId} is verified but is missing a field sign needs`);
    }
    const snapshot = decodeStoredTeamSnapshot(battle.snapshot);
    const progression = (battle.progression as unknown as StoredProgression[]).map(deserializeProgression);
    const fighterIds = [...snapshot.attackers, ...snapshot.roster].map((m) => m.pet.petId.toString());

    for (let attempt = 0; attempt < MAX_RECEIPT_CHAIN_RETRIES; attempt++) {
        const key = activeSigningKey(battle.chainId);
        if (!key) {
            const why = signerBackendError();
            await failSigning(battle.battleId, battle.roomId, `no active signing key for ${battle.chainId}${why ? `: ${why}` : ''}`);
            await completeOutbox(message.id, new Date(nowSeconds * 1000));
            return;
        }

        const [globalHead, heads] = await Promise.all([
            prisma.battleReceipt.findFirst({ where: { signingKeyId: key.keyId }, orderBy: { sequence: 'desc' }, select: { receiptHash: true, sequence: true } }),
            prisma.petBattleProgress.findMany({
                where: { chainId: battle.chainId, deploymentId: battle.deploymentId, petId: { in: fighterIds } },
                select: { petId: true, lastReceiptHash: true },
            }),
        ]);
        const headOf = new Map(heads.map((h) => [h.petId, h.lastReceiptHash]));

        const receipt: TeamBattleReceipt = {
            schemaVersion: 2,
            domain: { chainId: battle.chainId as never, deploymentId: battle.deploymentId },
            battleId: battle.battleId,
            intentHash: battle.intentHash as Hex,
            commitmentHash: (await commitmentHashFor(battle.battleId)) as Hex,
            defensePlanHash: battle.defensePlanHash as Hex,
            snapshot,
            beacon: {
                chainHash: battle.drandChainHash as Hex,
                round: Number(battle.drandRound),
                signature: battle.beaconSignature as Hex,
                randomness: battle.beaconRandomness as Hex,
            },
            seed: battle.seed as Hex,
            rulesetVersion: battle.rulesetVersion,
            rulesetHash: battle.rulesetHash as Hex,
            result: { attackerWon: battle.attackerWon, rounds: battle.rounds, winnerHpRemaining: battle.winnerHpRemaining },
            combatLogHash: battle.combatLogHash as Hex,
            progression,
            sequence: globalHead ? Number(globalHead.sequence) + 1 : 1,
            previousReceiptHash: (globalHead?.receiptHash ?? null) as Hex | null,
            fighterPreviousReceiptHashes: fighterIds.map((id) => (headOf.get(id) ?? null) as Hex | null),
            createdAt: nowSeconds,
            signingKeyId: key.keyId,
        };

        const attestations = buildAttestations(battle, hashTeamBattleReceipt(receipt), nowSeconds);
        let signed: Awaited<ReturnType<typeof sign>>;
        try {
            signed = await sign({ kind: 'receipt', receipt, attestations }, nowSeconds);
        } catch (error) {
            if (error instanceof SignerRefusedError) {
                await failSigning(battle.battleId, battle.roomId, error.message);
                await completeOutbox(message.id, new Date(nowSeconds * 1000));
                return;
            }
            throw error;
        }

        try {
            await applyTransition({
                battleId: battle.battleId,
                from: BattleState.verified,
                to: BattleState.signed,
                onApplied: async (tx) => {
                    await tx.battleReceipt.create({
                        data: {
                            receiptHash: signed.digest,
                            battleId: battle.battleId,
                            chainId: battle.chainId,
                            deploymentId: battle.deploymentId,
                            signingKeyId: signed.keyId,
                            sequence: BigInt(receipt.sequence),
                            previousReceiptHash: receipt.previousReceiptHash,
                            payload: serializeBigints(receipt),
                            signature: signed.signature,
                            createdAt: BigInt(receipt.createdAt),
                            fighters: {
                                create: fighterIds.map((petId, position) => ({
                                    position,
                                    chainId: battle.chainId,
                                    petId,
                                    previousReceiptHash: receipt.fighterPreviousReceiptHashes[position] ?? null,
                                })),
                            },
                        },
                    });
                    await applyTeamProgression(tx, battle, progression, signed.digest, nowSeconds);
                    // Once per battle, from the receipt's own seed, as for duels.
                    if (env.inventory.dropsEnabled) {
                        await recordBattleDrops(tx, {
                            chain: chainFamily(battle.chainId as never),
                            battleId: battle.battleId,
                            seed: receipt.seed,
                            winnerOwner: receipt.result.attackerWon ? battle.attackerOwner : battle.defenderOwner,
                            loserOwner: receipt.result.attackerWon ? battle.defenderOwner : battle.attackerOwner,
                        });
                    }
                },
                outbox: [{ battleId: battle.battleId, topic: OUTBOX_TOPICS.publish }],
            });
        } catch (error) {
            if ((error as { code?: string }).code === 'P2002') {
                continue; // another battle under this key took the chain position; retry
            }
            throw error;
        }

        notifyBattleRoomIfPresent(battle.roomId, { type: 'battle-updated', battleId: battle.battleId, state: BattleState.signed });
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    throw new Error(`could not claim a receipt chain position for battle ${battle.battleId} after ${MAX_RECEIPT_CHAIN_RETRIES} attempts`);
}

/** The ruleset bundle the battle named, checked against its hash before any field is trusted. */
async function loadBattleRuleset(battle: LedgerRow): Promise<Ruleset> {
    const row = await prisma.battleRuleset.findUnique({ where: { rulesetHash: battle.rulesetHash } });
    if (!row) {
        throw new Error(`no published ruleset bundle for ${battle.rulesetHash}; cannot process battle ${battle.battleId}`);
    }
    return loadRulesetBundle(JSON.stringify(row.bundle), battle.rulesetHash as Hex);
}

/** Every disagreement between the stored TypeScript result and Go's, as readable lines. */
function compareTeam(battle: LedgerRow, go: VerifyTeamBattleWire): string[] {
    const mismatches: string[] = [];
    if (battle.attackerWon !== go.attackerWins) mismatches.push(`winner: ts=${battle.attackerWon} go=${go.attackerWins}`);
    if (battle.rounds !== go.rounds) mismatches.push(`rounds: ts=${battle.rounds} go=${go.rounds}`);
    if (battle.winnerHpRemaining !== go.winnerHpRemaining) {
        mismatches.push(`winnerHpRemaining: ts=${battle.winnerHpRemaining} go=${go.winnerHpRemaining}`);
    }

    // Go's log, rebuilt in the protocol's shape and hashed by the one canonical encoder: the
    // question is whether the engines computed the same strikes, never whether two encoders agree.
    const goOutcome: TeamOutcome = {
        result: { attackerWins: go.attackerWins, rounds: go.rounds, winnerHpRemaining: go.winnerHpRemaining },
        startHp: [go.attackerStartHp.map((hp) => BigInt(hp)), go.defenderStartHp.map((hp) => BigInt(hp))],
        finalHp: [[], []],
        log: go.log.map((s) => ({
            round: s.round,
            side: s.side as 0 | 1,
            actor: s.actor,
            target: s.target,
            victim: s.victim,
            isMagic: s.isMagic,
            crit: s.crit,
            damage: BigInt(s.damage),
            elementMult: s.elementMult,
            combo: s.combo,
            longShot: s.longShot,
            furyTriggered: s.furyTriggered,
            temperament: s.temperament,
            exposed: s.exposed,
            guarded: s.guarded,
            secondChance: s.secondChance,
            knockedOut: s.knockedOut,
            heal: BigInt(s.heal),
            healed: s.healed < 0 ? null : s.healed,
            victimHpAfter: BigInt(s.victimHpAfter),
        })),
    };
    const goLogHash = hashTeamCombatLog(goOutcome);
    if (goLogHash.toLowerCase() !== battle.combatLogHash?.toLowerCase()) {
        mismatches.push(`combatLogHash: ts=${battle.combatLogHash} go=${goLogHash}`);
    }

    const ts = (battle.progression as unknown as Record<string, unknown>[] | null) ?? [];
    if (ts.length !== go.progression.length) mismatches.push(`progression: ts has ${ts.length} fighters, go ${go.progression.length}`);
    go.progression.forEach((goPet, i) => {
        const tsPet = ts[i] ?? {};
        for (const field of PROGRESSION_FIELDS) {
            // Stringified so a bigint id on one side and a decimal string on the other compare equal.
            if (String(tsPet[field]) !== String((goPet as unknown as Record<string, unknown>)[field])) {
                mismatches.push(`fighter ${i}.${field}: ts=${String(tsPet[field])} go=${String((goPet as unknown as Record<string, unknown>)[field])}`);
            }
        }
    });
    return mismatches;
}

const PROGRESSION_FIELDS = ['petId', 'won', 'decayShift', 'xpAwarded', 'lastOpponentId', 'streak', 'level', 'xp', 'leveledUp'] as const;

/** The six fighters' progression, cooldown and receipt-chain head, written with the receipt. */
async function applyTeamProgression(
    tx: Prisma.TransactionClient,
    battle: { chainId: string; deploymentId: string },
    progression: PetProgression[],
    receiptHash: Hex,
    nowSeconds: number,
): Promise<void> {
    const readyAt = BigInt(nowSeconds + env.battle.cooldownSeconds);
    for (const pet of progression) {
        await tx.petBattleProgress.update({
            where: { chainId_deploymentId_petId: { chainId: battle.chainId, deploymentId: battle.deploymentId, petId: pet.petId.toString() } },
            data: {
                level: pet.level,
                xp: pet.xp,
                lastOpponentId: pet.lastOpponentId.toString(),
                streak: pet.streak,
                winCount: { increment: pet.won ? 1 : 0 },
                lossCount: { increment: pet.won ? 0 : 1 },
                readyAt,
                lastReceiptHash: receiptHash,
            },
        });
    }
}

interface StoredProgression {
    petId: string;
    won: boolean;
    decayShift: number;
    xpAwarded: number;
    lastOpponentId: string;
    streak: number;
    level: number;
    xp: number;
    leveledUp: boolean;
}

function deserializeProgression(pet: StoredProgression): PetProgression {
    return { ...pet, petId: BigInt(pet.petId), lastOpponentId: BigInt(pet.lastOpponentId) };
}
