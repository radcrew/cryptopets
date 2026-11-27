import React from 'react';
import clsx from 'clsx';

import styles from './index.module.css';

type ComingSoonProps = {
    /** One line on what the feature will be, shown under the ribbon. */
    note: string;
    className?: string;
    /** The mockup. It is drawn but inert: nothing inside can be clicked, focused or read as live. */
    children: React.ReactNode;
};

/**
 * A planned feature, shown as a preview with a "Coming soon" ribbon across it.
 *
 * The mockup is `inert`, so its buttons cannot be pressed and are skipped by the keyboard and
 * screen readers alike; the ribbon and the note are what a reader gets. Everything inside is
 * sample content, which is why nothing in it may look like a working control.
 */
const ComingSoon: React.FC<ComingSoonProps> = ({ note, className, children }) => (
    <section className={clsx(styles.soon, className)} aria-label={`Coming soon: ${note}`}>
        <span className={styles.ribbon}>Coming soon</span>
        <p className={styles.note}>{note}</p>
        <div className={styles.mock} inert>
            {children}
        </div>
    </section>
);

export default ComingSoon;
