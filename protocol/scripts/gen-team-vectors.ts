/**
 * Writes contracts/test-vectors/team.json (docs/battle-protocol.md §F, "Team battles").
 *
 * Run with `pnpm --filter @cryptopets/protocol vectors:team`.
 *
 * **Regenerating to make a failing test pass is forbidden** (`AGENTS.md`), the same rule the
 * other generators carry. Both live ports are held to this file, so a failure means a port
 * drifted from the specification; fix the port. This script exists to add cases.
 *
 * Every case pins one rule, and proves it: `pins` must hold for the fight that gets written,
 * usually by showing that switching the rule off changes the battle. A case whose rule never
 * fired would pass in both ports while testing nothing. Each seed is the first one from 1
 * upwards where `pins` holds, so none of them is a magic number.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    type AttrBonus,
    DEFAULT_SKILL_CONFIG,
    DEFAULT_TEAM_CONFIG,
    NO_BONUS,
    NO_SKILL,
    type Range,
    simulate,
    simulateTeam,
    SKILL_BLOODLUST,
    SKILL_CUNNING,
    SKILL_FURY,
    SKILL_REBIRTH,
    SKILL_SAGE,
    SKILL_SHELL,
    SKILL_SWIFT,
    SKILL_TANK,
    type Tactic,
    type TeamConfig,
    type TeamFighter,
    type TeamOutcome,
    type TeamStrikeLogEntry,
    type Temperament,
} from '../src/combat';

interface PetSpec {
    element?: number;
    hp?: number;
    atk?: number;
    def?: number;
    int?: number;
    mdef?: number;
    level?: number;
    rarity?: number;
    skill?: number;
    bonus?: AttrBonus;
    col: number;
    row: number;
    tactic?: Tactic;
    range?: Range;
    temperament?: Temperament;
    speed?: number;
}

/** Genes go in DNA pairs 0 to 5, least significant first, exactly as `extract` reads them. */
function pet(s: PetSpec): TeamFighter {
    const genes = [s.element ?? 0, s.hp ?? 40, s.atk ?? 40, s.def ?? 40, s.int ?? 40, s.mdef ?? 40, 12, 34];
    const dna = genes.reduce((sum, g, i) => sum + BigInt(g) * 100n ** BigInt(i), 0n);
    return {
        dna, rarity: s.rarity ?? 1, level: s.level ?? 20, skill: s.skill ?? NO_SKILL, bonus: s.bonus ?? NO_BONUS,
        col: s.col, row: s.row, tactic: s.tactic ?? 'focus', range: s.range ?? 'melee',
        temperament: s.temperament ?? 'none', speed: s.speed ?? 0,
    };
}

interface Fight {
    attackers: TeamFighter[];
    defenders: TeamFighter[];
    teamConfig: TeamConfig;
}

interface CaseSpec extends Fight {
    name: string;
    note: string;
    /** Must hold for the fight that gets written. */
    pins: (o: TeamOutcome, seed: bigint, fight: Fight) => boolean;
    /** A fixed seed instead of a search, for the anchors. */
    seed?: bigint;
}

const run = (f: Fight, seed: bigint) => simulateTeam(f.attackers, f.defenders, seed, DEFAULT_SKILL_CONFIG, f.teamConfig);
const sameLog = (a: TeamOutcome, b: TeamOutcome) => JSON.stringify(a.log, big) === JSON.stringify(b.log, big);
/** The rule matters in this fight: turning it off changes what happens. */
const differsWith = (change: (f: Fight) => Fight) => (o: TeamOutcome, seed: bigint, f: Fight) => !sameLog(o, run(change(f), seed));
const withConfig = (patch: Partial<TeamConfig>) => (f: Fight): Fight => ({ ...f, teamConfig: { ...f.teamConfig, ...patch } });
const withFighter = (side: 0 | 1, slot: number, patch: Partial<TeamFighter>) => (f: Fight): Fight => {
    const list = side === 0 ? f.attackers : f.defenders;
    const changed = list.map((p, i) => (i === slot ? { ...p, ...patch } : p));
    return side === 0 ? { ...f, attackers: changed } : { ...f, defenders: changed };
};
const both = (...checks: CaseSpec['pins'][]): CaseSpec['pins'] => (o, s, f) => checks.every((c) => c(o, s, f));
const some = (test: (s: TeamStrikeLogEntry) => boolean): CaseSpec['pins'] => (o) => o.log.some(test);
const neutral = DEFAULT_TEAM_CONFIG;
const speedOrder: TeamConfig = { ...DEFAULT_TEAM_CONFIG, turnOrder: 'speed' };

