import {
    type AttrBonus,
    applyBonus,
    bonusFromEquipment,
    extract,
    hashTeamCombatLog,
    SKILL_SHELL,
    SKILL_SWIFT,
    type Tactic,
    type TeamBattleReceipt,
    type TeamOutcome,
} from '@cryptopets/protocol';

/** Re-exported so screens can name a tactic without depending on the protocol package. */
export type { Tactic } from '@cryptopets/protocol';

/**
 * Team battle playback, platform-neutral (docs/plan-team-battles-3v3.md, Phase 5).
 *
 * Turns a signed team receipt and its served combat log into what a screen draws: the six
 * fighters on the 6×3 board, and one frame per strike with every fighter's HP after it. Web and
 * mobile both render from this, so neither re-derives a fight rule on its own.
 *
 * Nothing here simulates. The frames are read off the log the backend computed and signed, and
 * `buildTeamPlayback` refuses a log that does not hash to the receipt's `combatLogHash`, so what
 * is played back is the fight that was signed rather than a story that merely ends the same way.
 */

/** One fighter as the board shows it. `side` 0 attacks; `slot` is its index on that side. */
export interface TeamFighterView {
    side: 0 | 1;
    slot: number;
    petId: string;
    owner: string;
    dna: string;
    level: number;
    rarity: number;
    skill: number;
    tactic: Tactic;
    /** Own-zone column (0 back, 2 front) and row, as placed. */
    col: number;
    row: number;
    /** Board column, 0 (attacker back) to 5 (defender back). */
    x: number;
    startHp: number;
}

/** One strike, with the log's 64-bit values as plain numbers (HP and damage fit easily). */
export interface TeamStrikeView {
    round: number;
    side: 0 | 1;
    actor: number;
    target: number;
    victim: number;
    isMagic: boolean;
    crit: boolean;
    damage: number;
    elementMult: number;
    combo: number;
    longShot: boolean;
    furyTriggered: boolean;
    temperament: boolean;
    exposed: boolean;
    guarded: boolean;
    secondChance: boolean;
    knockedOut: boolean;
    heal: number;
    healed: number | null;
    victimHpAfter: number;
}

export interface TeamPlaybackFrame {
    strike: TeamStrikeView;
    /** Every fighter's HP after this strike, by side then slot. */
    hp: [number[], number[]];
}

export interface TeamPlayback {
    fighters: [TeamFighterView[], TeamFighterView[]];
    frames: TeamPlaybackFrame[];
}

/** The combat log as `GET /api/battle/:id/combat-log` serves a team battle's: bigints as strings. */
export interface TeamCombatLogWire {
    startHp: (string | number)[][];
    log: Record<string, unknown>[];
}

/** Thrown when the served log is not the one the receipt signed. */
export class CombatLogMismatchError extends Error {}

export function buildTeamPlayback(receipt: TeamBattleReceipt, combatLog: TeamCombatLogWire): TeamPlayback {
    const startHp: [bigint[], bigint[]] = [
        (combatLog.startHp[0] ?? []).map((hp) => BigInt(hp)),
        (combatLog.startHp[1] ?? []).map((hp) => BigInt(hp)),
    ];
    const strikes = combatLog.log.map(toStrike);
    const outcome: TeamOutcome = {
        result: { attackerWins: receipt.result.attackerWon, rounds: receipt.result.rounds, winnerHpRemaining: receipt.result.winnerHpRemaining },
        startHp,
        finalHp: [[], []],
        log: strikes.map((s) => ({ ...s, damage: BigInt(s.damage), heal: BigInt(s.heal), victimHpAfter: BigInt(s.victimHpAfter) })),
    };
    const hash = hashTeamCombatLog(outcome);
    if (hash.toLowerCase() !== receipt.combatLogHash.toLowerCase()) {
        throw new CombatLogMismatchError(`combat log hashes to ${hash}, but the receipt signed ${receipt.combatLogHash}`);
    }

    const attackers = receipt.snapshot.attackers.map((m, slot) => fighterView(0, slot, m, Number(startHp[0][slot] ?? 0n)));
    const defenders = receipt.snapshot.roster.map((m, slot) => fighterView(1, slot, m, Number(startHp[1][slot] ?? 0n)));

    const hp: [number[], number[]] = [attackers.map((f) => f.startHp), defenders.map((f) => f.startHp)];
    const frames = strikes.map((strike) => {
        const enemy = strike.side === 0 ? 1 : 0;
        hp[enemy][strike.victim] = strike.victimHpAfter;
        if (strike.healed !== null) {
            const own = strike.side;
            const start = (own === 0 ? attackers : defenders)[strike.healed]?.startHp ?? 0;
            hp[own][strike.healed] = Math.min(start, (hp[own][strike.healed] ?? 0) + strike.heal);
        }
        return { strike, hp: [[...hp[0]], [...hp[1]]] as [number[], number[]] };
    });
    return { fighters: [attackers, defenders], frames };
}

export interface TeamBattleSummary {
    attackerWon: boolean;
    rounds: number;
    /** Damage dealt, by side then slot. */
    damage: [number[], number[]];
    /** Knockouts landed, by side then slot. */
    knockouts: [number[], number[]];
    /** The fighter who dealt the most damage on the winning side, or null with no strikes. */
    mvp: { side: 0 | 1; slot: number } | null;
}

