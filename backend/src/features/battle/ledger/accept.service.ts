import { randomUUID } from 'node:crypto';

import {
    type BattleCommitment,
    type BattleSnapshot,
    type ChainId,
    findEquipmentMismatches,
    hashBattleSnapshot,
    isBattleReady,
    type Hex,
    type PetSnapshot,
    publishRuleset,
    QUICKNET,
    type Ruleset,
    SNAPSHOT_SCHEMA_VERSION,
} from '@cryptopets/protocol';
import type { Prisma } from '@generated/prisma/client';
import { BattleState } from '@generated/prisma/enums';

import { prisma } from '@config/prisma';
import { ItemCatalogError } from '@features/inventory';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

import { activeSigningKey, sign, signerBackendError, SignerRefusedError } from '../signer';
import { chooseCommitmentRound, roundPublishTime } from '../randomness';

import { type ConsentFailure, consumeDailyBudget, findCoveringAuthorization } from './consent.service';
import { servedDeploymentId } from './domain';
import { OPEN_BATTLE_REFUSALS, OUTBOX_TOPICS } from './constants';
import { buildPetSnapshot } from './snapshot.builder';
import { servedRuleset, servedRulesetHash } from './ruleset.builder';
import { applyTransition, type ExpectedProgress, openBattle } from './transitions';

/**
 * The accept flow (§E, §J).
 *
 * This is where the one ordering that can never be relaxed is enforced in code: the photo is
 * taken, a round that has not published yet is chosen, the commitment is signed, and the
 * signed commitment is the thing this function *returns* — synchronously, in the same
 * response that told the caller their battle was accepted. There is no path that answers
 * "accepted" without the caller also receiving the signed commitment: if round-selection or
 * signing fails, the ledger row this call created is unwound to `rejected` and the caller is
 * told the battle was never accepted at all.
 *
 * Three stages, deliberately not one transaction:
 *
 * - **Stage A** (one DB transaction, in `openBattle`): consume the intent, lock both pets, and
 *   persist the frozen snapshot — before any randomness for this battle exists. This is
 *   `accepted`.
 * - **Stage B** (network + KMS, no DB writes): choose a drand round that has not published,
 *   build the commitment, sign it.
 * - **Stage C** (one DB transaction, in `applyTransition`): record the commitment and move to
 *   `committed`; or, if Stage B failed, move Stage A's row to `rejected` and release the locks.
 *
 * Splitting it this way means a crash between Stage A and Stage C leaves a diagnosable
 * `accepted` row rather than losing the intent's consumption with no trace at all.
 */

export interface AcceptBattleRequest {
    intentHash: string;
    nowSeconds: number;
    /**
     * The shareable room this accept call came through, if any (§J). Optional: a
     * battle accepted without a room simply gets no spectator notifications — every
     * state change still lands in the read APIs (Step 27), just with no push channel
     * to announce it faster.
     */
    roomId?: string;
}

export type AcceptRejection =
    | 'intent-not-found'
    | 'intent-already-consumed'
    | 'intent-expired'
    | 'attacker-pet-missing'
    | 'defender-pet-missing'
    | 'attacker-not-ready'
    | 'defender-not-ready'
    | ConsentFailure
    | 'pet-locked'
    | 'drand-unavailable'
    | 'signer-unavailable'
    /**
     * The item catalog cannot price something this battle needs priced: a pet wears an
     * item with no catalog row, or an equipment row's modifier will not parse (roadmap §4).
     *
     * Its own reason rather than a 500, because it is an operational fault with an obvious
     * remedy (run the seeder) and no fault of the player's. Refusing is the conservative
     * end: the alternative is a fight under rules this deployment cannot state, recorded in
     * a signed receipt that contradicts chain state.
     */
    | 'item-catalog-stale'
    /**
     * The frozen gear disagrees with what the ruleset this battle names prices it at
     * (roadmap §4, threat T13). Reachable when the catalog changes between resolving the
     * snapshot and building the ruleset, and otherwise a bug.
     *
     * Refused rather than fought, because the verifier makes the same comparison on the
     * finished receipt: accepting would produce a battle guaranteed to fail verification.
     */
    | 'equipment-catalog-mismatch';

