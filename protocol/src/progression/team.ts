import { applyDecayShift, BASE_XP_LOSS, BASE_XP_WIN, calcXp, recordBattleOpponent } from '../combat/xp';
import { assertTeamBattleSnapshot, type TeamBattleSnapshot } from '../snapshot/team';
import type { PetSnapshot } from '../snapshot/types';

import { DEFAULT_PROGRESSION_PARAMS, type PetProgression, petProgression, type ProgressionParams } from './progression';

/**
 * What one team battle does to each of its six fighters, in fight order: the three
 * attackers by slot, then the three drawn defenders by slot. Benched roster pets fought no
 * one and gain nothing.
 *
 * Every fighter's result is its team's, and each earns XP as if it had duelled the
 * highest-level enemy fighter (the lower slot on a tie), under the duel's formula and
 * same-opponent decay. Measuring against the strongest enemy is what stops a weak pet from
 * farming XP by riding along with strong teammates; tracking that one opponent is what lets
 * the duel's decay keep working without a per-pair history.
 *
 * `drawn` is the roster indices the draw picked, which `replayTeamBattle` reports.
 */
export function computeTeamProgression(
    snapshot: TeamBattleSnapshot,
    drawn: readonly number[],
    attackerWon: boolean,
    params: ProgressionParams = DEFAULT_PROGRESSION_PARAMS,
): PetProgression[] {
    const checked = assertTeamBattleSnapshot(snapshot);
    const attackers = checked.attackers.map((m) => m.pet);
    const defenders = drawn.map((index) => {
        const member = checked.roster[index];
        if (!member) throw new Error(`drawn roster index ${index} does not exist`);
        return member.pet;
    });
    if (defenders.length !== attackers.length) {
        throw new Error(`a team battle has ${attackers.length} drawn defenders, got ${defenders.length}`);
    }

    const award = (pet: PetSnapshot, enemies: PetSnapshot[], won: boolean): PetProgression => {
        const opponent = strongest(enemies);
        const history = recordBattleOpponent(pet, opponent.petId);
        const xp = applyDecayShift(calcXp(won ? BASE_XP_WIN : BASE_XP_LOSS, pet.level, opponent.level), history.decayShift);
        return petProgression(pet, history, won, xp, params);
    };
    return [
        ...attackers.map((pet) => award(pet, defenders, attackerWon)),
        ...defenders.map((pet) => award(pet, attackers, !attackerWon)),
    ];
}

/** The highest-level pet, keeping the earlier one on a tie. */
function strongest(pets: PetSnapshot[]): PetSnapshot {
    const [first, ...rest] = pets;
    if (!first) throw new Error('a side with no fighters has no strongest pet');
    return rest.reduce((best, p) => (p.level > best.level ? p : best), first);
}
