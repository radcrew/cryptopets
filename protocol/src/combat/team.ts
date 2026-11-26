import { applyBonus, type AttrBonus } from './equipment';
import { type Attrs, elementMod, extract, toUint16 } from './dna';
import { roundSeed, strikeRoll } from './rng';
import { MAX_ROUNDS } from './sim';
import {
    DEFAULT_SKILL_CONFIG,
    SKILL_BLOODLUST,
    SKILL_CUNNING,
    SKILL_FURY,
    SKILL_REBIRTH,
    SKILL_SAGE,
    SKILL_SHELL,
    SKILL_SWIFT,
    SKILL_TANK,
    type SkillConfig,
} from './skills';

/**
 * The three-on-three team engine (docs/battle-protocol.md §F, "Team battles").
 *
 * That section is the specification, and indexer-go's team.go implements it independently;
 * contracts/test-vectors/team.json holds the two together. The order of every step below is
 * part of the rules, so a change here is a change to that text and to the Go port, never one
 * of the three alone.
 *
 * With one fighter a side, the `int` turn order and no temperament, every team rule has
 * nothing to act on and this is `simulate` strike for strike. Both ports prove that by
 * replaying battle.json and equipment.json through it.
 */

export type Tactic = 'focus' | 'breaker' | 'hunter' | 'bodyguard';
export type Range = 'melee' | 'reach' | 'ranged';
export type Temperament = 'none' | 'brave' | 'clever' | 'wild' | 'steady' | 'loyal';
/** `int` is today's initiative; `speed` is the Attributes 2.0 order. */
export type TurnOrder = 'int' | 'speed';
export type Side = 0 | 1;

export const MAX_TEAM_SIZE = 3;

export interface TeamFighter {
    dna: bigint;
    rarity: number;
    level: number;
    skill: number;
    bonus: AttrBonus;
    /** Column in the fighter's own zone: 0 back, 1 mid, 2 front. */
    col: number;
    row: number;
    tactic: Tactic;
    range: Range;
    temperament: Temperament;
    /** Read only under the `speed` turn order. */
    speed: number;
}

export interface TeamConfig {
    turnOrder: TurnOrder;
    comboStepPct: number;
    exposePct: number;
    auraPct: number;
    tailwindBps: number;
    longShotPct: number;
    temperamentPct: number;
}

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
    turnOrder: 'int',
    comboStepPct: 10,
    exposePct: 120,
    auraPct: 110,
    tailwindBps: 200,
    longShotPct: 85,
    temperamentPct: 105,
};

export interface TeamStrikeLogEntry {
    round: number;
    /** The striker's side; the target and victim are always on the other one. */
    side: Side;
    actor: number;
    target: number;
    /** Differs from `target` only when a Tank guarded. */
    victim: number;
    isMagic: boolean;
    crit: boolean;
    damage: bigint;
    /** 85 | 100 | 115, after Sage's override. */
    elementMult: number;
    /** Earlier hits this round by the striker's side on the target. */
    combo: number;
    longShot: boolean;
    furyTriggered: boolean;
    temperament: boolean;
    exposed: boolean;
    guarded: boolean;
    secondChance: boolean;
    knockedOut: boolean;
    /** Lifelink healing; 0 otherwise. */
    heal: bigint;
    /** Slot on the striker's side that received `heal`, or null when nothing was healed. */
    healed: number | null;
    victimHpAfter: bigint;
}

export interface TeamResult {
    attackerWins: boolean;
    rounds: number;
    /** The winning side's total HP, capped at 65535. */
    winnerHpRemaining: number;
}

export interface TeamOutcome {
    result: TeamResult;
    log: TeamStrikeLogEntry[];
    /** Indexed by side, then slot. */
    startHp: [bigint[], bigint[]];
    finalHp: [bigint[], bigint[]];
}

const TACTICS: readonly Tactic[] = ['focus', 'breaker', 'hunter', 'bodyguard'];
const RANGES: readonly Range[] = ['melee', 'reach', 'ranged'];
const SUITED_TACTIC: Record<Temperament, Tactic | null> = {
    none: null,
    brave: 'focus',
    clever: 'breaker',
    wild: 'hunter',
    steady: 'bodyguard',
    loyal: null,
};

