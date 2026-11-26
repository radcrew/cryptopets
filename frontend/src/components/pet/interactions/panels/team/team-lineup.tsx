import clsx from 'clsx';
import React from 'react';

import PetArt from '@components/pet/pet-art';
import { extract, getPetSkill, type Tactic } from '@shared/core';

import type { ArtPet } from './art';
import { TACTIC_OPTIONS, tacticShort } from './tactics';
import styles from './index.module.css';

export const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'] as const;

export interface LineupPet {
    petId: string;
    art: ArtPet;
    name: string;
    level: number;
    rarity: number;
    dna: bigint;
    speciesId?: number;
    tactic: Tactic;
    /** Place in the battle's expected opening turn order, from 0. */
    order?: number;
}

export interface TeamLineupProps {
    pets: LineupPet[];
    label: string;
    /** Rows drawn in all, so a squad still being built shows the slots it has left. */
    slots: number;
    selectedPetId?: string | null;
    /** Selecting a pet, so it can then be moved on the zone. Omit for a side nobody arranges. */
    onSelect?: (petId: string) => void;
    /** Setting a pet's tactic. Omit to show the tactic read-only, as a rival's signed one is. */
    onTacticChange?: (petId: string, tactic: Tactic) => void;
    /** Draws the unfilled rows as unknown pets, for a defender the attacker may not see yet. */
    concealed?: boolean;
}

/**
 * One side's three pets as rows beside its zone: who each is, its skill and stats, when it acts
 * and how it picks targets. The zone shows where they stand; this says what they are. Stats are
 * the combat engine's own `extract` at the pet's level, before gear and skill.
 */
const TeamLineup: React.FC<TeamLineupProps> = ({
    pets,
    label,
    slots,
    selectedPetId,
    onSelect,
    onTacticChange,
    concealed = false,
}) => (
    <ol className={styles.lineup} aria-label={label}>
        {pets.map((pet) => {
            const stats = extract(pet.dna, pet.rarity, pet.level);
            const skill = getPetSkill(pet.speciesId);
            const selected = pet.petId === selectedPetId;
            const who = (
                <>
                    <span className={styles.lineupArt} aria-hidden>
                        <PetArt pet={pet.art} />
                    </span>
                    <span className={styles.lineupText}>
                        <span className={styles.lineupName}>{pet.name}</span>
                        <span className={styles.lineupMeta}>
                            Lv {pet.level}
                            {skill ? ` · ${skill.name}` : ''}
                        </span>
                    </span>
                </>
            );
            return (
                <li
                    key={pet.petId}
                    className={clsx(styles.lineupRow, selected && styles.lineupSelected)}
                >
                    {onSelect ? (
                        <button
                            type="button"
                            className={styles.lineupWho}
                            aria-pressed={selected}
                            aria-label={`Select ${pet.name}`}
                            onClick={() => onSelect(pet.petId)}
                        >
                            {who}
                        </button>
                    ) : (
                        <span className={styles.lineupWho}>{who}</span>
                    )}
                    {pet.order !== undefined && (
                        <span
                            className={styles.lineupOrder}
                            title="Expected place in the turn order"
                        >
                            {ORDINALS[pet.order] ?? pet.order + 1}
                        </span>
                    )}
                    {onTacticChange ? (
                        <select
                            className={clsx(styles.select, styles.lineupTactic)}
                            aria-label={`Tactic for ${pet.name}`}
                            value={pet.tactic}
                            onChange={(e) => onTacticChange(pet.petId, e.target.value as Tactic)}
                        >
                            {TACTIC_OPTIONS.map((t) => (
                                <option key={t.id} value={t.id} title={t.label}>
                                    {t.short}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <span
                            className={styles.lineupTacticChip}
                            title={TACTIC_OPTIONS.find((t) => t.id === pet.tactic)?.label}
                        >
                            {tacticShort(pet.tactic)}
                        </span>
                    )}
                    <span className={styles.lineupStats} aria-label={`${pet.name} stats`}>
                        <span>HP {Number(stats.hp)}</span>
                        <span>ATK {Number(stats.atk)}</span>
                        <span>DEF {Number(stats.def)}</span>
                        <span>INT {Number(stats.int)}</span>
                        <span>MDEF {Number(stats.mdef)}</span>
                    </span>
                </li>
            );
        })}
        {Array.from({ length: Math.max(0, slots - pets.length) }, (_, i) => (
            <li key={`empty-${i}`} className={clsx(styles.lineupRow, styles.lineupEmpty, concealed && styles.lineupConcealed)}>
                {concealed ? (
                    <>
                        <span className={styles.lineupUnknown} aria-hidden>
                            ?
                        </span>
                        Hidden until the battle
                    </>
                ) : (
                    'Empty slot'
                )}
            </li>
        ))}
    </ol>
);

export default TeamLineup;
