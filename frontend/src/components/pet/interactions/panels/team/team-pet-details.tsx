import clsx from 'clsx';
import React from 'react';

import PetArt from '@components/pet/pet-art';
import { extract, getPetSkill, getRarityColor, getRarityName, type Tactic } from '@shared/core';

import type { ArtPet } from './art';
import { TACTIC_OPTIONS } from './tactics';
import { positionLabel } from './team-board';
import styles from './index.module.css';

/**
 * How often each rank defends, in percent: the exact odds of `drawDefenders` (weight 6 − rank,
 * three drawn from five) are 82.6, 75.9, 65.6, 49.0 and 26.8.
 */
const DRAW_CHANCE_BY_RANK = [83, 76, 66, 49, 27] as const;
const drawChance = (rank: number) => DRAW_CHANCE_BY_RANK[rank - 1] ?? 0;

export const rankFact = (rank: number) => ({
    label: 'Rank',
    value: `${rank} of 5, defends in about ${drawChance(rank)}% of battles`,
});

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
    facts?: { label: string; value: string }[];
}

export interface TeamPetDetailsProps {
    /** Null shows a prompt to select a pet. */
    selection: PetSelection | null;
    /** Omit for a rival's pet: its tactic is part of the plan its owner signed. */
    onTacticChange?: (tactic: Tactic) => void;
    /** A defence plan's pet: its rank among the team's `count` pets, and how to give it another. */
    rank?: { current: number; count: number; onPick: (rank: number) => void };
}

const STATS = [
    ['hp', 'HP'],
    ['atk', 'ATK'],
    ['def', 'DEF'],
    ['int', 'INT'],
    ['mdef', 'MDEF'],
] as const;

/**
 * The details of the pet selected on a board: who it is, where it stands, its skill, its base
 * stats, its tactic and, in a defence plan, its rank. Stats come from the combat engine's own
 * `extract`, so they are the numbers a fight starts from, before gear and the skill's multipliers.
 */
const TeamPetDetails: React.FC<TeamPetDetailsProps> = ({ selection, onTacticChange, rank }) => {
    if (!selection) {
        return (
            <aside className={styles.details} aria-label="Pet details">
                <div className={styles.detailsBody}>
                    <p className={styles.muted}>Select a pet on the board to see its details and tactic.</p>
                </div>
            </aside>
        );
    }

    const { pet, side, col, row, tactic, facts = [] } = selection;
    const stats = extract(pet.dna, pet.rarity, pet.level);
    const skill = getPetSkill(pet.speciesId);
    const resting = pet.readyAt > Math.floor(Date.now() / 1000);
    const position = positionLabel(col, row);
    const tacticLabel = TACTIC_OPTIONS.find((t) => t.id === tactic)?.label ?? tactic;

    return (
        <aside className={styles.details} aria-label="Pet details">
            <div className={styles.detailsBody}>
                <div className={styles.detailsColumn}>
                    <div className={styles.detailsHead}>
                        <span className={styles.detailsArt} aria-hidden>
                            <PetArt pet={pet.art} />
                        </span>
                        <div>
                            <strong>{pet.name}</strong>
                            <div className={styles.muted}>{side === 0 ? 'Your pet' : 'Rival pet'}</div>
                            <div>
                                <span style={{ color: getRarityColor(pet.rarity) }}>{getRarityName(pet.rarity)}</span> · Lv {pet.level}
                            </div>
                        </div>
                    </div>

                    <dl className={styles.facts}>
                        <dt>Position</dt>
                        <dd>{position.charAt(0).toUpperCase() + position.slice(1)}</dd>
                        {facts.map((fact) => (
                            <React.Fragment key={fact.label}>
                                <dt>{fact.label}</dt>
                                <dd>{fact.value}</dd>
                            </React.Fragment>
                        ))}
                        {skill && (
                            <>
                                <dt>Skill</dt>
                                <dd>
                                    <strong>{skill.name}</strong>: {skill.description}
                                </dd>
                            </>
                        )}
                        {resting && (
                            <>
                                <dt>Status</dt>
                                <dd>Resting</dd>
                            </>
                        )}
                    </dl>
                </div>

                <div className={styles.detailsColumn}>
                    <div className={styles.stats} role="list" aria-label="Base stats">
                        {STATS.map(([key, label]) => (
                            <div key={key} className={styles.stat} role="listitem">
                                <strong>{Number(stats[key])}</strong>
                                {label}
                            </div>
                        ))}
                    </div>
                    <p className={styles.muted}>Base stats at this level, before gear and skill.</p>

                    {onTacticChange ? (
                        <label className={styles.field}>
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
                        <div className={styles.field}>
                            <span className={styles.fieldLabel}>Tactic</span>
                            <span>{tacticLabel}</span>
                        </div>
                    )}

                    {rank && (
                        <div className={styles.field}>
                            <span className={styles.fieldLabel}>Rank</span>
                            <div className={styles.rankPicker} role="group" aria-label={`Rank for ${pet.name}`}>
                                {Array.from({ length: rank.count }, (_, i) => i + 1).map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        aria-pressed={r === rank.current}
                                        aria-label={`Rank ${r}, defends in about ${drawChance(r)}% of battles`}
                                        className={clsx(styles.rankOption, r === rank.current && styles.rankOptionChosen)}
                                        onClick={() => rank.onPick(r)}
                                    >
                                        <strong>{r}</strong>
                                        {drawChance(r)}%
                                    </button>
                                ))}
                            </div>
                            <p className={styles.muted}>
                                Each battle draws three of your five pets to defend, and a higher rank is
                                drawn more often. Picking a rank swaps places with the pet that holds it.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
};

export default TeamPetDetails;
