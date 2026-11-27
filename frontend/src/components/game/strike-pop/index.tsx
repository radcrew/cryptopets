import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';

import { useSound } from '@contexts/sound';
import styles from './index.module.css';

export type StrikeCue = {
    /** Changes with every strike; render the pop with it as `key` so each one replays. */
    id: number;
    damage: string;
    crit: boolean;
    magic: boolean;
    /** See `strikeLabel`. */
    label: string | null;
};

const SHAKE: Keyframe[] = [
    { transform: 'translate(0, 0)' },
    { transform: 'translate(-8px, 4px)' },
    { transform: 'translate(7px, -5px)' },
    { transform: 'translate(-4px, 3px)' },
    { transform: 'translate(0, 0)' },
];

const prefersStill = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * A damage number that pops over the pet that took the hit, with its sound, and a shake of
 * that pet's frame on a critical hit.
 *
 * Decoration over the battle log, which already says the same thing in words, so it is hidden
 * from screen readers. Place it inside a positioned element over the victim.
 */
const StrikePop: React.FC<{ cue: StrikeCue }> = ({ cue }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const { play } = useSound();

    useEffect(() => {
        play(cue.crit ? 'crit' : cue.magic ? 'magic' : 'hit');
        if (cue.crit && !prefersStill()) ref.current?.parentElement?.animate?.(SHAKE, { duration: 320 });
    }, [cue, play]);

    return (
        <span ref={ref} className={clsx(styles.pop, cue.crit && styles.crit, cue.magic && styles.magic)} aria-hidden>
            {cue.damage}
            {cue.label && <span className={styles.label}>{cue.label}</span>}
        </span>
    );
};

export default StrikePop;
