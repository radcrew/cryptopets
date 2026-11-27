import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { shortAddress, useAuth, useChainCapabilities, usePlayerRank } from '@shared/core';

import Icon, { SoundOffIcon, SoundOnIcon } from '@components/ui/icon';
import AccountDropdown from '@components/wallet/account-dropdown';
import { DASHBOARD_HOME } from '@constants/interactionRoutes';
import { useSound } from '@contexts/sound';
import styles from './index.module.css';

/**
 * Placeholder daily quests, pending real quest data (they moved here from the old sidebar
 * unchanged). The numbers are illustrative, not the player's progress, and the panel says the
 * feature is coming soon.
 */
const QUESTS = [
    { label: '⚔ Win 3 battles', reward: '+50 XP', progress: 100 },
    { label: '💪 Train a pet', reward: '+25 XP', progress: 100 },
    { label: '🥚 Breed a new pet', reward: '+100 XP', progress: 0 },
] as const;

/** The week, for the streak row; the lit days are illustrative, inside a panel marked Coming soon. */
const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const SAMPLE_STREAK = 3;

/**
 * The player's plate: who they are and where they stand on the leaderboard.
 *
 * Three states, all real: a rank, unranked (connected but no pet has fought), and nothing at
 * all while it loads or before a session exists. The last renders no plate rather than a
 * zero, which would be indistinguishable from a genuine last place.
 */
const PlayerPlate: React.FC = () => {
    const { activeKind, walletAddress } = useChainCapabilities();
    const { isAuthenticated } = useAuth();
    const { rank, isLoading } = usePlayerRank(activeKind);

    if (isLoading) return null;

    return (
        <div className={styles.plate}>
            <span className={styles.ring} aria-hidden>
                {rank ? `#${rank.rank}` : '🏆'}
            </span>
            <span className={styles.who}>
                <b>{walletAddress ? `Trainer ${shortAddress(walletAddress)}` : 'Trainer'}</b>
                <span>
                    {/* The board is read only when signed in. Signed out, nobody has asked yet,
                        which is not the same answer as unranked. */}
                    {!isAuthenticated
                        ? 'Sign in to see your rank'
                        : rank
                          ? `Rank #${rank.rank} · ${rank.winCount} win${rank.winCount === 1 ? '' : 's'}`
                          : 'Unranked · win a fight to join'}
                </span>
            </span>
        </div>
    );
};

/** The daily quests scroll, opened from its key and closed by Escape or a click elsewhere. */
const Quests: React.FC = () => {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        const onPointer = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('pointerdown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('pointerdown', onPointer);
        };
    }, [open]);

    return (
        <div className={styles.quests} ref={root}>
            <button
                type="button"
                className={styles.key}
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-label="Daily quests"
            >
                <span aria-hidden>📜</span>
            </button>
            {open && (
                <div className={styles.questPanel} role="dialog" aria-label="Daily quests">
                    <div className={styles.questTitle}>
                        Daily quests <span className={styles.soonPill}>Coming soon</span>
                    </div>
                    <p className={styles.questNote}>
                        Fresh quests every day, a streak to keep, and a chest for finishing all three.
                    </p>
                    <ul className={styles.questList}>
                        {QUESTS.map((q) => (
                            <li key={q.label}>
                                <span className={styles.questRow}>
                                    <span>{q.label}</span>
                                    <em>{q.reward}</em>
                                </span>
                                <span className={styles.questTrack}>
                                    <span className={styles.questFill} style={{ width: `${q.progress}%` }} />
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div className={styles.week} aria-label="Day streak, a preview">
                        {WEEK.map((day, i) => (
                            <span key={i} className={i < SAMPLE_STREAK ? styles.lit : undefined}>
                                <span aria-hidden>🔥</span>
                                {day}
                            </span>
                        ))}
                    </div>
                    <button type="button" className={styles.chest} disabled>
                        🎁 Daily chest · finish all three
                    </button>
                </div>
            )}
        </div>
    );
};

/**
 * The game HUD, floating over the top of every scene: the logo home, the player's plate and
 * streak, then the quests scroll, the sound switch and the wallet.
 */
const Hud: React.FC = () => {
    const { isConnected } = useChainCapabilities();
    const { muted, toggleMuted } = useSound();

    return (
        <header className={styles.hud}>
            <Link to={DASHBOARD_HOME} className={styles.logo} aria-label="Crypto Pets home">
                CRYPTO
                <br />
                PETS
            </Link>
            {isConnected && <PlayerPlate />}
            {isConnected && (
                // No streak is recorded yet, so the chip makes no claim about one: daily
                // streaks arrive with daily quests, which the quests scroll previews.
                <span className={styles.streak} title="Daily streaks are coming with daily quests">
                    <span aria-hidden>🔥</span> <small>Streaks soon</small>
                </span>
            )}
            <span className={styles.spacer} />
            {isConnected && <Quests />}
            {/* aria-pressed: one control whose state changes, rather than a label that flips. */}
            <button
                type="button"
                className={styles.key}
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

export default Hud;
