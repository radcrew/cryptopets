import {
    type AnyBattleReceipt,
    type BattleReceipt,
    hashCombatLog,
    hashTeamCombatLog,
    isTeamBattleReceipt,
    replayTeamBattle,
    type Ruleset,
    simulate,
    type TeamBattleReceipt,
} from '@cryptopets/protocol';

import { equipmentBonus } from './equipment';
import type { CheckResult } from './types';

/**
 * Re-runs the fight and compares it to what the receipt claims (§F, §H item 1).
 *
 * This is the check the whole design exists for. Every input the engine consumes is in the
 * receipt — both pets frozen at acceptance, the seed, and the ruleset it names — so a
 * stranger can run the same simulation and get the same answer, or not. Nothing here asks
 * the operator for anything.
 *
 * Both the summary result and the blow-by-blow log are compared. The summary alone would
 * miss a receipt whose winner and round count are honest but whose published log tells a
 * different story about how it got there, so the recomputed log's hash is checked against
 * `combatLogHash` as well. That also means the log served separately by the operator
 * (`GET /api/battle/:battleId/combat-log`, §G) is pinned transitively: anything hashing to
 * `combatLogHash` is, by collision resistance, the log this replay produced.
 *
 * The `ruleset` must be the bundle the receipt names — the caller resolves it by hash, so
 * a mismatched bundle is not something this function can be handed.
 */
export function checkCombatReplay(receipt: AnyBattleReceipt, ruleset: Ruleset): CheckResult {
    return isTeamBattleReceipt(receipt) ? checkTeamReplay(receipt, ruleset) : checkDuelReplay(receipt, ruleset);
}

/**
 * A team battle's replay, from the same function the backend computes it with. Everything the
 * duel replay compares.
 */
function checkTeamReplay(receipt: TeamBattleReceipt, ruleset: Ruleset): CheckResult {
    const check = 'combat-replay';
    let outcome: ReturnType<typeof replayTeamBattle>;
    try {
        outcome = replayTeamBattle(receipt.snapshot, receipt.seed, ruleset);
    } catch (error) {
        return { check, ok: false, detail: `replay could not run: ${(error as Error).message}` };
    }
    const mismatches: string[] = [];
    if (outcome.result.attackerWins !== receipt.result.attackerWon) {
        mismatches.push(`attackerWon: replay=${outcome.result.attackerWins} receipt=${receipt.result.attackerWon}`);
    }
    if (outcome.result.rounds !== receipt.result.rounds) {
        mismatches.push(`rounds: replay=${outcome.result.rounds} receipt=${receipt.result.rounds}`);
    }
    if (outcome.result.winnerHpRemaining !== receipt.result.winnerHpRemaining) {
        mismatches.push(`winnerHpRemaining: replay=${outcome.result.winnerHpRemaining} receipt=${receipt.result.winnerHpRemaining}`);
    }
    const replayedLogHash = hashTeamCombatLog(outcome);
    if (replayedLogHash.toLowerCase() !== receipt.combatLogHash.toLowerCase()) {
        mismatches.push(`combatLogHash: replay=${replayedLogHash} receipt=${receipt.combatLogHash}`);
    }
    return mismatches.length === 0 ? { check, ok: true } : { check, ok: false, detail: mismatches.join('; ') };
}

function checkDuelReplay(receipt: BattleReceipt, ruleset: Ruleset): CheckResult {
    const check = 'combat-replay';
    const { attacker, defender } = receipt.snapshot;

    let outcome: ReturnType<typeof simulate>;
    try {
        outcome = simulate(
            attacker.dna,
            attacker.rarity,
            attacker.level,
            attacker.skill,
            defender.dna,
            defender.rarity,
            defender.level,
            defender.skill,
            BigInt(receipt.seed),
            ruleset.skillConfig,
            // The bonuses the snapshot froze, not the catalog's: this reproduces the fight
            // that happened. Whether those bonuses were the right ones is `checkEquipment`,
            // reported separately so a mispriced item reads as a mispriced item rather
            // than as an unexplained replay mismatch.
            equipmentBonus(attacker.equipment),
            equipmentBonus(defender.equipment),
        );
    } catch (error) {
        return { check, ok: false, detail: `replay could not run: ${(error as Error).message}` };
    }

    const mismatches: string[] = [];
    if (outcome.result.firstWins !== receipt.result.attackerWon) {
        mismatches.push(`attackerWon: replay=${outcome.result.firstWins} receipt=${receipt.result.attackerWon}`);
    }
    if (outcome.result.rounds !== receipt.result.rounds) {
        mismatches.push(`rounds: replay=${outcome.result.rounds} receipt=${receipt.result.rounds}`);
    }
    if (outcome.result.winnerHpRemaining !== receipt.result.winnerHpRemaining) {
        mismatches.push(
            `winnerHpRemaining: replay=${outcome.result.winnerHpRemaining} receipt=${receipt.result.winnerHpRemaining}`,
        );
    }
    const replayedLogHash = hashCombatLog(outcome);
    if (replayedLogHash.toLowerCase() !== receipt.combatLogHash.toLowerCase()) {
        mismatches.push(`combatLogHash: replay=${replayedLogHash} receipt=${receipt.combatLogHash}`);
    }

    return mismatches.length === 0 ? { check, ok: true } : { check, ok: false, detail: mismatches.join('; ') };
}
