import clsx from 'clsx';
import React from 'react';

import PetArt from '@components/pet/pet-art';
import { extract, getPetSkill, getRarityColor, getRarityName, type Tactic } from '@shared/core';

import type { ArtPet } from './art';
import { TACTIC_OPTIONS } from './tactics';
import { positionLabel } from './team-board';
import styles from './index.module.css';

export interface DetailsPet {
    art: ArtPet;
    name: string;
    level: number;
    rarity: number;
    dna: bigint;
    speciesId?: number;
    readyAt: number;
}

/** The pet selected on a board, with where it stands and how it fights. */
export interface PetSelection {
    petId: string;
    side: 0 | 1;
    pet: DetailsPet;
    col: number;
    row: number;
    tactic: Tactic;
    /** Short facts shown as chips beside its position, such as its turn order. */
    facts?: string[];
}

export interface TeamPetDetailsProps {
    /** Null shows a prompt to select a pet. */
    selection: PetSelection | null;
    /** Omit for a rival's pet: its tactic is part of the plan its owner signed. */
    onTacticChange?: (tactic: Tactic) => void;
}

const STATS = [
    ['hp', 'HP'],
    ['atk', 'ATK'],
    ['def', 'DEF'],
    ['int', 'INT'],
    ['mdef', 'MDEF'],
] as const;

/**
 * The details of the pet selected on a board: the pet's art down the full height on the left,
 * and who it is, where it stands, its skill, its base stats and its tactic on the right.
 *
 * Exactly as tall as the zone beside it: the body is taken out of the flow, so its content
 * can never make the row taller than the board, and it is kept short enough to fit. Stats
 * come from the combat engine's own `extract`, so they are the numbers a fight starts from,
 * before gear and the skill's multipliers.
 */
const TeamPetDetails: React.FC<TeamPetDetailsProps> = ({ selection, onTacticChange }) => {
    if (!selection) {
        return (
            <aside className={styles.details} aria-label="Pet details">
                <div className={styles.detailsBody}>
                    <p className={clsx(styles.muted, styles.detailsEmpty)}>Select a pet on the board to see its details and tactic.</p>
                </div>
            </aside>
        );
    }

    const { pet, side, col, row, tactic, facts = [] } = selection;
    const stats = extract(pet.dna, pet.rarity, pet.level);
    const skill = getPetSkill(pet.speciesId);
    const resting = pet.readyAt > Math.floor(Date.now() / 1000);
    const position = positionLabel(col, row);
    const chips = [position.charAt(0).toUpperCase() + position.slice(1), ...facts, ...(resting ? ['Resting'] : [])];
    const tacticLabel = TACTIC_OPTIONS.find((t) => t.id === tactic)?.label ?? tactic;

    return (
        <aside className={styles.details} aria-label="Pet details">
            <div className={styles.detailsBody}>
                <div className={styles.detailsArt} aria-hidden>
                    <PetArt pet={pet.art} fill emojiClassName={styles.detailsEmoji} />
                </div>

                <div className={styles.detailsInfo}>
                    <div>
                        <div className={styles.detailsName}>{pet.name}</div>
                        <div className={styles.detailsMeta}>
                            <span style={{ color: getRarityColor(pet.rarity) }}>{getRarityName(pet.rarity)}</span> · Lv {pet.level} ·{' '}
                            {side === 0 ? 'Your pet' : 'Rival pet'}
                        </div>
                    </div>

                    <ul className={styles.chips} aria-label="Placement">
                        {chips.map((chip) => (
                            <li key={chip} className={styles.chip}>
                                {chip}
                            </li>
                        ))}
                    </ul>

                    {skill && (
                        <p className={styles.detailsSkill} title={skill.description}>
                            <strong>{skill.name}</strong> · {skill.description}
                        </p>
                    )}

                    <div className={styles.stats} role="list" aria-label="Base stats" title="Base stats at this level, before gear and skill">
                        {STATS.map(([key, label]) => (
                            <div key={key} className={styles.stat} role="listitem">
                                <strong>{Number(stats[key])}</strong>
                                {label}
                            </div>
                        ))}
                    </div>

                    {onTacticChange ? (
                        <label className={styles.tacticRow}>
                            <span className={styles.fieldLabel}>Tactic</span>
                            <select className={styles.select} value={tactic} onChange={(e) => onTacticChange(e.target.value as Tactic)}>
                                {TACTIC_OPTIONS.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <div className={styles.tacticRow}>
                            <span className={styles.fieldLabel}>Tactic</span>
                            <span>{tacticLabel}</span>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
};

export default TeamPetDetails;