export interface AcceptedBattle {
    battleId: string;
    commitment: BattleCommitment;
    commitmentHash: Hex;
    signature: Hex;
    signingKeyId: string;
}

export type AcceptBattleResult =
    | { ok: true; battle: AcceptedBattle }
    | { ok: false; reason: AcceptRejection; detail: string };

const MAX_COMMITMENT_CHAIN_RETRIES = 5;

export async function acceptBattle(request: AcceptBattleRequest): Promise<AcceptBattleResult> {
    const intent = await loadAcceptableIntent(request);
    if (!intent.ok) {
        return intent.refusal;
    }
    const chainId = intent.value.chainId as ChainId;

    const fighters = await freezeFighters(chainId, intent.value, request.nowSeconds);
    if (!fighters.ok) {
        return fighters.refusal;
    }
    const { attacker, defender } = fighters.value;

    const priced = await priceUnderServedRuleset(attacker, defender);
    if (!priced.ok) {
        return priced.refusal;
    }
    const { ruleset, rulesetHash } = priced.value;

    const coverage = await findCoveringAuthorization({
        chainId,
        defenderOwner: defender.owner,
        defenderPetId: defender.petId.toString(),
        attackerLevel: attacker.level,
        rulesetHash,
        nowSeconds: request.nowSeconds,
    });
    if (!coverage.ok) {
        return reject(coverage.reason, coverage.detail);
    }

    // A network read, deliberately before any write: a battle should never be accepted (and
    // an intent never consumed) over a round choice that then turns out to be unobtainable.
    const roundChoice = await chooseCommitmentRound(request.nowSeconds);
    if (!roundChoice.ok) {
        return reject('drand-unavailable', roundChoice.detail);
    }

    // Consumes one use of the defender's daily budget before the ledger row exists, so any
    // refusal from `openBattle` leaves this use spent with no battle created. That is not rare:
    // the readiness check above reads `readyAt`, which a battle only moves when it signs, so a
    // pet still in another battle passes it and is refused at the lock (`pet-locked`) or at the
    // progress recheck (`pet-progress-changed`). It is a conservative failure, not a permissive
    // one: the cap is never exceeded, only reached early. Fixing it needs consumeDailyBudget to
    // run inside the `openBattle` transaction.
    const budget = await consumeDailyBudget(coverage.authorizationHash, coverage.maxBattlesPerDay, request.nowSeconds);
    if (!budget.ok) {
        return reject('daily-cap-reached', 'defender daily battle cap reached');
    }

    const battleId = `btl_${randomUUID()}`;
    const domain = { chainId, deploymentId: servedDeploymentId() };
    // Declared, never defaulted: an absent schemaVersion means 1, which would encode a
    // geared snapshot without its gear (and `assertBattleSnapshot` refuses that outright).
    const snapshot: BattleSnapshot = {
        domain,
        attacker,
        defender,
        takenAt: request.nowSeconds,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    };

    // Stage A: everything that must be durable before any randomness exists.
    const opened = await openAcceptedBattle({
        battleId,
        domain,
        intentHash: intent.value.intentHash,
        authorizationHash: coverage.authorizationHash,
        snapshot,
        rulesetHash,
        rulesetVersion: ruleset.version,
        roomId: request.roomId ?? null,
    });
    if (!opened.ok) {
        return opened.refusal;
    }

    // Stage B + C: sign the commitment and record it, retrying if another accept call under the
    // same signing key wins the chain position first.
    try {
        const signed = await signAndRecordCommitment({
            battleId,
            domain,
            intentHash: intent.value.intentHash as Hex,
            defenseAuthorizationHash: coverage.authorizationHash as Hex,
            snapshot,
            rulesetVersion: ruleset.version,
            rulesetHash,
            drandChainHash: QUICKNET.chainHash,
            drandRound: roundChoice.round,
            acceptedAt: request.nowSeconds,
        });
        notifyBattleRoomIfPresent(request.roomId ?? null, {
            type: 'battle-updated',
            battleId,
            state: BattleState.committed,
        });
        return { ok: true, battle: { battleId, ...signed } };
    } catch (error) {
        await unwindToRejected(battleId, error instanceof Error ? error.message : String(error));
        notifyBattleRoomIfPresent(request.roomId ?? null, {
            type: 'battle-updated',
            battleId,
            state: BattleState.rejected,
        });
        if (error instanceof SignerRefusedError) {
            return reject('signer-unavailable', error.message);
        }
        throw error;
    }
}

