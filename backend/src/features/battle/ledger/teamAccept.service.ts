import { randomUUID } from 'node:crypto';

import {
    type ChainId,
    findEquipmentMismatches,
    hashTeamBattleSnapshot,
    type Hex,
    isBattleReady,
    normalizeAccount,
    type PetSnapshot,
    planCovers,
    QUICKNET,
    type Ruleset,
    type Tactic,
    TEAM_SCHEMA_VERSIONS,
    type TeamBattleSnapshot,
} from '@cryptopets/protocol';
import { BattleState } from '@generated/prisma/enums';

import { prisma } from '@config/prisma';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

import { chooseCommitmentRound } from '../randomness';
import { SignerRefusedError } from '../signer';
import {
    acceptBattle,
    type AcceptBattleRequest,
    type AcceptBattleResult,
    catalogRejection,
    ensureRulesetPublished,
    loadAcceptableIntent,
    proceed,
    progressOf,
    refuse,
    reject,
    serializeBigints,
    signAndRecordCommitment,
    type Step,
    unwindToRejected,
} from './accept.service';
import { BATTLE_REFUSALS, CONSENT_REFUSALS, OPEN_BATTLE_REFUSALS } from './constants';
import { consumePlanDailyBudget, toProtocolPlan } from './defensePlan.service';
import { servedDeploymentId } from './domain';
import { BATTLE_KIND } from './kind';
import { teamBattlesEnabled } from './mode';
import { servedTeamRuleset, servedTeamRulesetHash } from './ruleset.builder';
import { buildPetSnapshot } from './snapshot.builder';
import { openBattle } from './transitions';

/**
 * Accepting a team challenge (docs/plan-team-battles-3v3.md, Phase 4).
 *
 * The duel's accept flow (`accept.service.ts`), with its one unrelaxable ordering intact: the
 * photo is taken and made durable, a round that has not published is chosen, the commitment is
 * signed, and the signed commitment is what this returns. The same three stages and the same
 * helpers carry it; what changes is what is checked and frozen:
 *
 * - consent is the defender's plan, covering the squad's highest level (so a strong pet cannot
 *   hide behind weak ones), with one use of its daily cap for the whole battle;
 * - all six pets are frozen, the three attackers and the plan's three defenders;
 * - all six must be ready and priced by the catalog;
 * - all six are locked until the battle settles, as a duel's two are.
 */
