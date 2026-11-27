import React from 'react';
import clsx from 'clsx';

import styles from './index.module.css';

export type GateKind = 'wallet' | 'lock' | 'egg';

const EMBLEMS: Record<GateKind, string> = { wallet: '👛', lock: '🔒', egg: '🥚' };

type GateSceneProps = {
    /** What stands in the way: no wallet, no session, or no pets yet. */
    kind: GateKind;
    title: string;
    /** What is behind the gate and what opens it. */
    text: string;
    /** One more line, on how the key works. */
    hint?: string;
    /** The key: sign in, summon, and so on. */
    children?: React.ReactNode;
};

/**
 * A closed gate in front of a page: a glowing emblem for what is missing, a sign saying what
 * is behind it, and the key that opens it. Every page that needs a wallet, a session or pets
 * shows this before it can show itself.
 */
const GateScene: React.FC<GateSceneProps> = ({ kind, title, text, hint, children }) => (
    <div className={clsx(styles.gate, styles[kind])}>
        <span className={styles.emblem} aria-hidden>
            {EMBLEMS[kind]}
        </span>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.text}>{text}</p>
        {children && <div className={styles.key}>{children}</div>}
        {hint && <p className={styles.hint}>{hint}</p>}
    </div>
);

export default GateScene;