type CommitmentSeed = Omit<BattleCommitment, 'previousCommitmentHash' | 'signingKeyId'>;

/**
 * Builds, signs, and durably records a commitment, retrying if the chain-position write
 * conflicts with another accept call under the same signing key.
 *
 * The retry re-reads the chain head and re-signs on every attempt, because the signature
 * covers `sequence` and `previousCommitmentHash`: a stale link cannot be patched onto an
 * already-produced signature, only replaced by producing a new one.
 *
 * Recording happens inside the same `applyTransition` that moves the ledger row from
 * `accepted` to `committed`, so a chain-position conflict rolls the *whole* transaction back —
 * including the state move — leaving the row exactly as retriable as it was before this
 * attempt.
 */
async function signAndRecordCommitment(
    seed: CommitmentSeed,
): Promise<{ commitment: BattleCommitment; commitmentHash: Hex; signature: Hex; signingKeyId: string }> {
    for (let attempt = 0; attempt < MAX_COMMITMENT_CHAIN_RETRIES; attempt++) {
        // The commitment's own domain picks the key (§G separates them per reward domain),
        // so a commitment can never be signed under another chain's key.
        const key = activeSigningKey(seed.domain.chainId);
        if (!key) {
            // Carries the configuration failure rather than restating the symptom — see the
            // same lookup in `sign.worker`. This one reaches the player as a refused battle,
            // so the detail is what tells an operator it was their config and not the chain.
            const why = signerBackendError();
            throw new SignerRefusedError(
                'signer-not-configured',
                `no active signing key for the ${seed.domain.chainId} domain${why ? `: ${why}` : ''}`,
            );
        }

        const previous = await prisma.battleCommitment.findFirst({
            where: { signingKeyId: key.keyId },
            orderBy: { sequence: 'desc' },
            select: { commitmentHash: true, sequence: true },
        });
        const sequence = previous ? previous.sequence + 1n : 1n;

        const commitment: BattleCommitment = {
            ...seed,
            previousCommitmentHash: (previous?.commitmentHash ?? null) as Hex | null,
            signingKeyId: key.keyId,
        };

        const signResult = await sign({ kind: 'commitment', commitment }, seed.acceptedAt);

        try {
            await applyTransition({
                battleId: seed.battleId,
                from: BattleState.accepted,
                to: BattleState.committed,
                patch: {
                    drandChainHash: commitment.drandChainHash,
                    drandRound: BigInt(commitment.drandRound),
                    acceptedAt: BigInt(commitment.acceptedAt),
                },
                onApplied: async (tx) => {
                    await tx.battleCommitment.create({
                        data: {
                            commitmentHash: signResult.digest,
                            battleId: seed.battleId,
                            sequence,
                            previousCommitmentHash: commitment.previousCommitmentHash,
                            signingKeyId: signResult.keyId,
                            signature: signResult.signature,
                            payload: serializeBigints(commitment),
                            acceptedAt: BigInt(commitment.acceptedAt),
                            // Set in the same transaction that persists the commitment: the
                            // accept response is built from this exact result immediately
                            // after, so "delivered" and "persisted" land together (threat T15).
                            deliveredAt: new Date(),
                        },
                    });
                },
                outbox: [
                    {
                        battleId: seed.battleId,
                        topic: OUTBOX_TOPICS.awaitBeacon,
                        availableAt: roundPublishTime(commitment.drandRound),
                    },
                ],
            });
            return {
                commitment,
                commitmentHash: signResult.digest,
                signature: signResult.signature,
                signingKeyId: signResult.keyId,
            };
        } catch (error) {
            if ((error as { code?: string }).code === 'P2002') {
                continue; // another accept call took this chain position; retry with a fresh read
            }
            throw error;
        }
    }
    throw new Error(`could not claim a commitment chain position after ${MAX_COMMITMENT_CHAIN_RETRIES} attempts`);
}