export async function acceptTeamBattle(request: AcceptBattleRequest): Promise<AcceptBattleResult> {
    if (!teamBattlesEnabled()) {
        return reject(BATTLE_REFUSALS.TEAM_BATTLES_DISABLED, 'this deployment is not currently accepting team battles');
    }
    const intent = await loadAcceptableIntent(request);
    if (!intent.ok) return intent.refusal;
    const row = intent.value;
    const chainId = row.chainId as ChainId;

    const plan = await loadPlan(row.defensePlanHash);
    if (!plan.ok) return plan.refusal;

    const frozen = await freezeSquads(chainId, row, plan.value, request.nowSeconds);
    if (!frozen.ok) return frozen.refusal;
    const { attackers, roster } = frozen.value;

    const priced = await priceUnderTeamRuleset([...attackers, ...roster].map((m) => m.pet));
    if (!priced.ok) return priced.refusal;
    const { ruleset, rulesetHash } = priced.value;
    if (row.rulesetHash.toLowerCase() !== rulesetHash.toLowerCase()) {
        return reject(BATTLE_REFUSALS.INTENT_RULESET_STALE, `intent agreed to ${row.rulesetHash}; team battles are served under ${rulesetHash}`);
    }

    const coverage = planCovers(toProtocolPlan(plan.value.wire), {
        attackerLevel: Math.max(...attackers.map((m) => m.pet.level)),
        rulesetHash,
        nowSeconds: request.nowSeconds,
    });
    if (!coverage.covered) {
        return reject(coverage.reason, `defence plan ${plan.value.planHash} does not cover this squad`);
    }

    const roundChoice = await chooseCommitmentRound(request.nowSeconds);
    if (!roundChoice.ok) {
        return reject(BATTLE_REFUSALS.DRAND_UNAVAILABLE, roundChoice.detail);
    }
    // Spent before the ledger row exists, as for duels: conservative, never permissive.
    const budget = await consumePlanDailyBudget(plan.value.planHash, plan.value.maxBattlesPerDay, request.nowSeconds);
    if (!budget.ok) {
        return reject(CONSENT_REFUSALS.DAILY_CAP_REACHED, 'defender daily team battle cap reached');
    }

    const battleId = `btl_${randomUUID()}`;
    const domain = { chainId, deploymentId: servedDeploymentId() };
    const snapshot: TeamBattleSnapshot = {
        domain,
        attackers,
        roster,
        takenAt: request.nowSeconds,
        schemaVersion: TEAM_SCHEMA_VERSIONS.snapshot,
    };

    // Stage A: consume the intent, lock all six pets, persist the photo.
    const pets = [...attackers, ...roster].map((m) => m.pet);
    const opened = await openBattle({
        consumeIntentHash: row.intentHash,
        petIds: pets.map((p) => p.petId.toString()),
        expectedProgress: pets.map(progressOf),
        ledger: {
            battleId,
            kind: BATTLE_KIND.team,
            chainId: domain.chainId,
            deploymentId: domain.deploymentId,
            state: BattleState.accepted,
            intentHash: row.intentHash,
            defensePlanHash: plan.value.planHash,
            attackerOwner: row.attackerOwner,
            defenderOwner: plan.value.wire.defenderOwner,
            snapshot: serializeBigints(snapshot),
            snapshotHash: hashTeamBattleSnapshot(snapshot),
            rulesetHash,
            rulesetVersion: ruleset.version,
            drandChainHash: '',
            drandRound: 0n,
            acceptedAt: 0n,
            roomId: request.roomId ?? null,
        },
    });
    if (!opened.ok) {
        switch (opened.reason) {
            case OPEN_BATTLE_REFUSALS.PET_LOCKED:
                return reject(BATTLE_REFUSALS.PET_LOCKED, `pet ${opened.petId} already has an open battle`);
            case OPEN_BATTLE_REFUSALS.PET_PROGRESS_CHANGED:
                return reject(BATTLE_REFUSALS.PET_LOCKED, `pet ${opened.petId}'s progress changed during this accept`);
            case OPEN_BATTLE_REFUSALS.INTENT_ALREADY_CONSUMED:
                return reject(BATTLE_REFUSALS.INTENT_ALREADY_CONSUMED, 'this intent already produced a battle');
        }
    }

    // Stages B and C: the commitment, under the duel's chain-position retry. The commitment
    // layout is shared; its consent field carries the plan hash and its snapshot the team one.
    try {
        const signed = await signAndRecordCommitment({
            battleId,
            domain,
            intentHash: row.intentHash as Hex,
            defenseAuthorizationHash: plan.value.planHash as Hex,
            snapshot,
            rulesetVersion: ruleset.version,
            rulesetHash,
            drandChainHash: QUICKNET.chainHash,
            drandRound: roundChoice.round,
            acceptedAt: request.nowSeconds,
        });
        notifyBattleRoomIfPresent(request.roomId ?? null, { type: 'battle-updated', battleId, state: BattleState.committed });
        return { ok: true, battle: { battleId, ...signed } };
    } catch (error) {
        await unwindToRejected(battleId, error instanceof Error ? error.message : String(error));
        notifyBattleRoomIfPresent(request.roomId ?? null, { type: 'battle-updated', battleId, state: BattleState.rejected });
        if (error instanceof SignerRefusedError) {
            return reject(BATTLE_REFUSALS.SIGNER_UNAVAILABLE, error.message);
        }
        throw error;
    }
}

/**
 * The accept endpoint's entry point for both kinds. A team intent goes to `acceptTeamBattle`
 * and anything else to the duel flow, which handles a missing intent itself.
 */
export async function acceptChallenge(request: AcceptBattleRequest): Promise<AcceptBattleResult> {
    const row = await prisma.battleIntent.findUnique({ where: { intentHash: request.intentHash }, select: { kind: true } });
    return row?.kind === BATTLE_KIND.team ? acceptTeamBattle(request) : acceptBattle(request);
}

interface LoadedPlan {
    planHash: string;
    maxBattlesPerDay: number;
    wire: Parameters<typeof toProtocolPlan>[0];
}

/** The plan the intent named, if it still stands. */
async function loadPlan(planHash: string | null): Promise<Step<LoadedPlan>> {
    const plan = planHash ? await prisma.defensePlan.findUnique({ where: { planHash } }) : null;
    if (!plan) {
        return refuse(CONSENT_REFUSALS.NO_AUTHORIZATION, `no defence plan ${planHash}`);
    }
    if (plan.revokedAt) {
        return refuse(CONSENT_REFUSALS.REVOKED, `defence plan ${planHash} was withdrawn`);
    }
    return proceed({
        planHash: plan.planHash,
        maxBattlesPerDay: plan.maxBattlesPerDay,
        wire: {
            chainId: plan.chainId,
            deploymentId: plan.deploymentId,
            defenderOwner: plan.defenderOwner,
            roster: plan.roster as unknown as LoadedPlan['wire']['roster'],
            rulesetHash: plan.rulesetHash,
            minLevel: plan.minLevel,
            maxLevel: plan.maxLevel,
            maxBattlesPerDay: plan.maxBattlesPerDay,
            notBefore: Number(plan.notBefore),
            expiresAt: Number(plan.expiresAt),
            revocationNonce: plan.revocationNonce,
        },
    });
}