/** Board column of a fighter, as the specification defines it. */
const boardX = (side: 0 | 1, p: TeamFighter) => (side === 0 ? p.col : 5 - p.col);

const CASES: CaseSpec[] = [
    {
        name: 'duel-matches-battle-json',
        note: 'battle.json\'s baseline-no-skill as a one-on-one team battle. Must reproduce it exactly (side 0 loses in 6 rounds with 174 HP left); the test suites replay every other battle.json and equipment.json case the same way.',
        attackers: [{ ...pet({ col: 2, row: 1 }), dna: 1234567890123456n }],
        defenders: [{ ...pet({ col: 2, row: 1 }), dna: 9876543210987654n }],
        teamConfig: neutral,
        seed: 1n,
        pins: (o) => !o.result.attackerWins && o.result.rounds === 6 && o.result.winnerHpRemaining === 174,
    },
    {
        name: 'melee-reach-and-front-line-collapse',
        note: 'Defenders stand back (slot 0), mid (slot 1) and front (slot 2), so Focus would pick the back pet on a tie. A Melee physical strike only reaches the front line and a Reach one also the column behind it, while magic reaches anyone. When the front pet falls, the mid column becomes the front line.',
        attackers: [
            pet({ atk: 99, int: 0, hp: 99, col: 2, row: 0, range: 'melee' }),
            pet({ atk: 99, int: 0, hp: 99, col: 2, row: 2, range: 'reach' }),
        ],
        defenders: [
            pet({ col: 0, row: 1, atk: 0, int: 0, mdef: 99 }),
            pet({ col: 1, row: 1, atk: 0, int: 0, mdef: 99 }),
            pet({ col: 2, row: 1, atk: 0, int: 0, hp: 0 }),
        ],
        teamConfig: neutral,
        pins: (o, _s, f) => {
            const x = (slot: number) => boardX(1, f.defenders[slot] as TeamFighter);
            let front = 3;
            let collapsed = false;
            let magicBack = false;
            for (const s of o.log) {
                if (s.side !== 0) continue;
                if (s.isMagic) magicBack ||= s.target === 0;
                else if (s.actor === 0 && x(s.target) !== front) return false;
                else if (s.actor === 1 && x(s.target) !== front && x(s.target) !== front + 1) return false;
                if (s.knockedOut && s.victim === 2) {
                    front = 4;
                    collapsed = true;
                }
            }
            return collapsed && magicBack && o.log.some((s) => s.side === 0 && !s.isMagic && s.actor === 0 && s.target === 1);
        },
    },
    {
        name: 'ranged-long-shot',
        note: 'A Ranged physical strike on the back-line pet, beyond the front line, deals 85%. Pinned by the flag and by the fight changing at longShotPct 100.',
        attackers: [pet({ atk: 99, int: 0, col: 0, row: 1, range: 'ranged' })],
        defenders: [pet({ col: 0, row: 1, def: 0, hp: 0 }), pet({ col: 2, row: 1, def: 99 })],
        teamConfig: neutral,
        pins: both(some((s) => s.longShot && s.target === 0), differsWith(withConfig({ longShotPct: 100 }))),
    },
    {
        name: 'shell-and-sage-auras',
        note: 'The front pet has a Shell neighbour and a Sage neighbour, so it takes hits at +10% DEF and +10% MDEF. Pinned by the fight changing at auraPct 100.',
        attackers: [pet({ atk: 70, int: 70, col: 2, row: 1 })],
        defenders: [
            pet({ col: 1, row: 0, skill: SKILL_SHELL }),
            pet({ col: 2, row: 0, def: 30, mdef: 30, hp: 0 }),
            pet({ col: 2, row: 1, skill: SKILL_SAGE }),
        ],
        teamConfig: neutral,
        pins: both(
            some((s) => s.side === 0 && s.target === 1),
            differsWith(withConfig({ auraPct: 100 })),
        ),
    },
    {
        name: 'combo-on-one-target',
        note: 'Three Focus attackers on one front-line target. The second and third hits in a round carry combo 1 and 2, worth +10% and +20%.',
        attackers: [
            pet({ col: 2, row: 0 }),
            pet({ col: 2, row: 1 }),
            pet({ col: 2, row: 2 }),
        ],
        defenders: [pet({ col: 2, row: 1, hp: 99, def: 60 })],
        teamConfig: neutral,
        pins: both(some((s) => s.combo === 2), differsWith(withConfig({ comboStepPct: 0 }))),
    },
    {
        name: 'expose-after-cunning-crit',
        note: 'A Cunning crit marks its target, and the next teammate to hit it deals 120% and spends the mark.',
        attackers: [
            pet({ int: 99, col: 2, row: 0, skill: SKILL_CUNNING }),
            pet({ int: 10, col: 2, row: 1 }),
        ],
        defenders: [pet({ col: 2, row: 1, hp: 99, def: 60, mdef: 60 })],
        teamConfig: neutral,
        pins: both(some((s) => s.exposed && s.actor === 1), differsWith(withConfig({ exposePct: 100 }))),
    },
    {
        name: 'tank-guards-a-neighbour',
        note: 'A hit that would knock out the frail front pet lands on its Tank neighbour instead, once per battle.',
        attackers: [pet({ atk: 99, int: 0, hp: 99, col: 2, row: 1 })],
        defenders: [
            pet({ col: 2, row: 0, hp: 0, def: 0 }),
            pet({ col: 1, row: 0, skill: SKILL_TANK, hp: 99, def: 60 }),
        ],
        teamConfig: neutral,
        pins: (o) => o.log.filter((s) => s.guarded).length === 1 && o.log.some((s) => s.guarded && s.target === 0 && s.victim === 1),
    },
    {
        name: 'tailwind-from-swift-neighbours',
        note: 'Two Swift neighbours add 2% crit chance each to the middle pet. Pinned by a crit that disappears at tailwindBps 0.',
        attackers: [
            pet({ col: 2, row: 0, skill: SKILL_SWIFT }),
            pet({ col: 2, row: 1 }),
            pet({ col: 2, row: 2, skill: SKILL_SWIFT }),
        ],
        defenders: [pet({ col: 2, row: 1, hp: 99, def: 70, mdef: 70 })],
        teamConfig: neutral,
        pins: (o, seed, f) => {
            const without = run(withConfig({ tailwindBps: 0 })(f), seed);
            const first = o.log.findIndex((s, i) => s.crit !== without.log[i]?.crit);
            return first >= 0 && o.log[first]?.actor === 1 && o.log[first]?.crit === true;
        },
    },
    {
        name: 'fury-rally',
        note: 'A Fury pet at full health strikes at +30% once a teammate has been knocked out.',
        attackers: [pet({ atk: 99, hp: 99, col: 2, row: 1 })],
        defenders: [
            pet({ col: 2, row: 0, hp: 0, def: 0, mdef: 0 }),
            pet({ col: 2, row: 2, hp: 99, skill: SKILL_FURY }),
        ],
        teamConfig: neutral,
        pins: (o) => {
            const fall = o.log.findIndex((s) => s.knockedOut && s.victim === 0);
            return fall >= 0 && o.log.some((s, i) => i > fall && s.side === 1 && s.actor === 1 && s.furyTriggered);
        },
    },
    {
        name: 'lifelink-heals-an-injured-neighbour',
        note: 'A Bloodlust physical hit heals the most injured of itself and its neighbours: here the battered neighbour, which the Breaker defender goes after for its INT, not the striker.',
        attackers: [
            pet({ atk: 99, int: 0, hp: 99, col: 2, row: 0, skill: SKILL_BLOODLUST }),
            pet({ col: 2, row: 1, hp: 0, def: 0, mdef: 0, int: 99 }),
        ],
        defenders: [pet({ col: 2, row: 1, hp: 99, atk: 60, def: 60, tactic: 'breaker' })],
        teamConfig: neutral,
        pins: some((s) => s.side === 0 && s.actor === 0 && s.healed === 1),
    },
    {
        name: 'second-chance-for-a-teammate',
        note: 'A Rebirth pet\'s second chance saves the first teammate knocked out, leaving it on 1 HP, and is spent.',
        attackers: [pet({ atk: 99, int: 99, hp: 99, col: 2, row: 1 })],
        defenders: [
            pet({ col: 2, row: 0, hp: 0, def: 0, mdef: 0 }),
            pet({ col: 1, row: 0, hp: 99, skill: SKILL_REBIRTH }),
        ],
        teamConfig: neutral,
        pins: (o) => o.log.filter((s) => s.secondChance).length === 1
            && o.log.some((s) => s.secondChance && s.victim === 0 && s.victimHpAfter === 1n),
    },
    {
        name: 'breaker-targets-highest-int',
        note: 'Breaker goes for the highest-INT enemy in reach, here slot 1, where Focus would take slot 0 on the tie.',
        attackers: [pet({ col: 2, row: 1, tactic: 'breaker' })],
        defenders: [pet({ col: 2, row: 0, int: 10 }), pet({ col: 2, row: 2, int: 90 })],
        teamConfig: neutral,
        pins: both(
            (o) => o.log.find((s) => s.side === 0)?.target === 1,
            differsWith(withFighter(0, 0, { tactic: 'focus' })),
        ),
    },
    {
        name: 'hunter-targets-element-prey',
        note: 'Hunter (element 0) goes for the enemy its element beats (element 1, slot 1) rather than the Focus pick.',
        attackers: [pet({ col: 2, row: 1, element: 0, tactic: 'hunter' })],
        defenders: [pet({ col: 2, row: 0, element: 3 }), pet({ col: 2, row: 2, element: 1 })],
        teamConfig: neutral,
        pins: both(
            (o) => o.log.find((s) => s.side === 0)?.target === 1,
            differsWith(withFighter(0, 0, { tactic: 'focus' })),
        ),
    },
    {
        name: 'bodyguard-targets-the-last-hitter',
        note: 'Bodyguard goes for whoever last hit its most injured teammate. Pinned by the fight changing when it plays Focus instead.',
        attackers: [
            pet({ col: 2, row: 0, tactic: 'bodyguard', hp: 99 }),
            pet({ col: 2, row: 1, hp: 0, def: 0, mdef: 0 }),
        ],
        defenders: [
            pet({ col: 2, row: 0, hp: 0, atk: 0, int: 0 }),
            pet({ col: 2, row: 2, hp: 99, atk: 70, int: 70, def: 70, mdef: 70 }),
        ],
        teamConfig: neutral,
        pins: both(
            some((s) => s.side === 0 && s.actor === 0 && s.target === 1),
            differsWith(withFighter(0, 0, { tactic: 'focus' })),
        ),
    },
    {
        name: 'temperament-suits-the-tactic',
        note: 'A Brave pet playing Focus deals 105%; the flag shows on its strikes and the fight changes without the temperament.',
        attackers: [pet({ col: 2, row: 1, temperament: 'brave', tactic: 'focus' })],
        defenders: [pet({ col: 2, row: 1, hp: 60 })],
        teamConfig: neutral,
        pins: both(some((s) => s.side === 0 && s.temperament), differsWith(withFighter(0, 0, { temperament: 'none' }))),
    },
    {
        name: 'speed-order-puts-a-fast-shell-first',
        note: 'Under the speed turn order the fastest pet acts first even when it is a Shell, which the int order would put last.',
        attackers: [pet({ col: 2, row: 1, skill: SKILL_SHELL, speed: 90, int: 10 }), pet({ col: 2, row: 0, speed: 50, int: 90 })],
        defenders: [pet({ col: 2, row: 1, speed: 70, int: 60 })],
        teamConfig: speedOrder,
        pins: both(
            (o) => o.log[0]?.side === 0 && o.log[0]?.actor === 0,
            differsWith(withConfig({ turnOrder: 'int' })),
        ),
    },
    {
        name: 'thirty-rounds-hp-share',
        note: 'Two walls that cannot finish each other in 30 rounds. The higher share of total HP left wins.',
        attackers: [pet({ col: 2, row: 0, level: 1, atk: 0, int: 0, hp: 99, def: 99, mdef: 99, rarity: 5 }), pet({ col: 2, row: 1, level: 1, atk: 5, int: 0, hp: 99, def: 99, mdef: 99, rarity: 5 })],
        defenders: [pet({ col: 2, row: 0, level: 1, atk: 0, int: 0, hp: 99, def: 99, mdef: 99, rarity: 5 }), pet({ col: 2, row: 1, level: 1, atk: 0, int: 5, hp: 99, def: 99, mdef: 99, rarity: 5 })],
        teamConfig: neutral,
        pins: (o) => o.result.rounds === 30 && o.finalHp.flat().every((hp) => hp > 0n),
    },
    {
        name: 'thirty-rounds-exact-tie-goes-to-the-defender',
        note: 'Both sides stand after 30 rounds with exactly the same share of HP left, so the defender wins.',
        attackers: [pet({ col: 2, row: 1, level: 1, atk: 0, int: 0, hp: 99, def: 99, mdef: 99, rarity: 5 })],
        defenders: [pet({ col: 2, row: 1, level: 1, atk: 0, int: 0, hp: 99, def: 99, mdef: 99, rarity: 5 })],
        teamConfig: neutral,
        pins: (o) => {
            const share = (side: 0 | 1) => (o.finalHp[side].reduce((a, b) => a + b, 0n) * 10000n) / o.startHp[side].reduce((a, b) => a + b, 0n);
            return o.result.rounds === 30 && share(0) === share(1) && !o.result.attackerWins;
        },
    },
    {
        name: 'full-neutral-squads',
        note: 'Three against three at launch settings: everyone Melee, int turn order, no temperament. Mixed skills, so several rules meet in one fight.',
        attackers: [
            pet({ element: 0, hp: 60, atk: 80, def: 50, int: 35, mdef: 40, level: 12, rarity: 2, skill: SKILL_FURY, col: 2, row: 1 }),
            pet({ element: 4, hp: 62, atk: 41, def: 55, int: 78, mdef: 47, level: 13, rarity: 3, skill: SKILL_CUNNING, col: 1, row: 1 }),
            pet({ element: 2, hp: 55, atk: 50, def: 40, int: 70, mdef: 45, level: 11, rarity: 2, skill: SKILL_SWIFT, col: 1, row: 2, tactic: 'hunter' }),
        ],
        defenders: [
            pet({ element: 5, hp: 80, atk: 52, def: 64, int: 72, mdef: 75, level: 14, rarity: 2, skill: SKILL_SAGE, col: 1, row: 1, tactic: 'breaker' }),
            pet({ element: 1, hp: 70, atk: 45, def: 75, int: 50, mdef: 55, level: 12, rarity: 3, skill: SKILL_SHELL, col: 2, row: 1, tactic: 'hunter' }),
            pet({ element: 3, hp: 90, atk: 55, def: 60, int: 30, mdef: 50, level: 10, rarity: 1, skill: SKILL_TANK, col: 2, row: 0, tactic: 'bodyguard' }),
        ],
        teamConfig: neutral,
        pins: (o) => o.result.rounds > 3 && o.log.length > 12,
    },
    {
        name: 'full-geared-squads',
        note: 'The neutral squads wearing equipment bonuses, with Bloodlust and Rebirth on the defending side.',
        attackers: [
            pet({ element: 0, hp: 60, atk: 80, def: 50, int: 35, mdef: 40, level: 12, rarity: 2, skill: SKILL_FURY, col: 2, row: 1, bonus: { hp: 30, atk: 22, def: 10, int: 0, mdef: 0 } }),
            pet({ element: 4, hp: 62, atk: 41, def: 55, int: 78, mdef: 47, level: 13, rarity: 3, skill: SKILL_CUNNING, col: 1, row: 1, bonus: { hp: 12, atk: 10, def: 4, int: 16, mdef: 8 } }),
            pet({ element: 2, hp: 55, atk: 50, def: 40, int: 70, mdef: 45, level: 11, rarity: 2, skill: SKILL_SWIFT, col: 2, row: 2, bonus: { hp: 0, atk: 4, def: 0, int: 0, mdef: 6 } }),
        ],
        defenders: [
            pet({ element: 5, hp: 80, atk: 52, def: 64, int: 72, mdef: 75, level: 14, rarity: 2, skill: SKILL_REBIRTH, col: 1, row: 1, bonus: { hp: 0, atk: 4, def: 0, int: 12, mdef: 8 } }),
            pet({ element: 1, hp: 70, atk: 45, def: 75, int: 50, mdef: 55, level: 12, rarity: 3, skill: SKILL_BLOODLUST, col: 2, row: 1, bonus: { hp: 12, atk: 0, def: 4, int: 0, mdef: 6 } }),
            pet({ element: 3, hp: 90, atk: 55, def: 60, int: 30, mdef: 50, level: 10, rarity: 1, skill: SKILL_TANK, col: 2, row: 0, bonus: { hp: 45, atk: 0, def: 16, int: 0, mdef: 6 } }),
        ],
        teamConfig: neutral,
        pins: (o) => o.result.rounds > 3 && o.log.length > 12,
    },
    {
        name: 'full-attributes-2-squads',
        note: 'Every input Attributes 2.0 adds: the speed turn order, all three ranges, and temperaments that suit their tactics.',
        attackers: [
            pet({ element: 4, hp: 62, atk: 41, def: 55, int: 78, mdef: 47, level: 13, rarity: 3, skill: SKILL_CUNNING, col: 1, row: 0, range: 'ranged', tactic: 'breaker', temperament: 'clever', speed: 85 }),
            pet({ element: 2, hp: 55, atk: 50, def: 40, int: 70, mdef: 45, level: 11, rarity: 2, skill: SKILL_SWIFT, col: 1, row: 1, range: 'reach', tactic: 'hunter', temperament: 'wild', speed: 122 }),
            pet({ element: 0, hp: 60, atk: 80, def: 50, int: 35, mdef: 40, level: 12, rarity: 2, skill: SKILL_FURY, col: 2, row: 1, range: 'melee', tactic: 'focus', temperament: 'brave', speed: 87 }),
        ],
        defenders: [
            pet({ element: 5, hp: 80, atk: 52, def: 64, int: 72, mdef: 75, level: 14, rarity: 2, skill: SKILL_SAGE, col: 1, row: 1, range: 'ranged', tactic: 'breaker', temperament: 'clever', speed: 77 }),
            pet({ element: 1, hp: 70, atk: 45, def: 75, int: 50, mdef: 55, level: 12, rarity: 3, skill: SKILL_SHELL, col: 2, row: 1, range: 'melee', tactic: 'hunter', temperament: 'wild', speed: 58 }),
            pet({ element: 3, hp: 90, atk: 55, def: 60, int: 30, mdef: 50, level: 10, rarity: 1, skill: SKILL_TANK, col: 2, row: 0, range: 'melee', tactic: 'bodyguard', temperament: 'steady', speed: 47 }),
        ],
        teamConfig: speedOrder,
        pins: (o) => o.result.rounds > 3 && o.log.some((s) => s.temperament) && o.log.some((s) => s.longShot),
    },
];

