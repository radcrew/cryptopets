import React from 'react';

import styles from './pet-showcase.module.css';

export type ShowcaseAccent = 'violet' | 'cyan' | 'amber';

/** Matches the `Tones` palette, so a panel's hero agrees with its tile in the More sheet. */
const ACCENT_RGB: Record<ShowcaseAccent, string> = {
    violet: '181 140 255',
    cyan: '125 214 255',
    amber: '251 191 36',
};

export type PetShowcaseProps = {
    /** Rendered inside the ring hero (typically the pet's emoji avatar). */
    avatar: React.ReactNode;
    accent: ShowcaseAccent;
    /** Panel-specific content rendered below the hero (name, badges, XP, …). */
    children?: React.ReactNode;
};

/**
 * Avatar hero shared by the level-up, rename and equip panels: a floating avatar
 * tinted by `accent`. Panel-specific details (level transition, live name
 * preview, requirements) are passed as children and rendered beneath the hero.
 */
const PetShowcase: React.FC<PetShowcaseProps> = ({ avatar, accent, children }) => (
    <div
        className={styles.root}
        style={{ '--sc-accent': ACCENT_RGB[accent] } as React.CSSProperties}
    >
        <div className={styles.hero}>
            <span className={styles.avatar}>{avatar}</span>
        </div>
        {children}
    </div>
);

export default PetShowcase;