async function unwindToRejected(battleId: string, reason: string): Promise<void> {
    await applyTransition({
        battleId,
        from: BattleState.accepted,
        to: BattleState.rejected,
        patch: { failureReason: reason },
    });
}

/**
 * Publishes the active ruleset bundle on first use.
 *
 * A receipt or commitment naming a `rulesetHash` with no matching published bundle cannot be
 * replayed by anyone (§H), so this runs before the hash is ever referenced rather than as a
 * background job that might lag behind it.
 */
async function ensureRulesetPublished(ruleset: Ruleset, expectedHash: Hex): Promise<void> {
    const existing = await prisma.battleRuleset.findUnique({ where: { rulesetHash: expectedHash } });
    if (existing) {
        return;
    }

    // The *same* ruleset object the caller hashed, passed in rather than re-read.
    //
    // This used to call `servedRuleset()` again and publish under whatever hash that
    // produced, while the battle went on referencing the caller's. Nothing checked the
    // two agreed, so any drift between the two reads published a bundle nobody would ever
    // look up and left the battle naming one that did not exist. It surfaced as far away
    // as it possibly could: the battle accepted cleanly, the player signed, and it died
    // nine retries later in `compute` with "no published ruleset bundle for 0x…".
    //
    // Taking the object removes the window rather than narrowing it: there is now only one
    // read, so there is nothing to drift.
    const { hash, json } = publishRuleset(ruleset);
    if (hash.toLowerCase() !== expectedHash.toLowerCase()) {
        // Unreachable while the caller hashes what it passes, which is the point of
        // asserting it: if that ever stops being true, it fails here, before a battle
        // exists, instead of stranding one that has already been signed for.
        throw new Error(
            `ruleset bundle hashes to ${hash} but this battle names ${expectedHash}; refusing to publish a bundle no battle references`,
        );
    }

    try {
        await prisma.battleRuleset.create({
            data: {
                rulesetHash: hash,
                version: ruleset.version,
                engineId: ruleset.engineId,
                engineVersion: ruleset.engineVersion,
                bundle: JSON.parse(json),
            },
        });
    } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') {
            throw error;
        }
        // A unique violation is only benign when it means *this* bundle is already there,
        // which is the concurrent-accept race. Any other unique conflict leaves no row for
        // this hash, and swallowing it publishes nothing while reporting success.
        //
        // That is not hypothetical: `version` is unique and every served ruleset carries
        // version 1, so the first catalog change made this collide on `version` rather
        // than on the hash. The battle went on naming a bundle that had never been
        // written, and died in `compute` nine retries later.
        const published = await prisma.battleRuleset.findUnique({ where: { rulesetHash: expectedHash } });
        if (!published) {
            throw new Error(
                `could not publish the ruleset bundle for ${expectedHash}: ${(error as Error).message}`,
            );
        }
    }
}

/** Prisma's Json columns cannot hold a bigint; stringify it in place before storing. */
function serializeBigints<T>(value: T): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function reject(reason: AcceptRejection, detail: string): AcceptBattleResult {
    return { ok: false, reason, detail };
}

/**
 * Turns a stale item catalog into a named rejection, and rethrows anything else.
 *
 * Both catalog-dependent reads on this path (what the pets are wearing, and the ruleset
 * the fight is priced under) run before the first write, so refusing here strands nothing:
 * no ledger row, no consumed intent, no spent daily budget.
 *
 * Rethrows rather than swallowing, because "the catalog is behind the contract" is a
 * recoverable operational state with a clear remedy, while any other failure here is a bug
 * and should keep reaching the error handler as one.
 */
