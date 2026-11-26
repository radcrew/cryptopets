import { chainFamily, type ChainId, normalizeAccount, type Tactic } from '@cryptopets/protocol';

import { prisma } from '@config/prisma';
import { withBattleProgress } from '@repositories/battleProgress.overlay';
import { mapRosterRowToRosterPet } from '@repositories/roster.mapping';
import type { RosterPet } from '@repositories/roster.repository';

import { servedDeploymentId } from './domain';

/**
 * Team opponents: defence plans a player can challenge (docs/plan-team-battles-3v3.md, Phase 4).
 *
 * A plan is listed while it could actually be accepted: live, inside its window, signed for the
 * team rules being served, not the caller's own, and with all three pets still the defender's. A
 * plan failing any of those would only be refused at acceptance, after the attacker had placed a
 * squad and signed, so it is left off the list rather than offered.
 *
 * Levels are merged with backend progression, as every other served pet is
 * (`battleProgress.overlay.ts`): the roster's own level froze when battles left the chain.
 */
export interface TeamOpponentPet {
    petId: string;
    col: number;
    row: number;
    tactic: Tactic;
    name: string;
    level: number;
    rarity: number;
    dna: string;
    speciesId: number;
    /** Unix seconds this pet is next ready to battle. */
    readyAt: number;
}

export interface TeamOpponent {
    planHash: string;
    defenderOwner: string;
    minLevel: number;
    maxLevel: number;
    expiresAt: number;
    /** The three defending pets, in slot order. */
    roster: TeamOpponentPet[];
    /** Every defending pet is off cooldown, which acceptance requires. */
    ready: boolean;
}

const MAX_OPPONENTS = 50;

export async function listTeamOpponents(params: {
    chainId: string;
    caller: string;
    servedRulesetHash: string;
    nowSeconds: number;
    limit?: number;
}): Promise<TeamOpponent[]> {
    const take = Math.min(Math.max(1, Math.trunc(params.limit ?? 20)), MAX_OPPONENTS);
    const plans = await prisma.defensePlan.findMany({
        where: {
            chainId: params.chainId,
            deploymentId: servedDeploymentId(),
            revokedAt: null,
            rulesetHash: params.servedRulesetHash,
            notBefore: { lte: BigInt(params.nowSeconds) },
            expiresAt: { gt: BigInt(params.nowSeconds) },
            defenderOwner: { not: normalizeAccount(params.caller) },
        },
        orderBy: { createdAt: 'desc' },
        take,
    });
    if (plans.length === 0) return [];

    // One read for every listed pet, then one for their progression, rather than one per pet.
    const family = chainFamily(params.chainId as ChainId);
    const rosters = plans.map((plan) => plan.roster as unknown as Omit<TeamOpponentPet, 'name' | 'level' | 'rarity' | 'dna' | 'speciesId' | 'readyAt'>[]);
    const ids = [...new Set(rosters.flat().map((entry) => entry.petId))];
    const rows = await prisma.petRoster.findMany({ where: { chain: family, petId: { in: ids } } });
    const pets = await withBattleProgress(family, rows.map(mapRosterRowToRosterPet));
    const byId = new Map<string, RosterPet>(pets.map((pet) => [pet.petId, pet]));

    const opponents: TeamOpponent[] = [];
    plans.forEach((plan, i) => {
        const roster: TeamOpponentPet[] = [];
        for (const entry of rosters[i] ?? []) {
            const pet = byId.get(entry.petId);
            if (!pet || normalizeAccount(pet.owner) !== plan.defenderOwner) return; // stale plan: skip it
            roster.push({
                petId: entry.petId,
                col: entry.col,
                row: entry.row,
                tactic: entry.tactic,
                name: pet.name,
                level: pet.level,
                rarity: pet.rarity,
                dna: pet.dna,
                speciesId: pet.speciesId,
                readyAt: Number(pet.readyAt),
            });
        }
        opponents.push({
            planHash: plan.planHash,
            defenderOwner: plan.defenderOwner,
            minLevel: plan.minLevel,
            maxLevel: plan.maxLevel,
            expiresAt: Number(plan.expiresAt),
            roster,
            ready: roster.every((pet) => pet.readyAt <= params.nowSeconds),
        });
    });
    return opponents;
}
