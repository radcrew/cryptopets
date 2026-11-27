import React from 'react';
import { usePulseRound } from '@shared/core';

import styles from './pulse-orb.module.css';

const RUNES = 'THE PULSE ✦ EVERY THREE SECONDS ✦ NOBODY KNOWS THE NEXT BEAT ✦';

/**
 * The Pulse: the drand beat every battle is seeded from, drawn as the Shore's moon.
 *
 * The round is the real quicknet round by the local clock. The core, the shockwave
 * and the countdown ring are keyed by it, so each remounts on the beat and its CSS
 * animation starts over without any timers here.
 */
const PulseOrb: React.FC = () => {
    const { round } = usePulseRound();

    return (
        <div className={styles.pulse} role="img" aria-label={`The Pulse, drand round ${round}`}>
            <span className={styles.halo} />
            <svg className={styles.rings} viewBox="0 0 200 200" aria-hidden>
                <defs>
                    <path id="shore-rune-path" d="M100 100 m-86 0 a86 86 0 1 1 172 0 a86 86 0 1 1 -172 0" />
                </defs>
                <g className={styles.ringSlow}>
                    <circle cx="100" cy="100" r="97" fill="none" stroke="#c9b0ff" strokeOpacity=".3" />
                    <text className={styles.runes}>
                        <textPath href="#shore-rune-path" textLength="530">
                            {RUNES}
                        </textPath>
                    </text>
                </g>
                <g className={styles.ringFast}>
                    <circle
                        cx="100"
                        cy="100"
                        r="68"
                        fill="none"
                        stroke="#7dd6ff"
                        strokeOpacity=".55"
                        strokeWidth="1.5"
                        strokeDasharray="2 8"
                    />
                </g>
                <circle
                    key={`cd${round}`}
                    className={styles.countdown}
                    cx="100"
                    cy="100"
                    r="76"
                    fill="none"
                    pathLength={100}
                    transform="rotate(-90 100 100)"
                />
            </svg>
            <span key={`core${round}`} className={styles.core}>
                <span className={styles.swirl} />
                <span className={styles.shine} />
            </span>
            <span key={`wave${round}`} className={styles.wave} />
            <span className={styles.plaque}>
                PULSE <b>#{round.toLocaleString('en-US')}</b>
            </span>
        </div>
    );
};

export default PulseOrb;