export function summarizeTeamBattle(playback: TeamPlayback, attackerWon: boolean): TeamBattleSummary {
    const damage: [number[], number[]] = [playback.fighters[0].map(() => 0), playback.fighters[1].map(() => 0)];
    const knockouts: [number[], number[]] = [playback.fighters[0].map(() => 0), playback.fighters[1].map(() => 0)];
    for (const { strike } of playback.frames) {
        damage[strike.side][strike.actor] = (damage[strike.side][strike.actor] ?? 0) + strike.damage;
        if (strike.knockedOut) knockouts[strike.side][strike.actor] = (knockouts[strike.side][strike.actor] ?? 0) + 1;
    }
    const winner: 0 | 1 = attackerWon ? 0 : 1;
    let mvp: TeamBattleSummary['mvp'] = null;
    damage[winner].forEach((dealt, slot) => {
        if (dealt > 0 && (mvp === null || dealt > (damage[winner][mvp.slot] ?? 0))) mvp = { side: winner, slot };
    });
    const rounds = playback.frames.length > 0 ? (playback.frames[playback.frames.length - 1]?.strike.round ?? 0) + 1 : 0;
    return { attackerWon, rounds, damage, knockouts, mvp };
}

/**
 * One line for a strike, naming who hit whom and every rule that fired. `name` maps a fighter
 * to its display name; the default uses the pet id.
 */
export function describeStrike(strike: TeamStrikeView, name: (side: 0 | 1, slot: number) => string = (s, i) => `${s === 0 ? 'Attacker' : 'Defender'} ${i + 1}`): string {
    const enemy: 0 | 1 = strike.side === 0 ? 1 : 0;
    const actor = name(strike.side, strike.actor);
    const target = name(enemy, strike.target);
    const tags = [
        strike.isMagic ? 'magic' : null,
        strike.crit ? 'critical' : null,
        strike.combo > 0 ? `combo ×${strike.combo + 1}` : null,
        strike.exposed ? 'exposed' : null,
        strike.longShot ? 'long shot' : null,
        strike.furyTriggered ? 'fury' : null,
        strike.temperament ? 'in its element' : null,
    ].filter(Boolean);
    let line = `${actor} hits ${target} for ${strike.damage}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}.`;
    if (strike.guarded) line += ` ${name(enemy, strike.victim)} takes the hit for ${target}.`;
    if (strike.secondChance) line += ` ${name(enemy, strike.victim)} survives on 1 HP.`;
    if (strike.knockedOut) line += ` ${name(enemy, strike.victim)} is knocked out.`;
    if (strike.healed !== null && strike.heal > 0) line += ` ${name(strike.side, strike.healed)} heals ${strike.heal}.`;
    return line;
}

/** A pet as the squad builder knows it, before any battle exists. */
export interface SquadPreviewPet {
    dna: bigint;
    rarity: number;
    level: number;
    skill: number;
    equipment?: readonly AttrBonus[];
}

/**
 * The order a squad acts in among itself, by today's team rules: pets without Shell before
 * Shell pets, then higher INT, then Swift, then the lower slot. Returns slot indices. It
 * orders one squad, which is the part of the order the attacker controls.
 */
export function previewSquadTurnOrder(pets: readonly SquadPreviewPet[]): number[] {
    const ints = pets.map((pet) => {
        const attrs = extract(pet.dna, pet.rarity, pet.level);
        applyBonus(attrs, bonusFromEquipment(pet.equipment));
        return attrs.int;
    });
    return pets
        .map((_pet, slot) => slot)
        .sort((a, b) => {
            const pa = pets[a]!;
            const pb = pets[b]!;
            const shell = Number(pa.skill === SKILL_SHELL) - Number(pb.skill === SKILL_SHELL);
            if (shell !== 0) return shell;
            const ia = ints[a]!;
            const ib = ints[b]!;
            if (ia !== ib) return ia > ib ? -1 : 1;
            const swift = Number(pb.skill === SKILL_SWIFT) - Number(pa.skill === SKILL_SWIFT);
            if (swift !== 0) return swift;
            return a - b;
        });
}

function fighterView(
    side: 0 | 1,
    slot: number,
    member: TeamBattleReceipt['snapshot']['attackers'][number],
    startHp: number,
): TeamFighterView {
    const { pet } = member;
    return {
        side,
        slot,
        petId: pet.petId.toString(),
        owner: pet.owner,
        dna: pet.dna.toString(),
        level: pet.level,
        rarity: pet.rarity,
        skill: pet.skill,
        tactic: member.tactic,
        col: member.col,
        row: member.row,
        x: side === 0 ? member.col : 5 - member.col,
        startHp,
    };
}

function toStrike(raw: Record<string, unknown>): TeamStrikeView {
    const n = (key: string) => Number(raw[key] ?? 0);
    const b = (key: string) => Boolean(raw[key]);
    const healed = raw.healed;
    return {
        round: n('round'),
        side: n('side') === 0 ? 0 : 1,
        actor: n('actor'),
        target: n('target'),
        victim: n('victim'),
        isMagic: b('isMagic'),
        crit: b('crit'),
        damage: n('damage'),
        elementMult: n('elementMult'),
        combo: n('combo'),
        longShot: b('longShot'),
        furyTriggered: b('furyTriggered'),
        temperament: b('temperament'),
        exposed: b('exposed'),
        guarded: b('guarded'),
        secondChance: b('secondChance'),
        knockedOut: b('knockedOut'),
        heal: n('heal'),
        healed: healed === null || healed === undefined || Number(healed) < 0 ? null : Number(healed),
        victimHpAfter: n('victimHpAfter'),
    };
}
