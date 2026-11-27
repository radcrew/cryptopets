import {
    hashCombatLog,
    type PetProgression,
    type ProgressionDelta,
    type SimOutcome,
} from '@cryptopets/protocol';
import { BattleState } from '@generated/prisma/enums';
import type { Prisma } from '@generated/prisma/client';

import { prisma } from '@config/prisma';
import {
    applyTransition,
    type ClaimedMessage,
    completeOutbox,
    decodeStoredSnapshot,
    loadPublishedRuleset,
    OUTBOX_TOPICS,
} from '@features/battle/ledger';
import {
    callVerifyBattle,
    type VerifyBattleWire,
    type VerifyPetProgressionWire,
    verifyPetInputs,
} from '@grpc-client/verifyBattle';
import { BATTLE_KIND } from '@features/battle/ledger/kind';
import { notifyBattleRoomIfPresent } from '@ws/battleRoomSocket';

import { processTeamVerify } from './team.worker';

/**
 * Handles `verify` messages: `computed` -> `verified` (§F).
 *
 * This is the circuit breaker the architecture doc describes: before a receipt
 * can be signed, the independent Go recomputation has to agree with the
 * TypeScript engine's own result exactly, on winner, rounds, winner HP, the
 * combat-log hash, and the full progression delta for both pets. Any
 * disagreement stops signing for this battle and moves it to
 * `verification_failed` with both outputs retained — never a silent
 * preference for one implementation over the other.
 *
 * A failure to even *run* Go's recomputation (indexer-go unreachable, not
 * configured, breaker open) is a different thing entirely from a mismatch,
 * and is handled differently: it throws, which the dispatcher turns into a
 * real job failure with backoff and eventual dead-lettering. Treating "we
 * could not check" the same as "they disagree" would be wrong in both
 * directions — it would forfeit a battle over a transient network blip, and
 * it would make a genuine disagreement look like ordinary infrastructure
 * flakiness.
 */
