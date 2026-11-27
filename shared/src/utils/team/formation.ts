import {
    type AttrBonus,
    DEFAULT_TEAM_CONFIG,
    SKILL_BLOODLUST,
    SKILL_SAGE,
    SKILL_SHELL,
    SKILL_SWIFT,
    SKILL_TANK,
} from '@cryptopets/protocol';

import { previewSquadTurnOrder } from './teamPlayback';

/**
 * A formation check for one team, platform-neutral: how three placed pets work together, read
 * from the same rules the team engine applies (docs/battle-protocol.md §F, "Team battles").
 *
 * Only what placement decides is reported, since that is what a player is arranging: who holds
 * the front line, and which neighbour rules (Guard, the Shell and Sage auras, Tailwind,
 * Lifelink) reach a teammate. Pets are neighbours when their tiles touch along a side, as in the
 * engine; a diagonal does not count. Bonus sizes come from the engine's default team config, so
 * the text cannot drift from the numbers a fight uses.
 */
export interface FormationPet {
    name: string;
    /** Own-zone column (0 back, 1 mid, 2 front) and row. */
    col: number;
    row: number;
    /** Skill index, as the engine numbers it (speciesId % 8). */
    skill: number;
    dna: bigint;
    rarity: number;
    level: number;
    equipment?: readonly AttrBonus[];
}

export type FormationNoteKind = 'good' | 'warning' | 'info';

export interface FormationNote {
    kind: FormationNoteKind;
    text: string;
}

export interface FormationReport {
    /** Indices into the given pets, in the order they act among themselves. */
    turnOrder: number[];
    /** Indices of the pets in the front-most occupied column, the only ones Melee strikes reach. */
    frontLine: number[];
    notes: FormationNote[];
}

const AURA_PCT = DEFAULT_TEAM_CONFIG.auraPct - 100;
const TAILWIND_PCT = DEFAULT_TEAM_CONFIG.tailwindBps / 100;

export function analyzeFormation(pets: readonly FormationPet[]): FormationReport {
    if (pets.length === 0) return { turnOrder: [], frontLine: [], notes: [] };

    const frontCol = Math.max(...pets.map((p) => p.col));
    const frontLine = pets.flatMap((p, i) => (p.col === frontCol ? [i] : []));
    const neighboursOf = (i: number) =>
        pets.filter((p, j) => j !== i && Math.abs(p.col - pets[i]!.col) + Math.abs(p.row - pets[i]!.row) === 1);
    const notes: FormationNote[] = [];

    const front = frontLine.map((i) => pets[i]!);
    if (front.length === 1) {
        const holder = front[0]!;
        const sturdy = holder.skill === SKILL_TANK || holder.skill === SKILL_SHELL;
        notes.push(
            sturdy
                ? { kind: 'good', text: `${holder.name} holds the front line alone, and is built to take the hits.` }
                : { kind: 'warning', text: `${holder.name} holds the front line alone, so every Melee strike lands on it until it falls.` },
        );
    } else {
        notes.push({ kind: 'info', text: `${listNames(front.map((p) => p.name))} share the front line, so Melee strikes are spread between them.` });
    }

    pets.forEach((pet, i) => {
        const near = listNames(neighboursOf(i).map((p) => p.name));
        switch (pet.skill) {
            case SKILL_TANK:
                notes.push(
                    near
                        ? { kind: 'good', text: `${pet.name} can guard ${near} from one knockout blow per battle.` }
                        : { kind: 'warning', text: `${pet.name} is a Tank with no neighbour to guard.` },
                );
                break;
            case SKILL_SHELL:
                notes.push(
                    near
                        ? { kind: 'good', text: `${pet.name}'s Shell aura gives ${near} ${AURA_PCT}% more DEF.` }
                        : { kind: 'warning', text: `${pet.name}'s Shell aura reaches no teammate.` },
                );
                break;
            case SKILL_SAGE:
                notes.push(
                    near
                        ? { kind: 'good', text: `${pet.name}'s Sage aura gives ${near} ${AURA_PCT}% more MDEF.` }
                        : { kind: 'warning', text: `${pet.name}'s Sage aura reaches no teammate.` },
                );
                break;
            case SKILL_SWIFT:
                notes.push(
                    near
                        ? { kind: 'good', text: `${pet.name}'s Tailwind gives ${near} ${TAILWIND_PCT}% more crit chance.` }
                        : { kind: 'warning', text: `${pet.name}'s Tailwind reaches no teammate.` },
                );
                break;
            case SKILL_BLOODLUST:
                notes.push(
                    near
                        ? { kind: 'good', text: `${pet.name}'s Lifelink can heal ${near} as well as itself.` }
                        : { kind: 'info', text: `${pet.name}'s Lifelink can only heal itself, with no neighbour.` },
                );
                break;
            default:
                break;
        }
    });

    return { turnOrder: previewSquadTurnOrder(pets), frontLine, notes };
}

/** "A", "A and B", "A, B and C". Empty for no names. */
function listNames(names: readonly string[]): string {
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