type IntentRow = NonNullable<Awaited<ReturnType<typeof prisma.battleIntent.findUnique>>>;

/**
 * The frozen photo of all six pets, and the checks that depend on it: each pet still owned by
 * its side's wallet, and each off cooldown.
 */
async function freezeSquads(
    chainId: ChainId,
    row: IntentRow,
    plan: LoadedPlan,
    nowSeconds: number,
): Promise<Step<{ attackers: TeamBattleSnapshot['attackers']; roster: TeamBattleSnapshot['roster'] }>> {
    const placements = (row.attackers ?? []) as { petId: string; col: number; row: number; tactic: Tactic }[];
    let attackerPets: (PetSnapshot | null)[];
    let rosterPets: (PetSnapshot | null)[];
    try {
        [attackerPets, rosterPets] = await Promise.all([
            Promise.all(placements.map((a) => buildPetSnapshot(chainId, a.petId))),
            Promise.all(plan.wire.roster.map((e) => buildPetSnapshot(chainId, e.petId))),
        ]);
    } catch (error) {
        return { ok: false, refusal: catalogRejection(error) };
    }

    const attackers: TeamBattleSnapshot['attackers'] = [];
    for (const [i, pet] of attackerPets.entries()) {
        const placement = placements[i]!;
        if (!pet) return refuse(BATTLE_REFUSALS.ATTACKER_PET_MISSING, `pet ${placement.petId} is not in the roster`);
        if (normalizeAccount(pet.owner) !== normalizeAccount(row.attackerOwner)) {
            return refuse(BATTLE_REFUSALS.PET_OWNER_CHANGED, `attacking pet ${placement.petId} now belongs to ${pet.owner}`);
        }
        if (!isBattleReady(pet, nowSeconds)) return refuse(BATTLE_REFUSALS.ATTACKER_NOT_READY, `pet ${placement.petId} ready at ${pet.readyAt}`);
        attackers.push({ pet, col: placement.col, row: placement.row, tactic: placement.tactic });
    }
    const roster: TeamBattleSnapshot['roster'] = [];
    for (const [i, pet] of rosterPets.entries()) {
        const entry = plan.wire.roster[i]!;
        if (!pet) return refuse(BATTLE_REFUSALS.DEFENDER_PET_MISSING, `defending pet ${entry.petId} is not in the roster`);
        if (normalizeAccount(pet.owner) !== normalizeAccount(plan.wire.defenderOwner)) {
            return refuse(BATTLE_REFUSALS.PET_OWNER_CHANGED, `defending pet ${entry.petId} now belongs to ${pet.owner}`);
        }
        if (!isBattleReady(pet, nowSeconds)) return refuse(BATTLE_REFUSALS.DEFENDER_NOT_READY, `defending pet ${entry.petId} ready at ${pet.readyAt}`);
        roster.push({ pet, col: entry.col, row: entry.row, tactic: entry.tactic });
    }
    return proceed({ attackers, roster });
}

/**
 * The served team ruleset, after checking it prices every pet's gear. All six loadouts: a
 * battle the verifier will refuse should be refused here instead
 * (docs/plan-team-battles-3v3.md, Phase 2 and 4).
 */
async function priceUnderTeamRuleset(pets: PetSnapshot[]): Promise<Step<{ ruleset: Ruleset; rulesetHash: Hex }>> {
    let ruleset: Ruleset;
    try {
        ruleset = await servedTeamRuleset();
    } catch (error) {
        return { ok: false, refusal: catalogRejection(error) };
    }
    const mismatches = findEquipmentMismatches(
        pets.map((pet) => ({ role: `pet ${pet.petId}`, equipment: pet.equipment })),
        ruleset,
    );
    if (mismatches.length > 0) {
        return refuse(BATTLE_REFUSALS.EQUIPMENT_CATALOG_MISMATCH, mismatches.join('; '));
    }
    const rulesetHash = await servedTeamRulesetHash();
    await ensureRulesetPublished(ruleset, rulesetHash);
    return proceed({ ruleset, rulesetHash });
}
