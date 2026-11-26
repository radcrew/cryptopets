import React from 'react';
import clsx from 'clsx';
import { useLocation, useNavigate } from 'react-router-dom';

import { useBattleConfig, useChainCapabilities, usePlayerRank } from '@shared/core';

import Icon, { PinFilledIcon, PinIcon } from '@components/ui/icon';
import { DASHBOARD_HOME } from '@constants/interactionRoutes';
import { useSidebarPin } from '@hooks/useSidebarPin';
import { NAV_ITEMS } from './nav-items';
import styles from './index.module.css';

/**
 * The player's own standing, from the leaderboard the sidebar links to.
 *
 * Its own component so the sidebar itself stays free of data fetching, and so the
 * hook is not called on every re-render of a nav item.
 *
 * Three states, all real: a rank, unranked (connected but no pet has fought), and
 * nothing at all while it loads or before a session exists. The last one renders
 * no footer rather than a zero, which would be indistinguishable from a genuine
 * last place.
 */
const RankFooter: React.FC = () => {
    const { activeKind } = useChainCapabilities();
    const { rank, isLoading } = usePlayerRank(activeKind);

    if (isLoading) return null;

    return (
        <div className={styles.rank}>
            <span className={styles.rankIcon} aria-hidden>
                🏆
            </span>
            <div className={styles.rankCopy}>
                <div className={styles.rankTitle}>
                    {rank ? `RANK #${rank.rank} GLOBAL` : 'UNRANKED'}
                </div>
                <div className={styles.rankSub}>
                    {rank
                        ? `${rank.winCount} Total Win${rank.winCount === 1 ? '' : 's'}`
                        : 'Win a battle to enter the board'}
                </div>
            </div>
        </div>
    );
};

/**
 * Collapsible left navigation for the app shell. Collapsed to an icon rail by
 * default; expands on hover / keyboard focus (CSS-driven), or stays open when
 * pinned. Nav items drive the existing router so deep-links keep working; the
 * logo returns to the gallery.
 *
 * Daily Quests is still a static placeholder pending real data
 * (see FRONTEND_REDESIGN_PLAN.md §8 Q3); the rank footer is live.
 */
const Sidebar: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const currentPath = location.pathname.replace(/\/$/, '') || '/';
    const { pinned, toggle } = useSidebarPin();
    const { data: battleConfig } = useBattleConfig();
    const teamBattles = Boolean(battleConfig?.team?.enabled);

    return (
        <nav
            className={clsx(styles.sidebar, pinned && styles.isPinned)}
            aria-label="Primary"
        >
            <div className={styles.brandRow}>
                <button
                    type="button"
                    className={styles.brand}
                    onClick={() => navigate(DASHBOARD_HOME)}
                    aria-label="Crypto Pets home"
                >
                    <span className={styles.wordmark}>CRYPTOPETS</span>
                </button>

                {/* aria-pressed rather than a label that flips: the control is the
                    same control either way, and its state is what changes. */}
                <button
                    type="button"
                    className={styles.pin}
                    onClick={toggle}
                    aria-pressed={pinned}
                    aria-label="Keep sidebar open"
                    title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
                >
                    <Icon as={pinned ? PinFilledIcon : PinIcon} tone="cyan" glow="none" noGap />
                </button>
            </div>

            <div className={styles.nav}>
                {NAV_ITEMS.filter((item) => teamBattles || !item.requiresTeamBattles).map((item) => {
                    const isActive = item.path != null && currentPath === item.path;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            className={clsx(
                                styles.navItem,
                                styles[item.tone],
                                isActive && styles.isActive,
                                item.deferred && styles.isDeferred,
                            )}
                            onClick={() => item.path && navigate(item.path)}
                            disabled={item.deferred}
                            aria-current={isActive ? 'page' : undefined}
                            title={item.deferred ? `${item.label} — coming soon` : item.label}
                        >
                            <span className={styles.navIcon} aria-hidden>
                                <img src={item.iconSrc} alt="" width={24} height={24} />
                            </span>
                            <span className={styles.navLabel}>{item.label}</span>
                            {item.deferred && <span className={styles.navSoon}>Soon</span>}
                        </button>
                    );
                })}
            </div>

            <div className={styles.divider} />

            {/* Placeholder — Daily Quests (pending real quest data) */}
            <div className={styles.quests}>
                <div className={styles.sectionTitle}>◈ Daily Quests</div>
                <ul className={styles.questList}>
                    <li>
                        <div className={styles.questRow}>
                            <span className={styles.questLabel}>⚔ Win 3 battles</span>
                            <span className={styles.questReward}>+50 XP</span>
                        </div>
                        <div className={styles.questTrack}>
                            <div className={styles.questFill} style={{ width: '100%' }} />
                        </div>
                    </li>
                    <li>
                        <div className={styles.questRow}>
                            <span className={styles.questLabel}>💪 Train a pet</span>
                            <span className={styles.questReward}>+25 XP</span>
                        </div>
                        <div className={styles.questTrack}>
                            <div className={styles.questFill} style={{ width: '100%' }} />
                        </div>
                    </li>
                    <li>
                        <div className={styles.questRow}>
                            <span className={styles.questLabel}>🥚 Breed a new pet</span>
                            <span className={styles.questReward}>+100 XP</span>
                        </div>
                        <div className={styles.questTrack}>
                            <div className={styles.questFill} style={{ width: '0%' }} />
                        </div>
                    </li>
                </ul>
            </div>

            <RankFooter />
        </nav>
    );
};

export default Sidebar;
