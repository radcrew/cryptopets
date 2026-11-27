import { computeProgression, type PetProgression, type ProgressionParams } from '../progression/progression';
import { computeTeamProgression } from '../progression/team';
import { resolveDrandChain, verifyBeacon } from '../randomness/drand';

import { type AnyBattleReceipt, assertAnyBattleReceipt, assertTeamBattleReceipt, type TeamBattleReceipt } from './team';
import { assertBattleReceipt, type BattleReceipt } from './types';

/**
 * The checks a receipt can be held to on its own, without the combat log and without any
 * data from us.
 *
 * `assertBattleReceipt` already covers the cheap internal consistency (randomness is the
 * signature hash, seed follows from the inputs, times are ordered). This adds the two
 * expensive ones: the BLS signature, and recomputing the progression delta.
 *
 * What is *not* here: replaying the fight itself. That needs the ruleset's skill config,
 * which this module deliberately does not take, so it belongs to the standalone verifier
 * where the published bundle is resolved alongside. Progression is checkable here because
 * the snapshot carries the streak state it depends on.
 *
 * Each half is also exported on its own, because their preconditions differ: the beacon
 * check needs nothing but the receipt, while progression needs the level cap from the
 * ruleset the receipt names.
 */

export type ReceiptCheck = 'beacon-signature' | 'progression';

export interface ReceiptCheckFailure {
    check: ReceiptCheck;
    detail: string;
}

export type ReceiptVerification = { ok: true } | { ok: false; failures: ReceiptCheckFailure[] };

/**
 * Verifies a receipt's beacon and progression.
 *
 * Reports every failure rather than the first, because "the beacon is forged and the XP
 * is wrong" and "the XP is wrong" are different situations and the difference matters
 * when deciding what a mismatch means.
 *
 * `params` supplies the level cap, which lives in the ruleset the receipt names. A caller
 * that has loaded the pinned ruleset bundle passes its values; passing the wrong ones
 * produces a progression mismatch, which is the correct outcome rather than a false pass.
 */
export function verifyReceiptConsistency(receipt: BattleReceipt, params: ProgressionParams): ReceiptVerification {
    const failures = [...beaconFailures(receipt), ...progressionFailures(receipt, params)];
    return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

/**
 * The beacon half on its own.
 *
 * Split out because it is the only expensive check that needs nothing from the ruleset: a
 * verifier that could not obtain the bundle a receipt names can still confirm the
 * randomness was real, and reporting "we could not check the beacon" in that case would be
 * a worse answer than the one available.
 */
export function verifyReceiptBeacon(receipt: AnyBattleReceipt): ReceiptVerification {
    const failures = beaconFailures(receipt);
    return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

/**
 * Recomputes a team battle's six progressions and compares them with the receipt's. The team
 * counterpart of `verifyReceiptProgression`, needing the same thing from the ruleset: the
 * level cap.
 */
export function verifyTeamReceiptProgression(receipt: TeamBattleReceipt, params: ProgressionParams): ReceiptVerification {
    const checked = assertTeamBattleReceipt(receipt);
    const recomputed = computeTeamProgression(checked.snapshot, checked.result.attackerWon, params);
    const mismatches = recomputed.flatMap((expected, i) => compareProgression(`fighter ${i}`, expected, checked.progression[i]));
    return mismatches.length === 0 ? { ok: true } : { ok: false, failures: [{ check: 'progression', detail: mismatches.join('; ') }] };
}

/** The progression half on its own. Needs the level cap from the ruleset the receipt names. */
export function verifyReceiptProgression(receipt: BattleReceipt, params: ProgressionParams): ReceiptVerification {
    const failures = progressionFailures(receipt, params);
    return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

function beaconFailures(receipt: AnyBattleReceipt): ReceiptCheckFailure[] {
    const checked = assertAnyBattleReceipt(receipt);
    const chain = resolveDrandChain(checked.beacon.chainHash);
    if (verifyBeacon(chain, { round: checked.beacon.round, signature: checked.beacon.signature })) {
        return [];
    }
    return [
        {
            check: 'beacon-signature',
            detail: `drand round ${checked.beacon.round} does not verify against chain ${chain.chainHash}`,
        },
    ];
}

function progressionFailures(receipt: BattleReceipt, params: ProgressionParams): ReceiptCheckFailure[] {
    const checked = assertBattleReceipt(receipt);
    const recomputed = computeProgression(checked.snapshot, checked.result.attackerWon, params);
    const mismatches = [
        ...compareProgression('attacker', recomputed.attacker, checked.progression.attacker),
        ...compareProgression('defender', recomputed.defender, checked.progression.defender),
    ];
    return mismatches.length === 0 ? [] : [{ check: 'progression', detail: mismatches.join('; ') }];
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
] as const satisfies readonly (keyof PetProgression)[];

function compareProgression(side: string, expected: PetProgression, actual: PetProgression | undefined): string[] {
    if (!actual) {
        return [`${side} progression missing`];
    }
    const differences: string[] = [];
    for (const field of PROGRESSION_FIELDS) {
        // Stringified so bigint and number fields compare the same way, and so the
        // message reads the same for both.
        if (String(expected[field]) !== String(actual[field])) {
            differences.push(`${side}.${field}: expected ${String(expected[field])}, got ${String(actual[field])}`);
        }
    }
    return differences;
}
