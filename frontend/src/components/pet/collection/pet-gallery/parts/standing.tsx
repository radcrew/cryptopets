import React from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
    sameAccount,
    shortAddress,
    useAuth,
    useChainCapabilities,
    usePlayerLeaderboard,
    usePlayerRank,
} from '@shared/core';

import { LEADERBOARD_PATH } from '@constants/interactionRoutes';
import styles from '../index.module.css';

/** How many leaders the strip names; the Hall of Champions has the rest. */
const SHOWN = 5;

/**
 * The player's place on the player board, as one stat tile.
 *
 * The board is read only for a signed-in session, so a signed-out player is asked to sign
 * in rather than told they are unranked: nobody has asked yet, which is a different answer.
 */
export const RankStat: React.FC = () => {
    const { activeKind } = useChainCapabilities();
    const { isAuthenticated } = useAuth();
    const { rank, isLoading } = usePlayerRank(activeKind);

    return (
        <div className={styles.statBody}>
            <div className={styles.statValue}>{rank ? `#${rank.rank}` : isLoading ? '…' : '—'}</div>
            <div className={styles.statLabel}>
                {!isAuthenticated ? 'Sign in to rank' : rank || isLoading ? 'Global rank' : 'Unranked'}
            </div>
        </div>
    );
};

/** The top of the player board, with the player marked when they are on it. */
export const Leaders: React.FC = () => {
    const navigate = useNavigate();
    const { activeKind, walletAddress } = useChainCapabilities();
    const { isAuthenticated } = useAuth();
    const { entries, isLoading } = usePlayerLeaderboard({ chain: activeKind });
    const top = entries.slice(0, SHOWN);

    return (
        <div className={styles.leaderboard}>
            <div className={styles.lbHead}>
                <span className={styles.leaderboardTitle}>🏆 Leaderboard</span>
                <button type="button" className={styles.lbAll} onClick={() => navigate(LEADERBOARD_PATH)}>
                    See all ›
                </button>
            </div>
            {!isAuthenticated ? (
                <p className={styles.lbNote}>Sign in to see who leads.</p>
            ) : isLoading ? (
                <p className={styles.lbNote}>Reading the board…</p>
            ) : top.length === 0 ? (
                <p className={styles.lbNote}>No battles on record yet. The first win takes the top spot.</p>
            ) : (
                <ul className={styles.leaderboardList}>
                    {top.map((entry) => {
                        const me = sameAccount(entry.owner, walletAddress ?? '');
                        return (
                            <li key={entry.owner} className={clsx(styles.lbRow, me && styles.isMe)}>
                                <span className={styles.lbRank}>#{entry.rank}</span>
                                <span className={styles.lbName}>{me ? 'You' : shortAddress(entry.owner)}</span>
                                <span className={styles.lbTier}>
                                    {entry.winCount} win{entry.winCount === 1 ? '' : 's'}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};
