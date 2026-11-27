import React, { useMemo } from 'react';
import clsx from 'clsx';
import { useChainCapabilities, usePetList } from '@shared/core';

import Icon, { SoundOffIcon, SoundOnIcon } from '@components/ui/icon';
import AccountDropdown from '@components/wallet/account-dropdown';
import { useSound } from '@contexts/sound';
import styles from './index.module.css';

const TITLE = 'Crypto Pets';

/**
 * Shell header: wordmark, player status badges, the sound switch, and the wallet control.
 *
 * Total wins is derived from the real pet list. The Gold tier / level and the
 * win-streak badges are static placeholders pending real progression data
 * (see FRONTEND_REDESIGN_PLAN.md §8 Q3).
 */
const TopBar: React.FC = () => {
    const { isConnected } = useChainCapabilities();
    const { pets } = usePetList();
    const { muted, toggleMuted } = useSound();

    const totalWins = useMemo(
        () => pets.reduce((sum, pet) => sum + (pet.winCount ?? 0), 0),
        [pets],
    );

    return (
        <header className={styles.topbar}>
            <div className={styles.title}>{TITLE}</div>
            <div className={styles.spacer} />

            {isConnected && (
                <div className={styles.badges}>
                    {/* Placeholder — player tier/level (no progression data yet) */}
                    <div className={clsx(styles.badge, styles.gold)}>
                        <span aria-hidden>🥇</span>
                        <span className={styles.strong}>GOLD</span>
                        <span className={styles.sep} />
                        <span className={styles.muted}>Lv 24</span>
                    </div>
                    {/* Placeholder — win streak */}
                    <div className={clsx(styles.badge, styles.streak)}>
                        <span aria-hidden>🔥</span>
                        <span className={styles.strong}>7 STREAK</span>
                    </div>
                    {/* Real — total wins across owned pets */}
                    <div className={clsx(styles.badge, styles.wins)}>
                        <span aria-hidden>⚔</span>
                        <span>{totalWins} Wins</span>
                    </div>
                </div>
            )}

            {/* aria-pressed for the same reason as the sidebar pin: one control whose state changes. */}
            <button
                type="button"
                className={styles.sound}
                onClick={toggleMuted}
                aria-pressed={!muted}
                aria-label="Sound effects"
                title={muted ? 'Turn sound on' : 'Mute sound'}
            >
                <Icon as={muted ? SoundOffIcon : SoundOnIcon} tone="cyan" glow="none" noGap />
            </button>

            <div className={styles.wallet}>
                <AccountDropdown />
            </div>
        </header>
    );
};

export default TopBar;