const LOG_COLUMNS = [
    'round', 'side', 'actor', 'target', 'victim', 'isMagic', 'crit', 'damage', 'elementMult', 'combo',
    'longShot', 'furyTriggered', 'temperament', 'exposed', 'guarded', 'secondChance', 'knockedOut',
    'heal', 'healed', 'victimHpAfter',
] as const;

const b = (v: boolean) => (v ? 1 : 0);
function logRow(s: TeamStrikeLogEntry): number[] {
    return [
        s.round, s.side, s.actor, s.target, s.victim, b(s.isMagic), b(s.crit), Number(s.damage), s.elementMult, s.combo,
        b(s.longShot), b(s.furyTriggered), b(s.temperament), b(s.exposed), b(s.guarded), b(s.secondChance), b(s.knockedOut),
        Number(s.heal), s.healed ?? -1, Number(s.victimHpAfter),
    ];
}

function big(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

const fighterJson = (p: TeamFighter) => ({ ...p, dna: p.dna.toString() });

const MAX_SEARCH = 20000n;
const cases = CASES.map((c) => {
    let seed = c.seed ?? 1n;
    let outcome = run(c, seed);
    while (!c.pins(outcome, seed, c)) {
        if (c.seed !== undefined || seed >= MAX_SEARCH) throw new Error(`${c.name}: its rule never fires`);
        seed += 1n;
        outcome = run(c, seed);
    }
    return {
        name: c.name,
        note: c.note,
        seed: seed.toString(),
        teamConfig: c.teamConfig,
        attackers: c.attackers.map(fighterJson),
        defenders: c.defenders.map(fighterJson),
        expected: {
            ...outcome.result,
            startHp: outcome.startHp.map((side) => side.map(Number)),
            finalHp: outcome.finalHp.map((side) => side.map(Number)),
            log: outcome.log.map(logRow),
        },
    };
});

// The anchor really is battle.json's baseline, not merely a fight that happens to end the same.
const anchor = simulate(1234567890123456n, 1, 20, NO_SKILL, 9876543210987654n, 1, 20, NO_SKILL, 1n);
if (anchor.result.rounds !== 6 || anchor.result.winnerHpRemaining !== 174) throw new Error('anchor drifted from battle.json');

const doc = {
    description: 'Team battle golden vectors (docs/battle-protocol.md §F, "Team battles"). Generated by protocol/scripts/gen-team-vectors.ts; never regenerate to make a failing port pass. Each log row follows logColumns; booleans are 0 or 1, and healed is -1 when nothing was healed.',
    skillConfig: DEFAULT_SKILL_CONFIG,
    logColumns: LOG_COLUMNS,
    cases,
};

const out = join(process.cwd(), '../contracts/test-vectors/team.json');
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log('wrote', out);
for (const c of cases) console.log(' ', c.name.padEnd(46), 'seed', c.seed.padEnd(5), JSON.stringify({ w: c.expected.attackerWins, r: c.expected.rounds, hp: c.expected.winnerHpRemaining, strikes: c.expected.log.length }));