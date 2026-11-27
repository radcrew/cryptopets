import React from 'react';
import { getGeneration, type Pet } from '@shared/core';

import styles from '../nest.module.css';

type NestProps = {
    petA: Pet | null;
    petB: Pet | null;
    /** Said in place of the generation while it cannot be known. */
    waiting?: string;
    /** Whether the egg glows, ready to be made. Defaults to both parents being chosen. */
    ready?: boolean;
    /** The name field and the breed key, under the egg. */
    children?: React.ReactNode;
};

/**
 * The nest between the two parents: the egg they will lay, its generation, and how to make it.
 *
 * Only what is known is shown. The generation follows from the parents; the rarity does
 * not, because the chain decides it from randomness when the egg is settled, so the egg
 * says so rather than guessing one.
 */
const Nest: React.FC<NestProps> = ({ petA, petB, waiting = 'Choose two parents', ready = Boolean(petA && petB), children }) => {
    const generation =
        petA && petB ? Math.max(petA.generation ?? getGeneration(petA.dna), petB.generation ?? getGeneration(petB.dna)) + 1 : null;

    return (
        <div className={styles.nest}>
            <div className={styles.eggSpot} aria-hidden>
                <span className={styles.glow} />
                <span className={ready ? styles.egg : styles.eggDim} />
                <svg className={styles.twigs} viewBox="0 0 200 70">
                    <path d="M8 26 Q100 78 192 26 Q186 58 100 66 Q14 58 8 26 Z" fill="url(#nest-straw)" />
                    {[18, 42, 66, 92, 118, 144, 170].map((x, i) => (
                        <path
                            key={x}
                            d={`M${x} ${32 + (i % 2) * 6} q${14} ${10 + (i % 3) * 4} ${30} ${-2}`}
                            stroke="#5e4422"
                            strokeWidth="3"
                            fill="none"
                            strokeLinecap="round"
                        />
                    ))}
                    <defs>
                        <linearGradient id="nest-straw" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="#c8955a" />
                            <stop offset="1" stopColor="#7a5228" />
                        </linearGradient>
                    </defs>
                </svg>
            </div>
            <span className={styles.gen}>{generation ? `Gen ${generation}` : waiting}</span>
            <p className={styles.note}>Its rarity is decided when it hatches.</p>
            {children}
        </div>
    );
};

export default Nest;
