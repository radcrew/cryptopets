import clsx from 'clsx';
import React from 'react';

import PetArt from '@components/pet/pet-art';
import type { Pet } from '@shared/core';

import styles from './index.module.css';

export interface TeamPetGridProps {
    pets: Pet[];
    /** Chosen pet ids, in order. A chosen tile shows its place in that order. */
    selected: string[];
    max: number;
    onToggle: (petId: string) => void;
    /** Shows resting pets but refuses them, for a squad that has to fight now. */
    blockResting?: boolean;
    /** The pets are still being read, so an empty list means "not yet" rather than "none". */
    loading?: boolean;
    label: string;
}

/**
 * The player's pets as tiles with their art, for building a team: tap a pet to add it, tap it
 * again to take it out. Toggle buttons rather than `PetPicker`'s radio group, because a team
 * holds several pets at once; the tiles follow `PetPicker`'s look so the two choosers match.
 */
const TeamPetGrid: React.FC<TeamPetGridProps> = ({ pets, selected, max, onToggle, blockResting = false, loading = false, label }) => {
    if (loading && pets.length === 0) {
        return (
            <p className={styles.muted} role="status">
                Loading your pets…
            </p>
        );
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const full = selected.length >= max;
    return (
        <div className={styles.petGrid} role="group" aria-label={label}>
            {pets.map((pet) => {
                const position = selected.indexOf(pet.id);
                const chosen = position >= 0;
                const resting = pet.readyAt > nowSeconds;
                return (
                    <button
                        key={pet.id}
                        type="button"
                        aria-pressed={chosen}
                        aria-label={`${pet.name}, level ${pet.level}${resting ? ', resting' : ''}`}
                        className={clsx(styles.petTile, chosen && styles.petTileChosen)}
                        disabled={!chosen && (full || (blockResting && resting))}
                        onClick={() => onToggle(pet.id)}
                    >
                        {chosen && <span className={styles.petBadge}>{position + 1}</span>}
                        <span className={styles.petArt} aria-hidden>
                            <PetArt pet={pet} />
                        </span>
                        <span className={styles.petName}>{pet.name}</span>
                        <span className={styles.petLevel}>Lv {pet.level}</span>
                        {resting && <span className={styles.petResting}>Resting</span>}
                    </button>
                );
            })}
        </div>
    );
};

export default TeamPetGrid;