export async function processVerifyMessage(message: ClaimedMessage, nowSeconds: number): Promise<void> {
    const battle = await prisma.battleLedger.findUnique({ where: { battleId: message.battleId } });
    if (!battle) {
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    if (battle.kind === BATTLE_KIND.team) {
        await processTeamVerify(battle, message, nowSeconds);
        return;
    }
    if (battle.state !== BattleState.computed) {
        await completeOutbox(message.id, new Date(nowSeconds * 1000));
        return;
    }
    if (!battle.seed || !battle.combatLogHash || battle.rounds === null || battle.winnerHpRemaining === null || battle.attackerWon === null) {
        throw new Error(`battle ${battle.battleId} is computed but is missing a computed field`);
    }

    const ruleset = await loadPublishedRuleset(battle.rulesetHash, `verify battle ${battle.battleId}`);

    const { attacker, defender } = decodeStoredSnapshot(battle.snapshot);

    const outcome = await callVerifyBattle({
        attacker: verifyPetInputs(attacker),
        defender: verifyPetInputs(defender),
        seed: battle.seed,
        skillConfig: ruleset.skillConfig,
        maxLevel: ruleset.maxLevel,
    });
    if (!outcome.ok) {
        // A real failure, not a disagreement: let the dispatcher's backoff handle it.
        throw new Error(`indexer-go verification unavailable (${outcome.reason}): ${outcome.detail}`);
    }

    const mismatches = compareEverything(battle, outcome.response);

    const verificationDetail = serializeBigints({
        goResponse: outcome.response,
        mismatches,
        checkedAt: nowSeconds,
    });

    if (mismatches.length === 0) {
        await applyTransition({
            battleId: battle.battleId,
            from: BattleState.computed,
            to: BattleState.verified,
            patch: { verificationDetail },
            outbox: [{ battleId: battle.battleId, topic: OUTBOX_TOPICS.sign }],
        });
        notifyBattleRoomIfPresent(battle.roomId, { type: 'battle-updated', battleId: battle.battleId, state: BattleState.verified });
    } else {
        await applyTransition({
            battleId: battle.battleId,
            from: BattleState.computed,
            to: BattleState.verification_failed,
            patch: {
                failureReason: `engine mismatch: ${mismatches.join('; ')}`,
                verificationDetail,
            },
        });
        notifyBattleRoomIfPresent(battle.roomId, {
            type: 'battle-updated',
            battleId: battle.battleId,
            state: BattleState.verification_failed,
        });
    }
    await completeOutbox(message.id, new Date(nowSeconds * 1000));
}


/**
 * Every field §F requires to match: winner, rounds, winner HP, the combat-log
 * hash (recomputed here from Go's structured log using the same canonical
 * encoder the TypeScript engine's own hash was taken with — see
 * services/indexer-go/internal/combat/verify.go's doc comment for why Go never
 * reimplements that encoding itself), and the full progression delta for both
 * pets.
 */
function compareEverything(
    battle: {
        attackerWon: boolean | null;
        rounds: number | null;
        winnerHpRemaining: number | null;
        combatLogHash: string | null;
        progression: Prisma.JsonValue;
    },
    go: VerifyBattleWire,
): string[] {
    const mismatches: string[] = [];

    if (battle.attackerWon !== go.firstWins) {
        mismatches.push(`winner: ts=${battle.attackerWon} go=${go.firstWins}`);
    }
    if (battle.rounds !== go.rounds) {
        mismatches.push(`rounds: ts=${battle.rounds} go=${go.rounds}`);
    }
    if (battle.winnerHpRemaining !== go.winnerHpRemaining) {
        mismatches.push(`winnerHpRemaining: ts=${battle.winnerHpRemaining} go=${go.winnerHpRemaining}`);
    }

    const goOutcome: SimOutcome = {
        result: { firstWins: go.firstWins, rounds: go.rounds, winnerHpRemaining: go.winnerHpRemaining },
        log: go.log.map((entry) => ({
            round: entry.round,
            attacker: entry.attacker as 1 | 2,
            isMagic: entry.isMagic,
            crit: entry.crit,
            damage: BigInt(entry.damage),
            heal: BigInt(entry.heal),
            elementMult: entry.elementMult,
            furyTriggered: entry.furyTriggered,
            rebirthTriggered: entry.rebirthTriggered,
            hp1After: BigInt(entry.hp1After),
            hp2After: BigInt(entry.hp2After),
        })),
        startHp1: BigInt(go.startHp1),
        startHp2: BigInt(go.startHp2),
    };
    const goCombatLogHash = hashCombatLog(goOutcome);
    if (goCombatLogHash.toLowerCase() !== battle.combatLogHash?.toLowerCase()) {
        mismatches.push(`combatLogHash: ts=${battle.combatLogHash} go=${goCombatLogHash}`);
    }

    const tsProgression = battle.progression as unknown as ProgressionDelta;
    mismatches.push(...compareProgression('attacker', tsProgression?.attacker, go.attacker));
    mismatches.push(...compareProgression('defender', tsProgression?.defender, go.defender));

    return mismatches;
}

const PROGRESSION_FIELDS = [
    'petId',
    'won',
    'decayShift',
    'xpAwarded',
    'lastOpponentId',
    'streak',
    'level',
    'xp',
    'leveledUp',
] as const;

function compareProgression(
    side: string,
    ts: PetProgression | undefined,
    go: VerifyPetProgressionWire,
): string[] {
    if (!ts) {
        return [`${side} progression: missing on the TS side`];
    }
    const tsRecord = ts as unknown as Record<string, unknown>;
    const goRecord = go as unknown as Record<string, unknown>;
    const mismatches: string[] = [];
    for (const field of PROGRESSION_FIELDS) {
        // Stringified so bigint (TS) and string (Go wire) forms of petId/lastOpponentId
        // compare equal, and every other field compares the same way.
        if (String(tsRecord[field]) !== String(goRecord[field])) {
            mismatches.push(`${side}.${field}: ts=${String(tsRecord[field])} go=${String(goRecord[field])}`);
        }
    }
    return mismatches;
}

function serializeBigints<T>(value: T): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
