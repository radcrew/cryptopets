import {
    type BattleReceipt,
    type BattleSnapshot,
    chainFamily,
    hashBattleReceipt,
    type Hex,
    type ProgressionDelta,
} from '@cryptopets/protocol';
import { BattleState } from '@generated/prisma/enums';
import type { Prisma } from '@generated/prisma/client';

import { env } from '@config/env';
import { prisma } from '@config/prisma';
import {
    applyTransition,
    type ClaimedMessage,
    completeOutbox,
    decodeStoredSnapshot,
    OUTBOX_TOPICS,
} from '@features/battle/ledger';
import {
    activeSigningKey,
    type EngineAttestation,
    sign,
    signerBackendError,
    SignerRefusedError,
} from '@features/battle/signer';
// Straight from its module rather than the barrel: a pure check, so module mocks never hide it.
import { assertDuel } from '@features/battle/ledger/kind';
import { recordBattleDrops } from '@features/inventory';
import { recordBattleFromReceipt } from '@repositories/history.repository';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

/**
 * Handles `sign` messages: `verified` -> `signed` (§G).
 *
 * This is where a computed, cross-verified battle becomes a permanent, checkable
 * record. Three things happen atomically with the state move: the receipt row is
 * created, both pets' off-chain progression is applied (level, XP, streak,
 * opponent history, win/loss count, cooldown), and both pets' per-pet receipt
 * chain head advances — because a receipt that updated progression but did not
 * record itself as that pet's new chain head would make the next battle's
 * `attackerPreviousReceiptHash` a lie.
 *
 * The signer itself refuses to sign anything that is not a well-formed receipt
 * with the required attestations (`battle-signer`'s job, not this file's), so
 * this worker's job is assembling the receipt correctly and handling the one
 * real race: two different battles under the same signing key contending for
 * the next global chain position.
 */