interface Unit {
    side: Side;
    slot: number;
    skill: number;
    tactic: Tactic;
    range: Range;
    temperament: Temperament;
    speed: number;
    st: Attrs;
    /** Board column: 0 is the attacker's back line, 5 the defender's. */
    x: number;
    row: number;
    hp: bigint;
    startHp: bigint;
    lastHitBy: Unit | null;
    guarded: boolean;
    secondChanceSpent: boolean;
    rallied: boolean;
    mark: Unit | null;
}

export function simulateTeam(
    attackers: readonly TeamFighter[],
    defenders: readonly TeamFighter[],
    seed: bigint,
    sc: SkillConfig = DEFAULT_SKILL_CONFIG,
    tc: TeamConfig = DEFAULT_TEAM_CONFIG,
): TeamOutcome {
    assertTeam(attackers, 'attackers', tc);
    assertTeam(defenders, 'defenders', tc);

    const units = [...attackers.map((f, i) => makeUnit(f, 0, i, sc)), ...defenders.map((f, i) => makeUnit(f, 1, i, sc))];
    const standing = (u: Unit) => u.hp > 0n;
    const alive = (side: Side) => units.some((u) => u.side === side && standing(u));
    const neighbours = (u: Unit) => units.filter((n) => standing(n) && isNeighbour(n, u));
    const log: TeamStrikeLogEntry[] = [];

    let r = 0;
    for (; r < MAX_ROUNDS && alive(0) && alive(1); r++) {
        const rs = roundSeed(seed, r);
        const order = units.filter(standing).sort((a, b) => compareTurn(a, b, tc.turnOrder));
        // Hits this round by each side on each enemy slot, for Combo.
        const hits = [new Array<number>(MAX_TEAM_SIZE).fill(0), new Array<number>(MAX_TEAM_SIZE).fill(0)];

        for (let p = 0; p < order.length; p++) {
            const u = order[p];
            if (!u || !standing(u)) continue;
            const enemySide: Side = u.side === 0 ? 1 : 0;
            if (!alive(enemySide)) break;

            // 1. Physical or magic.
            const isMagic = strikeRoll(rs, 2 * p) < (10000n * u.st.int) / (u.st.atk + u.st.int);

            // 2. Who it can reach.
            const enemies = units.filter((e) => e.side === enemySide && standing(e));
            const xs = enemies.map((e) => e.x);
            const line = u.side === 0 ? Math.min(...xs) : Math.max(...xs);
            const behind = u.side === 0 ? line + 1 : line - 1;
            const reachable = isMagic
                ? enemies
                : enemies.filter((e) => u.range === 'ranged' || e.x === line || (u.range === 'reach' && e.x === behind));

            // 3. The target.
            const t = pickTarget(u, reachable, units.filter((a) => a.side === u.side && standing(a)));

            // 4. Damage, each step floored.
            let def = t.st.def;
            let mdef = t.st.mdef;
            for (const n of neighbours(t)) {
                if (n.skill === SKILL_SHELL) def = (def * BigInt(tc.auraPct)) / 100n;
                if (n.skill === SKILL_SAGE) mdef = (mdef * BigInt(tc.auraPct)) / 100n;
            }
            let d = isMagic ? (u.st.int * 100n) / (100n + mdef) : (u.st.atk * 100n) / (100n + def);
            if (d === 0n) d = 1n;

            let elem = elementMod(u.st.element, t.st.element);
            if (u.skill === SKILL_SAGE && isMagic && elem < 100n) elem = 100n;
            d = (d * elem) / 100n;

            const longShot = !isMagic && u.range === 'ranged' && t.x !== line;
            if (longShot) d = (d * BigInt(tc.longShotPct)) / 100n;

            const lowHp = u.startHp > 0n && share(u) < BigInt(sc.furyHpThreshold);
            const furyTriggered = u.skill === SKILL_FURY && (lowHp || u.rallied);
            if (furyTriggered) d = (d * BigInt(sc.furyDmgMult)) / 100n;

            const temperament = SUITED_TACTIC[u.temperament] === u.tactic;
            if (temperament) d = (d * BigInt(tc.temperamentPct)) / 100n;

            const sideHits = hits[u.side] ?? [];
            const combo = sideHits[t.slot] ?? 0;
            if (combo > 0) d = (d * BigInt(100 + tc.comboStepPct * combo)) / 100n;

            const exposed = t.mark !== null && t.mark.side === u.side && t.mark !== u;
            if (exposed) {
                d = (d * BigInt(tc.exposePct)) / 100n;
                t.mark = null;
            }

            const swiftNeighbours = BigInt(neighbours(u).filter((n) => n.skill === SKILL_SWIFT).length);
            const critBase = 500n + (u.skill === SKILL_SWIFT ? BigInt(sc.swiftCritBonus) : 0n) + BigInt(tc.tailwindBps) * swiftNeighbours;
            const critCap = u.skill === SKILL_CUNNING ? BigInt(sc.cunningCritCap) : 3000n;
            const uncapped = critBase + 25n * u.st.int;
            const crit = strikeRoll(rs, 2 * p + 1) < (uncapped < critCap ? uncapped : critCap);
            if (crit) d = (d * 150n) / 100n;
            if (d === 0n) d = 1n;

            // 5. Bookkeeping.
            sideHits[t.slot] = combo + 1;
            if (crit && u.skill === SKILL_CUNNING) t.mark = u;

            // 6. Guard.
            let v = t;
            let guarded = false;
            if (t.hp <= d) {
                const tank = units.find(
                    (g) => g !== t && g.side === t.side && standing(g) && g.skill === SKILL_TANK && !g.guarded && isNeighbour(g, t),
                );
                if (tank) {
                    tank.guarded = true;
                    v = tank;
                    guarded = true;
                }
            }

            // 7. The hit lands.
            v.hp = v.hp > d ? v.hp - d : 0n;
            v.lastHitBy = u;

            // 8. Lifelink.
            let heal = 0n;
            let healed: Unit | null = null;
            if (u.skill === SKILL_BLOODLUST && !isMagic) {
                heal = (d * BigInt(sc.bloodlustBps)) / 10000n;
                if (heal > 0n) {
                    healed = lowestShare([u, ...neighbours(u)]);
                    const topped = healed.hp + heal;
                    healed.hp = topped > healed.startHp ? healed.startHp : topped;
                }
            }

            // 9. Second chance.
            let secondChance = false;
            if (v.hp === 0n) {
                const reborn = units.find((x) => x.side === v.side && x.skill === SKILL_REBIRTH && !x.secondChanceSpent);
                if (reborn) {
                    reborn.secondChanceSpent = true;
                    v.hp = 1n;
                    secondChance = true;
                }
            }

            // 10. Knockout, which rallies the victim's Fury teammates.
            const knockedOut = v.hp === 0n;
            if (knockedOut) {
                for (const x of units) if (x.side === v.side && x.skill === SKILL_FURY) x.rallied = true;
            }

            log.push({
                round: r, side: u.side, actor: u.slot, target: t.slot, victim: v.slot,
                isMagic, crit, damage: d, elementMult: Number(elem), combo,
                longShot, furyTriggered, temperament, exposed, guarded, secondChance, knockedOut,
                heal, healed: healed ? healed.slot : null, victimHpAfter: v.hp,
            });
        }
    }

    let attackerWins: boolean;
    if (alive(0) && !alive(1)) {
        attackerWins = true;
    } else if (alive(1) && !alive(0)) {
        attackerWins = false;
    } else {
        attackerWins = sideShare(units, 0) > sideShare(units, 1); // exact tie -> defender
    }
    const winnerHp = units.filter((u) => u.side === (attackerWins ? 0 : 1)).reduce((sum, u) => sum + u.hp, 0n);

    return {
        result: { attackerWins, rounds: r, winnerHpRemaining: Number(winnerHp > 0xffffn ? 0xffffn : winnerHp) },
        log,
        startHp: [bySide(units, 0, (u) => u.startHp), bySide(units, 1, (u) => u.startHp)],
        finalHp: [bySide(units, 0, (u) => u.hp), bySide(units, 1, (u) => u.hp)],
    };
}

