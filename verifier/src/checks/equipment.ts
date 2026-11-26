import {
    type AnyBattleReceipt,
    bonusFromEquipment,
    type EquipmentBearer,
    findEquipmentMismatches,
    isTeamBattleReceipt,
    type Ruleset,
} from '@cryptopets/protocol';

import type { CheckResult } from './types';

/**
 * Confirms each pet's frozen modifiers are the ones its items are supposed to grant
 * (roadmap §4, threat T13).
 *
 * The comparison itself is `findEquipmentMismatches` in `@cryptopets/protocol`, not a copy
 * here. It gained a second caller once the backend began refusing a battle at acceptance
 * on the same grounds, and two implementations of one comparison would drift into a battle
 * that accepts and then fails to verify — with the comparison the last thing anyone would
 * suspect. This function's own job is the part that is specific to verifying: naming the
 * check and shaping the result.
 *
 * What it still does not prove is that the pet *owned* the item. That is a claim about
 * chain state at `sourceVersion`, which this package deliberately cannot read — it has no
 * network access, by design. A verifier that wants that checks `ItemCore.equipmentOf` at
 * the recorded version itself; this narrows the remaining trust to exactly that one
 * question.
 */
export function checkEquipment(receipt: AnyBattleReceipt, ruleset: Ruleset): CheckResult {
    const check = 'equipment';
    // A team battle checks every loadout it froze, all eight, benched roster pets included:
    // any of the five could have been drawn, so each one's gear is a claim the receipt makes.
    const bearers: EquipmentBearer[] = isTeamBattleReceipt(receipt)
        ? [
              ...receipt.snapshot.attackers.map((m, i) => ({ role: `attackers[${i}]`, equipment: m.pet.equipment })),
              ...receipt.snapshot.roster.map((m, i) => ({ role: `roster[${i}]`, equipment: m.pet.equipment })),
          ]
        : [
              { role: 'attacker', equipment: receipt.snapshot.attacker.equipment },
              { role: 'defender', equipment: receipt.snapshot.defender.equipment },
          ];
    const mismatches = findEquipmentMismatches(bearers, ruleset);

    return mismatches.length === 0 ? { check, ok: true } : { check, ok: false, detail: mismatches.join('; ') };
}

/**
 * Re-exported rather than reimplemented.
 *
 * A replay has to reproduce the fight exactly, so it totals equipment with the same code
 * that ran it. This package used to have its own copy, which is two implementations of one
 * addition and a divergence that would surface as an unexplained replay mismatch.
 *
 * The snapshot's numbers are what get totalled, not the catalog's: the replay reproduces
 * what happened, and `checkEquipment` above is what says whether that was correct.
 */
export { bonusFromEquipment as equipmentBonus };
