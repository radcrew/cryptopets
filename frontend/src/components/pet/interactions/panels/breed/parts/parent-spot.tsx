import React from 'react';
import { getPetProperties, type Pet } from '@shared/core';

import PetStage from '@components/game/pet-stage';
import styles from '../nest.module.css';

/** The four DNA stats, as chips under the pedestal. AGI has no backing in the data model,
 *  so the fourth is VIT (life), as on a pet's sheet. */
const STATS = [
    { label: 'STR', key: 'attack' },
    { label: 'INT', key: 'intelligence' },
    { label: 'DEF', key: 'defense' },
    { label: 'VIT', key: 'life' },
] as const;

type ParentSpotProps = {
    pet: Pet | null;
    /** Said on the empty pedestal. */
    emptyHint: string;
    /** What the cycle keys move through, in their names: "Next first parent". */
    cycleName: string;
    onPrev?: () => void;
    onNext?: () => void;
};

/** One parent on its pedestal beside the nest, with its stats and keys to cycle to another. */
const ParentSpot: React.FC<ParentSpotProps> = ({ pet, emptyHint, cycleName, onPrev, onNext }) => {
    const props = pet ? getPetProperties(pet) : null;
    return (
        <div className={styles.parent}>
            <PetStage pet={pet} tone="amber" emptyHint={emptyHint} />
            {props && (
                <ul className={styles.stats} aria-label="Stats">
                    {STATS.map((s) => (
                        <li key={s.label}>
                            <small>{s.label}</small>
                            <b>{props[s.key]}</b>
                        </li>
                    ))}
                </ul>
            )}
            {pet?.breedCount != null && <span className={styles.bred}>Bred {pet.breedCount}×</span>}
            {(onPrev || onNext) && (
                <div className={styles.cycle}>
                    <button type="button" className={styles.cycleKey} onClick={onPrev} aria-label={`Previous ${cycleName}`}>
                        ◀
                    </button>
                    <button type="button" className={styles.cycleKey} onClick={onNext} aria-label={`Next ${cycleName}`}>
                        ▶
                    </button>
                </div>
            )}
        </div>
    );
};

export default ParentSpot;
