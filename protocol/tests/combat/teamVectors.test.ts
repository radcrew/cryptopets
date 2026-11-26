import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
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
