import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    drawDefenders,
    NO_BONUS,
    simulateTeam,
    type SkillConfig,
    type TeamConfig,
    type TeamFighter,
    type TeamStrikeLogEntry,
} from '../../src/combat';

/**
 * Holds the canonical engine to contracts/test-vectors/team.json, which indexer-go's
 * team_golden_test.go reads too. A failure here means this port drifted from the
 * specification in docs/battle-protocol.md §F; fix the port, never the vector.
 */
type FighterJson = Omit<TeamFighter, 'dna'> & { dna: string };

interface TeamVectorFile {
    skillConfig: SkillConfig;
    logColumns: string[];
    cases: {
        name: string;
        seed: string;
        teamConfig: TeamConfig;
        attackers: FighterJson[];
        defenders: FighterJson[];
        expected: {
            attackerWins: boolean;
            rounds: number;
            winnerHpRemaining: number;
            startHp: number[][];
            finalHp: number[][];
            log: number[][];
        };
    }[];
    draws: { name: string; ranks: number[]; seed: string; expected: number[] }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
    readFileSync(join(here, '../../../contracts/test-vectors/team.json'), 'utf8'),
) as TeamVectorFile;

const toFighter = (f: FighterJson): TeamFighter => ({ ...f, dna: BigInt(f.dna) });
const b = (v: boolean) => (v ? 1 : 0);
const row = (s: TeamStrikeLogEntry) => [
    s.round, s.side, s.actor, s.target, s.victim, b(s.isMagic), b(s.crit), Number(s.damage), s.elementMult, s.combo,
    b(s.longShot), b(s.furyTriggered), b(s.temperament), b(s.exposed), b(s.guarded), b(s.secondChance), b(s.knockedOut),
    Number(s.heal), s.healed ?? -1, Number(s.victimHpAfter),
];

describe('team battle golden vectors', () => {
    it('lists the log columns this test writes', () => {
        expect(vectors.logColumns).toHaveLength(20);
        expect(vectors.cases.length).toBeGreaterThan(0);
    });

    for (const c of vectors.cases) {
        it(c.name, () => {
            const o = simulateTeam(
                c.attackers.map(toFighter),
                c.defenders.map(toFighter),
                BigInt(c.seed),
                vectors.skillConfig,
                c.teamConfig,
            );
            expect(o.result).toEqual({
                attackerWins: c.expected.attackerWins,
                rounds: c.expected.rounds,
                winnerHpRemaining: c.expected.winnerHpRemaining,
            });
            expect(o.startHp.map((side) => side.map(Number))).toEqual(c.expected.startHp);
            expect(o.finalHp.map((side) => side.map(Number))).toEqual(c.expected.finalHp);
            expect(o.log.map(row)).toEqual(c.expected.log);
        });
    }

    for (const d of vectors.draws) {
        it(`draw: ${d.name}`, () => {
            expect(drawDefenders(d.ranks, BigInt(d.seed))).toEqual(d.expected);
        });
    }
});

describe('the draw', () => {
    // The chance each rank defends, from the weights alone: every ordered way to draw three
    // of five without replacement, each weighted by its probability. This is the table in
    // docs/plan-team-battles-3v3.md, so a change to the weights cannot go unnoticed.
    it('gives each rank the published chance of defending', () => {
        const weights = [5, 4, 3, 2, 1];
        const chance = [0, 0, 0, 0, 0];
        const walk = (left: number[], picked: number[], p: number) => {
            if (picked.length === 3) {
                for (const i of picked) chance[i] = (chance[i] ?? 0) + p;
                return;
            }
            const total = left.reduce((sum, i) => sum + (weights[i] ?? 0), 0);
            for (const i of left) walk(left.filter((j) => j !== i), [...picked, i], (p * (weights[i] ?? 0)) / total);
        };
        walk([0, 1, 2, 3, 4], [], 1);
        expect(chance.map((c) => Math.round(c * 1000) / 10)).toEqual([82.6, 75.9, 65.6, 49, 26.8]);
    });

    it('returns three distinct roster indices in roster order', () => {
        for (let seed = 0n; seed < 200n; seed++) {
            const drawn = drawDefenders([2, 5, 1, 4, 3], seed);
            expect(drawn).toHaveLength(3);
            expect(new Set(drawn).size).toBe(3);
            expect([...drawn].sort((x, y) => x - y)).toEqual(drawn);
        }
    });

    it('refuses a roster that is not ranks 1 to 5 once each', () => {
        expect(() => drawDefenders([1, 2, 3, 4], 1n)).toThrow();
        expect(() => drawDefenders([1, 1, 3, 4, 5], 1n)).toThrow();
        expect(() => drawDefenders([0, 2, 3, 4, 5], 1n)).toThrow();
    });
});

describe('team input validation', () => {
    const one = (patch: Partial<TeamFighter> = {}): TeamFighter => ({
        dna: 1234567890123456n, rarity: 1, level: 20, skill: 99, bonus: NO_BONUS,
        col: 2, row: 1, tactic: 'focus', range: 'melee', temperament: 'none', speed: 0, ...patch,
    });

    it('needs one to three fighters a side', () => {
        expect(() => simulateTeam([], [one()], 1n)).toThrow();
        expect(() => simulateTeam([one({ row: 0 }), one({ row: 1 }), one({ row: 2 }), one({ col: 1 })], [one()], 1n)).toThrow();
    });

    it('refuses two fighters on one tile, and tiles off the zone', () => {
        expect(() => simulateTeam([one(), one()], [one()], 1n)).toThrow(/share tile/);
        expect(() => simulateTeam([one({ col: 3 })], [one()], 1n)).toThrow();
    });

    it('refuses unknown tactics, ranges and temperaments', () => {
        expect(() => simulateTeam([one({ tactic: 'charge' as never })], [one()], 1n)).toThrow();
        expect(() => simulateTeam([one({ range: 'far' as never })], [one()], 1n)).toThrow();
        expect(() => simulateTeam([one({ temperament: 'constructor' as never })], [one()], 1n)).toThrow();
    });
});