function makeUnit(f: TeamFighter, side: Side, slot: number, sc: SkillConfig): Unit {
    // Identical to a duel's stats: extract, then gear, then the skill multipliers.
    const st = extract(f.dna, f.rarity, f.level);
    applyBonus(st, f.bonus);
    if (f.skill === SKILL_TANK) st.hp = toUint16((st.hp * BigInt(sc.tankHpMult)) / 100n);
    if (f.skill === SKILL_SHELL) st.def = toUint16((st.def * BigInt(sc.shellDefMult)) / 100n);
    if (f.skill === SKILL_SAGE) st.mdef = toUint16((st.mdef * BigInt(sc.sageMdefMult)) / 100n);
    return {
        side, slot, skill: f.skill, tactic: f.tactic, range: f.range, temperament: f.temperament, speed: f.speed,
        st, x: side === 0 ? f.col : 5 - f.col, row: f.row, hp: st.hp, startHp: st.hp,
        lastHitBy: null, guarded: false, secondChanceSpent: false, rallied: false, mark: null,
    };
}

function compareTurn(a: Unit, b: Unit, order: TurnOrder): number {
    if (order === 'speed' && a.speed !== b.speed) return b.speed - a.speed;
    const shellA = a.skill === SKILL_SHELL ? 1 : 0;
    const shellB = b.skill === SKILL_SHELL ? 1 : 0;
    if (shellA !== shellB) return shellA - shellB;
    if (a.st.int !== b.st.int) return a.st.int > b.st.int ? -1 : 1;
    const swiftA = a.skill === SKILL_SWIFT ? 0 : 1;
    const swiftB = b.skill === SKILL_SWIFT ? 0 : 1;
    if (swiftA !== swiftB) return swiftA - swiftB;
    if (a.side !== b.side) return a.side - b.side;
    return a.slot - b.slot;
}