function catalogRejection(error: unknown): AcceptBattleResult {
    if (error instanceof ItemCatalogError) {
        return reject('item-catalog-stale', error.message);
    }
    throw error;
}

/**
 * One step of accept that is allowed to refuse.
 *
 * `acceptBattle` is a sequence of checks that each end the request on failure, and inlining
 * all of them made one function responsible for validating an intent, freezing two pets,
 * pricing them under a ruleset, spending a budget, and unwinding a half-built battle. The
 * steps below are the seams that were already documented in its own comments; this type is
 * only what lets them hand a refusal back rather than each inventing a way to say no.
 */
type Step<T> = { ok: true; value: T } | { ok: false; refusal: AcceptBattleResult };

const proceed = <T>(value: T): Step<T> => ({ ok: true, value });
const refuse = (reason: AcceptRejection, detail: string): Step<never> => ({
    ok: false,
    refusal: reject(reason, detail),
});

type BattleIntentRow = NonNullable<Awaited<ReturnType<typeof prisma.battleIntent.findUnique>>>;

/** The intent this battle claims to answer, if it is still answerable. */
async function loadAcceptableIntent(request: AcceptBattleRequest): Promise<Step<BattleIntentRow>> {
    const intent = await prisma.battleIntent.findUnique({ where: { intentHash: request.intentHash } });
    if (!intent) {
        return refuse('intent-not-found', `no intent ${request.intentHash}`);
    }
    if (intent.consumedAt) {
        return refuse('intent-already-consumed', 'this intent already produced a battle');
    }
    if (BigInt(request.nowSeconds) >= intent.expiresAt) {
        return refuse('intent-expired', `intent expired at ${intent.expiresAt}`);
    }
    return proceed(intent);
}

/**
 * The frozen photo of both pets (§C), and the readiness checks that depend on it.
 *
 * Kept together because the second is meaningless without the first: `readyAt` is a
 * snapshot field, so cooldown can only be judged once the snapshot exists.
 */
async function freezeFighters(
    chainId: ChainId,
    intent: BattleIntentRow,
    nowSeconds: number,
): Promise<Step<{ attacker: PetSnapshot; defender: PetSnapshot }>> {
    let attacker: Awaited<ReturnType<typeof buildPetSnapshot>>;
    let defender: Awaited<ReturnType<typeof buildPetSnapshot>>;
    try {
        [attacker, defender] = await Promise.all([
            buildPetSnapshot(chainId, intent.attackerPetId),
            buildPetSnapshot(chainId, intent.defenderPetId),
        ]);
    } catch (error) {
        return { ok: false, refusal: catalogRejection(error) };
    }

    if (!attacker) {
        return refuse('attacker-pet-missing', `pet ${intent.attackerPetId} is not in the roster`);
    }
    if (!defender) {
        return refuse('defender-pet-missing', `pet ${intent.defenderPetId} is not in the roster`);
    }
    // Both pets must be off cooldown, mirroring GameLogic.sol's requirement that neither side
    // of an on-chain battle is mid-recovery.
    if (!isBattleReady(attacker, nowSeconds)) {
        return refuse('attacker-not-ready', `attacker ready at ${attacker.readyAt}`);
    }
    if (!isBattleReady(defender, nowSeconds)) {
        return refuse('defender-not-ready', `defender ready at ${defender.readyAt}`);
    }
    return proceed({ attacker, defender });
}

/**
 * The rules this battle will be fought and judged under, published so it can be replayed.
 *
 * Built from the live item catalog rather than the constant: gear changes fights, so the
 * rules a battle names have to include what gear does (roadmap §4).
 */
