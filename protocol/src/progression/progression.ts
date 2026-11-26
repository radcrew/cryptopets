import {
    applyDecayShift,
    applyXp,
    BASE_XP_LOSS,
    BASE_XP_WIN,
    calcXp,
    DEFAULT_MAX_LEVEL,
    recordBattleOpponent,
} from '../combat/xp';
import { assertBattleSnapshot, type BattleSnapshot, type PetSnapshot } from '../snapshot/types';

/**
 * Turns a frozen snapshot plus a winner into the progression change a battle causes.
 *
 * This is the piece that made off-chain XP possible. XP depends on same-opponent
 * decay state, which used to live only on chain, so the client-side port stopped at
 * fight math and receipts could not carry a meaningful progression delta. Now that
 * `lastOpponentId` and `streak` are frozen into the snapshot, progression is a pure
 * function of the receipt's own inputs, which means a stranger can recompute it
 * without access to any of our tables (§F).
 *
 * Levels come from the snapshot, not from live state, matching the fix already made
 * on both chains: the simulation and the XP calculation agree on one set of committed
 * inputs instead of one using frozen levels while the other reads whatever the live
 * values happen to be at settle time.
 */

/** Ruleset-supplied progression parameters. */
export interface ProgressionParams {
    /** Level cap. No XP accrues at or past it. */
    maxLevel: number;
}

export const DEFAULT_PROGRESSION_PARAMS: ProgressionParams = { maxLevel: DEFAULT_MAX_LEVEL };

/** What one battle does to one pet. */
export interface PetProgression {
    petId: bigint;
    won: boolean;
    /** Same-opponent decay shift this battle earned. */
    decayShift: number;
    /**
     * The computed award, after the level multiplier and decay.
     *
     * This is the `xpWin`/`xpLoss` the chains emit in `BattleResolved`, which is
     * reported whether or not it was actually credited: a pet at the level cap
     * accrues nothing, and the event still carries the number. So compare
     * `level`/`xp` to see what was applied, not this.
     */
    xpAwarded: number;
    /** Opponent history after the battle. */
    lastOpponentId: bigint;
    streak: number;
    /** Level and XP after the battle. */
    level: number;
    xp: number;
    leveledUp: boolean;
}

/** What one battle does to both pets. */
export interface ProgressionDelta {
    attacker: PetProgression;
    defender: PetProgression;
}

/**
 * Computes the progression delta for a settled battle.
 *
 * `attackerWon` is `SimResult.firstWins`, since the simulator states its result from
 * the attacker's perspective.
 */
export function computeProgression(
    snapshot: BattleSnapshot,
    attackerWon: boolean,
    params: ProgressionParams = DEFAULT_PROGRESSION_PARAMS,
): ProgressionDelta {
    const checked = assertBattleSnapshot(snapshot);
    const { attacker, defender } = checked;

    // Each pet records the other, so a rematch advances both streaks independently.
    const attackerHistory = recordBattleOpponent(attacker, defender.petId);
    const defenderHistory = recordBattleOpponent(defender, attacker.petId);

    const winner = attackerWon ? attacker : defender;
    const loser = attackerWon ? defender : attacker;
    const winnerShift = attackerWon ? attackerHistory.decayShift : defenderHistory.decayShift;
    const loserShift = attackerWon ? defenderHistory.decayShift : attackerHistory.decayShift;

    const xpWin = applyDecayShift(calcXp(BASE_XP_WIN, winner.level, loser.level), winnerShift);
    const xpLoss = applyDecayShift(calcXp(BASE_XP_LOSS, loser.level, winner.level), loserShift);

    return {
        attacker: petProgression(attacker, attackerHistory, attackerWon, attackerWon ? xpWin : xpLoss, params),
        defender: petProgression(defender, defenderHistory, !attackerWon, attackerWon ? xpLoss : xpWin, params),
    };
}

/** One pet's progression from its award. Shared with team battles. */
export function petProgression(
    pet: PetSnapshot,
    history: { lastOpponentId: bigint; streak: number; decayShift: number },
    won: boolean,
    xpAwarded: number,
    params: ProgressionParams,
): PetProgression {
    // Both chains guard the XP write with `if (xp > 0)`, so a zero award leaves level
    // and XP untouched rather than running the threshold check with nothing added.
    const levelState =
        xpAwarded > 0
            ? applyXp({ level: pet.level, xp: pet.xp }, xpAwarded, params.maxLevel)
            : { level: pet.level, xp: pet.xp, leveledUp: false };

    return {
        petId: pet.petId,
        won,
        decayShift: history.decayShift,
        xpAwarded,
        lastOpponentId: history.lastOpponentId,
        streak: history.streak,
        level: levelState.level,
        xp: levelState.xp,
        leveledUp: levelState.leveledUp,
    };
}
