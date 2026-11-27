import React from 'react';

import ComingSoon from '@components/game/coming-soon';
import styles from './season-leagues.module.css';

/** Sample thresholds, as the whitepaper sketches them: a fair win is 10 points, a loss 3. */
const LEAGUES = [
    { name: 'Bronze', points: 0, tone: '#e0905a' },
    { name: 'Silver', points: 300, tone: '#c9d3e6' },
    { name: 'Gold', points: 700, tone: '#ffd25a' },
    { name: 'Platinum', points: 1200, tone: '#7dd6ff' },
    { name: 'Legend', points: 2000, tone: '#ff7bcb' },
] as const;

/**
 * Season leagues, a planned feature: a preview of the five leagues a season would climb
 * through. Nothing here is read from the board; the thresholds are sample values.
 */
const SeasonLeagues: React.FC = () => (
    <ComingSoon
        className={styles.leagues}
        note="Seasons with five leagues: points from fair fights move you up, and rewards are paid when a season ends."
    >
        <div className={styles.row}>
            {LEAGUES.map((league) => (
                <div key={league.name} className={styles.league} style={{ '--tone': league.tone } as React.CSSProperties}>
                    <svg viewBox="0 0 24 24" aria-hidden>
                        <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" style={{ fill: league.tone }} />
                        <path d="M12 7l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z" fill="#fff" opacity=".85" />
                    </svg>
                    <b>{league.name}</b>
                    <small>{league.points.toLocaleString('en-US')} pts</small>
                </div>
            ))}
        </div>
        <p className={styles.points}>A fair win is worth 10 points and a loss 3, so even a loss moves you forward.</p>
    </ComingSoon>
);

export default SeasonLeagues;
