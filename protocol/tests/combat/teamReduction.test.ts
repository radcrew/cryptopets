import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type AttrBonus, NO_BONUS, simulate, simulateTeam, type SkillConfig, type TeamFighter } from '../../src/combat';

/**
 * A one-on-one team battle is today's duel, strike for strike (docs/battle-protocol.md §F,
 * "Duels are the special case").
 *
 * Every battle.json and equipment.json case is replayed through the team engine with one
 * fighter a side. The expected result is the vector's own, so this cannot pass by the two
 * engines agreeing on something wrong; the strike-by-strike comparison with `simulate` then
 * proves no team rule fired along the way, which the result alone could hide.
 */
interface DuelCase {
    name: string;
    dna1: string; rarity1: number; level1: number; skill1: number; bonus1?: AttrBonus;
    dna2: string; rarity2: number; level2: number; skill2: number; bonus2?: AttrBonus;
    seed: string;
    expected: { firstWins: boolean; rounds: number; winnerHpRemaining: number };
}

interface DuelFile {
    skillConfig: SkillConfig;
    cases: DuelCase[];
}

const here = dirname(fileURLToPath(import.meta.url));
const load = (file: string): DuelFile =>
    JSON.parse(readFileSync(join(here, '../../../contracts/test-vectors', file), 'utf8')) as DuelFile;

function fighter(dna: string, rarity: number, level: number, skill: number, bonus: AttrBonus): TeamFighter {
    // Face to face on the front line. Any tiles would do with one fighter a side.
    return { dna: BigInt(dna), rarity, level, skill, bonus, col: 2, row: 1, tactic: 'focus', range: 'melee', temperament: 'none', speed: 0 };
}

for (const file of ['battle.json', 'equipment.json']) {
    const vectors = load(file);
    describe(`one-on-one team battles reproduce ${file}`, () => {
        for (const c of vectors.cases) {
            it(c.name, () => {
                const bonus1 = c.bonus1 ?? NO_BONUS;
                const bonus2 = c.bonus2 ?? NO_BONUS;
                const team = simulateTeam(
                    [fighter(c.dna1, c.rarity1, c.level1, c.skill1, bonus1)],
                    [fighter(c.dna2, c.rarity2, c.level2, c.skill2, bonus2)],
                    BigInt(c.seed),
                    vectors.skillConfig,
                );
                expect(team.result).toEqual({
                    attackerWins: c.expected.firstWins,
                    rounds: c.expected.rounds,
                    winnerHpRemaining: c.expected.winnerHpRemaining,
                });

                const duel = simulate(
                    BigInt(c.dna1), c.rarity1, c.level1, c.skill1,
                    BigInt(c.dna2), c.rarity2, c.level2, c.skill2,
                    BigInt(c.seed), vectors.skillConfig, bonus1, bonus2,
                );
                expect(team.startHp).toEqual([[duel.startHp1], [duel.startHp2]]);
                expect(team.log.map((s) => ({
                    round: s.round,
                    attacker: s.side + 1,
                    isMagic: s.isMagic,
                    crit: s.crit,
                    damage: s.damage,
                    heal: s.heal,
                    elementMult: s.elementMult,
                    furyTriggered: s.furyTriggered,
                    rebirthTriggered: s.secondChance,
                }))).toEqual(duel.log.map((s) => ({
                    round: s.round,
                    attacker: s.attacker,
                    isMagic: s.isMagic,
                    crit: s.crit,
                    damage: s.damage,
                    heal: s.heal,
                    elementMult: s.elementMult,
                    furyTriggered: s.furyTriggered,
                    rebirthTriggered: s.rebirthTriggered,
                })));
                for (const s of team.log) {
                    expect([s.combo, s.longShot, s.temperament, s.exposed, s.guarded]).toEqual([0, false, false, false, false]);
                }
            });
        }
    });
}