async function priceUnderServedRuleset(
    attacker: PetSnapshot,
    defender: PetSnapshot,
): Promise<Step<{ ruleset: Ruleset; rulesetHash: Hex }>> {
    let ruleset: Ruleset;
    try {
        ruleset = await servedRuleset();
    } catch (error) {
        return { ok: false, refusal: catalogRejection(error) };
    }

    // The gear the snapshots froze has to be the gear this ruleset prices (roadmap §4,
    // threat T13). The verifier makes the same comparison on the finished receipt, using the
    // same function; making it here as well turns "this battle will fail to verify" into
    // "this battle was never accepted".
    //
    // Not merely redundant. The two inputs are read from the item catalog at different
    // points — `buildPetSnapshot` resolves the modifiers, `servedRuleset` publishes them —
    // so a seeder run landing between the two would price the fight from one catalog and the
    // rules from another. Narrow, but it produces a receipt that cannot be verified and no
    // other check would notice.
    const mismatches = findEquipmentMismatches(
        [
            { role: 'attacker', equipment: attacker.equipment },
            { role: 'defender', equipment: defender.equipment },
        ],
        ruleset,
    );
    if (mismatches.length > 0) {
        return refuse('equipment-catalog-mismatch', mismatches.join('; '));
    }

    const rulesetHash = await servedRulesetHash();
    await ensureRulesetPublished(ruleset, rulesetHash);
    return proceed({ ruleset, rulesetHash });
}

/**
 * Stage A: the durable record, written before any randomness for this battle exists.
 *
 * One transaction (inside `openBattle`) consumes the intent, locks both pets, and persists
 * the frozen snapshot. Splitting it out keeps `acceptBattle` readable as the sequence it is,
 * rather than a sequence with one twenty-line row literal in the middle of it.
 */
async function openAcceptedBattle(args: {
    battleId: string;
    domain: { chainId: ChainId; deploymentId: string };
    intentHash: string;
    authorizationHash: string;
    snapshot: BattleSnapshot;
    rulesetHash: Hex;
    rulesetVersion: number;
    roomId: string | null;
}): Promise<Step<null>> {
    const { attacker, defender } = args.snapshot;
    const opened = await openBattle({
        consumeIntentHash: args.intentHash,
        petIds: [attacker.petId.toString(), defender.petId.toString()],
        expectedProgress: [progressOf(attacker), progressOf(defender)],
        ledger: {
            battleId: args.battleId,
            chainId: args.domain.chainId,
            deploymentId: args.domain.deploymentId,
            state: BattleState.accepted,
            intentHash: args.intentHash,
            authorizationHash: args.authorizationHash,
            attackerPetId: attacker.petId.toString(),
            attackerOwner: attacker.owner,
            defenderPetId: defender.petId.toString(),
            defenderOwner: defender.owner,
            snapshot: serializeBigints(args.snapshot),
            snapshotHash: hashBattleSnapshot(args.snapshot),
            rulesetHash: args.rulesetHash,
            rulesetVersion: args.rulesetVersion,
            // Filled in Stage C once the round is committed and signed; zero is not a legal
            // committed round, so a row stuck here is unambiguously still `accepted`.
            drandChainHash: '',
            drandRound: 0n,
            acceptedAt: 0n,
            roomId: args.roomId,
        },
    });

    if (opened.ok) {
        return proceed(null);
    }
    switch (opened.reason) {
        case OPEN_BATTLE_REFUSALS.petLocked:
            return refuse('pet-locked', `pet ${opened.petId} already has an open battle`);
        case OPEN_BATTLE_REFUSALS.petProgressChanged:
            // Reported as pet-locked, so the API keeps one code for "this pet is busy". The detail
            // stays neutral: a signing battle is the usual cause, but an item can change progress
            // too, and a battle that signed has also started a cooldown, so retrying at once fails.
            return refuse('pet-locked', `pet ${opened.petId}'s progress changed during this accept`);
        case OPEN_BATTLE_REFUSALS.intentAlreadyConsumed:
            return refuse('intent-already-consumed', 'this intent already produced a battle');
    }
}

/** The progress fields a snapshot froze, in the shape `pet_battle_progress` stores them. */
function progressOf(pet: BattleSnapshot['attacker']): ExpectedProgress {
    return {
        petId: pet.petId.toString(),
        level: pet.level,
        xp: pet.xp,
        streak: pet.streak,
        lastOpponentId: pet.lastOpponentId.toString(),
        readyAt: BigInt(pet.readyAt),
    };
}