function pickTarget(u: Unit, reachable: Unit[], ownSide: Unit[]): Unit {
    switch (u.tactic) {
        case 'breaker':
            return reachable.reduce((best, e) => (e.st.int > best.st.int ? e : best));
        case 'hunter': {
            const prey = reachable.filter((e) => elementMod(u.st.element, e.st.element) === 115n);
            return lowestShare(prey.length > 0 ? prey : reachable);
        }
        case 'bodyguard': {
            const hitter = lowestShare(ownSide).lastHitBy;
            return hitter && reachable.includes(hitter) ? hitter : lowestShare(reachable);
        }
        case 'focus':
            return lowestShare(reachable);
    }
}

/** The lowest `share`, keeping the earlier entry on a tie. Callers pass slot order, or the
 *  striker first and then slot order for Lifelink. */
function lowestShare(list: Unit[]): Unit {
    return list.reduce((best, u) => (share(u) < share(best) ? u : best));
}

function share(u: Unit): bigint {
    return (u.hp * 10000n) / u.startHp;
}

function isNeighbour(a: Unit, b: Unit): boolean {
    return a !== b && a.side === b.side && Math.abs(a.x - b.x) + Math.abs(a.row - b.row) === 1;
}

function sideShare(units: Unit[], side: Side): bigint {
    const own = units.filter((u) => u.side === side);
    const hp = own.reduce((sum, u) => sum + u.hp, 0n);
    const start = own.reduce((sum, u) => sum + u.startHp, 0n);
    return (hp * 10000n) / start;
}

function bySide(units: Unit[], side: Side, pick: (u: Unit) => bigint): bigint[] {
    return units.filter((u) => u.side === side).map(pick);
}

function assertTeam(team: readonly TeamFighter[], label: string, tc: TeamConfig): void {
    if (team.length < 1 || team.length > MAX_TEAM_SIZE) {
        throw new Error(`${label}: a side has 1 to ${MAX_TEAM_SIZE} fighters, got ${team.length}`);
    }
    const tiles = new Set<number>();
    team.forEach((f, i) => {
        const where = `${label}[${i}]`;
        if (!isTileIndex(f.col) || !isTileIndex(f.row)) {
            throw new Error(`${where}: col and row must be 0, 1 or 2, got ${f.col}, ${f.row}`);
        }
        if (tiles.has(f.col * 3 + f.row)) throw new Error(`${where}: two fighters share tile ${f.col},${f.row}`);
        tiles.add(f.col * 3 + f.row);
        if (!TACTICS.includes(f.tactic)) throw new Error(`${where}: unknown tactic ${String(f.tactic)}`);
        if (!RANGES.includes(f.range)) throw new Error(`${where}: unknown range ${String(f.range)}`);
        if (!Object.hasOwn(SUITED_TACTIC, f.temperament)) throw new Error(`${where}: unknown temperament ${String(f.temperament)}`);
        if (tc.turnOrder === 'speed' && (!Number.isSafeInteger(f.speed) || f.speed < 0 || f.speed > 0xffff)) {
            throw new Error(`${where}: speed must be an integer from 0 to 65535, got ${f.speed}`);
        }
    });
}

function isTileIndex(n: number): boolean {
    return n === 0 || n === 1 || n === 2;
}
