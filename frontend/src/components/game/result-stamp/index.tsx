import React, { useEffect } from 'react';
import clsx from 'clsx';

import { useSound } from '@contexts/sound';
import styles from './index.module.css';

/** Fixed rather than random, so the burst looks the same on every win and in every test. */
const CONFETTI = Array.from({ length: 26 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: ((i * 7) % 10) / 25,
    hue: ['#ffd25a', '#ff7bcb', '#7dd6ff', '#0fffae', '#ffffff'][i % 5],
    spin: (i * 53) % 360,
}));

type ResultStampProps = {
    won: boolean;
    /** The caller's own title class, kept for layout; the stamp adds the motion and colour. */
    className?: string;
    as?: 'div' | 'h3';
    children: React.ReactNode;
};

/**
 * A battle's verdict, slammed onto the screen: light rays and confetti for a win, a heavier
 * grey stamp for a loss, each with its own jingle. Only for a known result; a battle still
 * resolving keeps its plain title.
 */
const ResultStamp: React.FC<ResultStampProps> = ({ won, className, as: Tag = 'div', children }) => {
    const { play } = useSound();

    useEffect(() => {
        play(won ? 'victory' : 'defeat');
    }, [won, play]);

    return (
        <div className={styles.wrap}>
            {won && (
                <>
                    <span className={styles.rays} aria-hidden />
                    <span className={styles.confetti} aria-hidden>
                        {CONFETTI.map((c, i) => (
                            <i
                                key={i}
                                style={{
                                    left: `${c.left}%`,
                                    background: c.hue,
                                    animationDelay: `${c.delay}s`,
                                    rotate: `${c.spin}deg`,
                                }}
                            />
                        ))}
                    </span>
                </>
            )}
            <Tag className={clsx(className, styles.stamp, won ? styles.win : styles.lose)}>{children}</Tag>
        </div>
    );
};

export default ResultStamp;