export async function processSignMessage(message: ClaimedMessage, nowSeconds: number): Promise<void> {
    const row = await prisma.battleLedger.findUnique({ where: { battleId: message.battleId } });
    if (!row) {
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    const battle = assertDuel(row);
    if (battle.state !== BattleState.verified) {
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    if (
        !battle.seed ||
        !battle.combatLogHash ||
        !battle.beaconSignature ||
        !battle.beaconRandomness ||
        battle.attackerWon === null ||
        battle.rounds === null ||
        battle.winnerHpRemaining === null ||
        !battle.progression
    ) {
        throw new Error(`battle ${battle.battleId} is verified but is missing a field sign needs`);
    }

    // Decoded through the shared codec, which is what carries `schemaVersion` and the
    // equipment list back out of storage. Rebuilding the snapshot field by field here is
    // what previously dropped both: the receipt then encoded at layout version 1, its
    // snapshot hash stopped matching the one acceptance committed, and the seed check
    // inside `assertBattleReceipt` refused the receipt for every battle, geared or not.
    const snapshot: BattleSnapshot = decodeStoredSnapshot(battle.snapshot);
    // Same deserialization need: PetProgression.petId/lastOpponentId are bigint in
    // the protocol type but decimal strings in storage.
    const storedProgression = battle.progression as unknown as {
        attacker: StoredProgression;
        defender: StoredProgression;
    };
    const progression: ProgressionDelta = {
        attacker: deserializeProgression(storedProgression.attacker),
        defender: deserializeProgression(storedProgression.defender),
    };

    for (let attempt = 0; attempt < MAX_RECEIPT_CHAIN_RETRIES; attempt++) {
        // Keyed by this battle's own chain, since §G gives each reward domain its own key.
        const key = activeSigningKey(battle.chainId);
        if (!key) {
            // `signerBackendError` holds why configuration was refused. Without it this said
            // only that there was no key, which is the symptom — and the reason (a missing
            // env var, a KMS that would not answer, a per-domain key id this deployment now
            // needs) was sitting in memory unreported. It ends up in `failureReason`, so it
            // survives to whoever reads the row afterwards.
            const why = signerBackendError();
            await failSigning(
                battle.battleId,
                battle.roomId,
                `no active signing key for ${battle.chainId}${why ? `: ${why}` : ''}`,
            );
            await completeOutbox(message.id, new Date(nowSeconds * 1000));
            return;
        }

        const [globalHead, attackerHead, defenderHead] = await Promise.all([
            prisma.battleReceipt.findFirst({
                where: { signingKeyId: key.keyId },
                orderBy: { sequence: 'desc' },
                select: { receiptHash: true, sequence: true },
            }),
            prisma.petBattleProgress.findUnique({
                where: {
                    chainId_deploymentId_petId: {
                        chainId: battle.chainId,
                        deploymentId: battle.deploymentId,
                        petId: battle.attackerPetId,
                    },
                },
                select: { lastReceiptHash: true },
            }),
            prisma.petBattleProgress.findUnique({
                where: {
                    chainId_deploymentId_petId: {
                        chainId: battle.chainId,
                        deploymentId: battle.deploymentId,
                        petId: battle.defenderPetId,
                    },
                },
                select: { lastReceiptHash: true },
            }),
        ]);

        const receipt: BattleReceipt = {
            domain: { chainId: battle.chainId as never, deploymentId: battle.deploymentId },
            battleId: battle.battleId,
            intentHash: battle.intentHash as Hex,
            commitmentHash: (await commitmentHashFor(battle.battleId)) as Hex,
            defenseAuthorizationHash: duelAuthorizationHash(battle),
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
            result: {
                attackerWon: battle.attackerWon,
                rounds: battle.rounds,
                winnerHpRemaining: battle.winnerHpRemaining,
            },
            combatLogHash: battle.combatLogHash as Hex,
            progression,
            sequence: globalHead ? Number(globalHead.sequence) + 1 : 1,
            previousReceiptHash: (globalHead?.receiptHash ?? null) as Hex | null,
            attackerPreviousReceiptHash: (attackerHead?.lastReceiptHash ?? null) as Hex | null,
            defenderPreviousReceiptHash: (defenderHead?.lastReceiptHash ?? null) as Hex | null,
            createdAt: nowSeconds,
            signingKeyId: key.keyId,
        };

        // The signer refuses a stale attestation, so it has to name the digest of
        // *this exact* receipt. Computed here rather than left to the signer alone,
        // so the attestation list is correct before the call rather than trusting a
        // round trip to line the two up.
        const receiptHash = hashBattleReceipt(receipt);
        const attestations = buildAttestations(battle, receiptHash, nowSeconds);

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
                            attackerPetId: battle.attackerPetId,
                            defenderPetId: battle.defenderPetId,
                            signingKeyId: signed.keyId,
                            sequence: BigInt(receipt.sequence),
                            previousReceiptHash: receipt.previousReceiptHash,
                            attackerPreviousReceiptHash: receipt.attackerPreviousReceiptHash,
                            defenderPreviousReceiptHash: receipt.defenderPreviousReceiptHash,
                            payload: serializeBigints(receipt),
                            signature: signed.signature,
                            createdAt: BigInt(receipt.createdAt),
                        },
                    });
                    await applyProgression(tx, battle, progression, signed.digest, nowSeconds);
                    // Rivalry context for the dialogue service (`battle_history`). Written
                    // here, from the receipt, because the indexer that used to fill this
                    // table decoded on-chain settle events and there are none any more.
                    await recordBattleFromReceipt(tx, {
                        chain: chainFamily(battle.chainId as never),
                        battleId: battle.battleId,
                        attacker: battle.attackerPetId,
                        defender: battle.defenderPetId,
                        // From the receipt, not the ledger row it was built from: the
                        // receipt is what was signed, so it is what the record should agree
                        // with, and its result fields are non-null by construction.
                        attackerWon: receipt.result.attackerWon,
                        foughtAt: receipt.createdAt,
                        seed: receipt.seed,
                        rounds: receipt.result.rounds,
                        winnerHpRemaining: receipt.result.winnerHpRemaining,
                        attackerXp: progression.attacker.xpAwarded,
                        defenderXp: progression.defender.xpAwarded,
                    });
                    // Item drops (roadmap §4). In this transaction for the same reason
                    // battle_history is: a battle that paid a drop without recording the
                    // battle, or recorded one without paying, is two writes that can
                    // disagree. Derived from the receipt's own seed, so it was fixed by a
                    // drand round committed before the fight resolved rather than chosen
                    // here, and recomputable by anyone holding the receipt.
                    if (env.inventory.dropsEnabled) {
                        await recordBattleDrops(tx, {
                            chain: chainFamily(battle.chainId as never),
                            battleId: battle.battleId,
                            seed: receipt.seed,
                            winnerOwner: receipt.result.attackerWon
                                ? snapshot.attacker.owner
                                : snapshot.defender.owner,
                            loserOwner: receipt.result.attackerWon
                                ? snapshot.defender.owner
                                : snapshot.attacker.owner,
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

const MAX_RECEIPT_CHAIN_RETRIES = 5;

/**
 * Every attestation this receipt has earned. The TypeScript engine's own agreement
 * is implicit in having computed the receipt at all, so it is always included.
 * `go-verifier`'s is included whenever independent verification actually ran and
 * matched — which is the only way this battle reached `verified` in the first
 * place, so its presence here is just formalizing a check already passed, not
 * re-deciding anything.
 *
 * Both name `receiptHash`, the digest of *this* receipt: the signer refuses any
 * attestation whose `receiptHash` does not match what it independently
 * recomputes, so an attestation naming the wrong receipt (stale, or for a
 * different battle entirely) is caught there, not trusted here.
 */
function buildAttestations(
    battle: { verificationDetail: Prisma.JsonValue },
    receiptHash: Hex,
    nowSeconds: number,
): EngineAttestation[] {
    const attestations: EngineAttestation[] = [
        { attester: 'typescript-engine', receiptHash, attestedAt: nowSeconds },
    ];
    if (battle.verificationDetail) {
        attestations.push({ attester: 'go-verifier', receiptHash, attestedAt: nowSeconds });
    }
    return attestations;
}

async function commitmentHashFor(battleId: string): Promise<string> {
    const commitment = await prisma.battleCommitment.findUnique({
        where: { battleId },
        select: { commitmentHash: true },
    });
    if (!commitment) {
        throw new Error(`battle ${battleId} has no commitment row; cannot build its receipt`);
    }
    return commitment.commitmentHash;
}

/**
 * Applies the signed battle's outcome to both pets' off-chain progression:
 * level, XP, same-opponent history, win/loss count, and the backend-mode
 * cooldown, plus advancing this pet's per-pet receipt chain head — in the same
 * transaction as the receipt itself, so a receipt can never exist without the
 * progression it describes, or vice versa.
 */
async function applyProgression(
    tx: Prisma.TransactionClient,
    battle: { chainId: string; deploymentId: string; attackerPetId: string; defenderPetId: string },
    progression: ProgressionDelta,
    receiptHash: Hex,
    nowSeconds: number,
): Promise<void> {
    const readyAt = BigInt(nowSeconds + env.battle.cooldownSeconds);
    await tx.petBattleProgress.update({
        where: {
            chainId_deploymentId_petId: {
                chainId: battle.chainId,
                deploymentId: battle.deploymentId,
                petId: battle.attackerPetId,
            },
        },
        data: {
            level: progression.attacker.level,
            xp: progression.attacker.xp,
            lastOpponentId: progression.attacker.lastOpponentId.toString(),
            streak: progression.attacker.streak,
            winCount: { increment: progression.attacker.won ? 1 : 0 },
            lossCount: { increment: progression.attacker.won ? 0 : 1 },
            readyAt,
            lastReceiptHash: receiptHash,
        },
    });
    await tx.petBattleProgress.update({
        where: {
            chainId_deploymentId_petId: {
                chainId: battle.chainId,
                deploymentId: battle.deploymentId,
                petId: battle.defenderPetId,
            },
        },
        data: {
            level: progression.defender.level,
            xp: progression.defender.xp,
            lastOpponentId: progression.defender.lastOpponentId.toString(),
            streak: progression.defender.streak,
            winCount: { increment: progression.defender.won ? 1 : 0 },
            lossCount: { increment: progression.defender.won ? 0 : 1 },
            readyAt,
            lastReceiptHash: receiptHash,
        },
    });
}

/** A duel's consent. The ledger's CHECK constraint keeps it filled on every duel row. */
function duelAuthorizationHash(battle: { battleId: string; authorizationHash: string | null }): Hex {
    if (!battle.authorizationHash) throw new Error(`duel ${battle.battleId} has no defence authorization`);
    return battle.authorizationHash as Hex;
}

async function failSigning(battleId: string, roomId: string | null, reason: string): Promise<void> {
    await applyTransition({
        battleId,
        from: BattleState.verified,
        to: BattleState.signing_failed,
        patch: { failureReason: reason },
    });
    notifyBattleRoomIfPresent(roomId, { type: 'battle-updated', battleId, state: BattleState.signing_failed });
}

function serializeBigints<T>(value: T): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

interface StoredProgression {
    petId: string | bigint;
    won: boolean;
    decayShift: number;
    xpAwarded: number;
    lastOpponentId: string | bigint;
    streak: number;
    level: number;
    xp: number;
    leveledUp: boolean;
}

/** Reverses `serializeBigints` for one pet's progression fields. */
function deserializeProgression(pet: StoredProgression): ProgressionDelta['attacker'] {
    return {
        petId: BigInt(pet.petId),
        won: pet.won,
        decayShift: pet.decayShift,
        xpAwarded: pet.xpAwarded,
        lastOpponentId: BigInt(pet.lastOpponentId),
        streak: pet.streak,
        level: pet.level,
        xp: pet.xp,
        leveledUp: pet.leveledUp,
    };
}
