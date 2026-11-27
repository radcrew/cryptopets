import React from 'react';
import clsx from 'clsx';
import { getPetClass, getRarityColor, type Pet } from '@shared/core';

import PetArt from '@components/pet/pet-art';
import styles from './index.module.css';

export type StageTone = 'cyan' | 'violet' | 'amber' | 'magenta';

type PetStageProps = {
    pet: Pet | null;
    /** The page's accent: tints the spotlight and the pedestal's glow. */
    tone: StageTone;
    /** Said on the empty pedestal before a pet is chosen. */
    emptyHint: string;
    /** What the action will do, drawn beside the pet: an XP bar, a level jump, a name plaque. */
    children?: React.ReactNode;
    className?: string;
};

/**
 * A pet standing on a lit pedestal: the centre of every page that acts on one pet.
 *
 * Before a pet is chosen the pedestal holds a ghostly "?" and says what to do, so choosing
 * one swaps a figure onto a stage that is already there and nothing below it moves.
 */
const PetStage: React.FC<PetStageProps> = ({ pet, tone, emptyHint, children, className }) => (
    <div className={clsx(styles.stage, styles[tone], className)}>
        <div className={styles.spot}>
            <span className={styles.beam} aria-hidden />
            <div
                className={clsx(styles.figure, !pet && styles.empty)}
                style={pet ? ({ '--rc': getRarityColor(pet.rarity) } as React.CSSProperties) : undefined}
            >
                {pet ? <PetArt pet={pet} fill emojiClassName={styles.emoji} /> : <span className={styles.ghost}>?</span>}
            </div>
            <span className={styles.pedestal} aria-hidden />
            {pet ? (
                <div className={styles.plate}>
                    <b>{pet.name}</b>
                    <small>
                        Lv {pet.level} · {getPetClass(pet.dna)}
                    </small>
                </div>
            ) : (
                <p className={styles.hint}>{emptyHint}</p>
            )}
        </div>
        {children && <div className={styles.effect}>{children}</div>}
    </div>
);

/** A labelled bar for a stage's effect card, such as the XP a pet has toward its next level. */
export const StageBar: React.FC<{ label: string; value: string; percent: number }> = ({ label, value, percent }) => (
    <div className={styles.bar}>
        <span className={styles.barHead}>
            <b>{label}</b>
            <span>{value}</span>
        </span>
        <span className={styles.barTrack}>
            <span className={styles.barFill} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </span>
    </div>
);

/** The small heading at the top of a stage's effect card. */
export const StageKicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className={styles.kicker}>{children}</span>
);

export default PetStage;
