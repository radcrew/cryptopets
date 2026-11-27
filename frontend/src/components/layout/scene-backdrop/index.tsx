import React from 'react';
import clsx from 'clsx';

import {
    BATTLE_PATH,
    BREED_PATH,
    INVENTORY_PATH,
    LEADERBOARD_PATH,
    LEDGER_PATH,
    MARKET_PATH,
    MARRIAGE_PATH,
    TEAM_BATTLE_PATH,
} from '@constants/interactionRoutes';
import styles from './index.module.css';

export type Scene = 'shore' | 'arena' | 'nest' | 'hall' | 'market';

const SCENE_BY_PATH: [string, Scene][] = [
    [BATTLE_PATH, 'arena'],
    [TEAM_BATTLE_PATH, 'arena'],
    [BREED_PATH, 'nest'],
    [MARRIAGE_PATH, 'nest'],
    [LEADERBOARD_PATH, 'hall'],
    // The stones stand on the Hall of Champions' floor: the record of every fight.
    [LEDGER_PATH, 'hall'],
    [INVENTORY_PATH, 'market'],
    [MARKET_PATH, 'market'],
];

/** The place a page happens in; anything without a place of its own is on the Shore at night. */
export const sceneFor = (pathname: string): Scene =>
    SCENE_BY_PATH.find(([path]) => pathname === path || pathname.startsWith(`${path}/`))?.[1] ?? 'shore';

/** Fixed rather than random, so a scene looks the same on every visit. */
const STARS = Array.from({ length: 60 }, (_, i) => ({ left: (i * 37.7) % 100, top: (i * 23.3) % 60, delay: -((i * 0.61) % 3) }));
const CROWD_ROWS = [
    { y: 34, scale: 0.8 },
    { y: 66, scale: 0.9 },
    { y: 98, scale: 1 },
];
const CROWD_SHADES = ['#2a1840', '#341d4f', '#22143a', '#3b2256'];
const GLOWSTICKS = ['#ff7bcb', '#7dd6ff', '#ffd25a', '#0fffae'];
const BANNERS = [
    { tone: '#ff7bcb', side: 'left' as const, at: '6%', emblem: 'M20 30l9 15-9 15-9-15z' },
    { tone: '#b58cff', side: 'left' as const, at: '20%', emblem: 'M11 34l18 18M29 34L11 52' },
    { tone: '#7dd6ff', side: 'right' as const, at: '20%', emblem: 'M20 30l3.5 7.5 8 1-6 5.5 1.6 8-7.1-4-7.1 4 1.6-8-6-5.5 8-1z' },
    { tone: '#ffd25a', side: 'right' as const, at: '6%', emblem: 'M9 52l-2-16 8 7 5-11 5 11 8-7-2 16z' },
];

const Crowd: React.FC = () => (
    <svg className={styles.crowd} viewBox="0 0 1000 120" preserveAspectRatio="xMidYMax slice" aria-hidden>
        {CROWD_ROWS.map(({ y, scale }, row) => {
            const fans: React.ReactNode[] = [];
            for (let x = 8 + row * 9; x < 1000; x += 21 + (x % 5)) {
                const j = (x * 13 + row * 7) % 9;
                const delay = -(((x * 7 + row * 3) % 16) / 10);
                fans.push(
                    <g key={`${row}-${x}`} className={styles.fan} style={{ animationDelay: `${delay}s` }}>
                        <ellipse cx={x} cy={y + 13} rx={11 * scale} ry="10" fill={CROWD_SHADES[j % 4]} />
                        <circle cx={x} cy={y - 1 + (j % 3)} r={7 * scale} fill={CROWD_SHADES[(j + 1) % 4]} />
                        {(j === 2 || j === 6) && (
                            <line
                                className={styles.stick}
                                style={{ animationDelay: `${delay}s` }}
                                x1={x + 8}
                                y1={y + 2}
                                x2={x + 12}
                                y2={y - 14}
                                stroke={GLOWSTICKS[(x + row) % 4]}
                                strokeWidth="3"
                                strokeLinecap="round"
                            />
                        )}
                    </g>,
                );
            }
            return <g key={row}>{fans}</g>;
        })}
    </svg>
);

const Stars: React.FC = () => (
    <>
        {STARS.map((s, i) => (
            <span
                key={i}
                className={styles.star}
                style={{ left: `${s.left}%`, top: `${s.top}%`, animationDelay: `${s.delay}s` }}
            />
        ))}
    </>
);

/**
 * The world behind every page: the arena for battles, the nest for breeding and marriage,
 * the Hall of Champions for the leaderboard, the market for the bag, and the Shore at night
 * for everything else. Pure decoration in CSS and SVG; `dim` darkens it under a page's panels.
 */
const SceneBackdrop: React.FC<{ scene: Scene; dim?: boolean }> = ({ scene, dim = false }) => (
    <div className={clsx(styles.backdrop, styles[scene])} aria-hidden>
        {scene === 'shore' && (
            <>
                <Stars />
                <div className={styles.sea} />
                <div className={styles.sand} />
            </>
        )}
        {scene === 'arena' && (
            <>
                <div className={clsx(styles.spot, styles.spotLeft)} />
                <div className={clsx(styles.spot, styles.spotRight)} />
                <Crowd />
                {BANNERS.map((b) => (
                    <span
                        key={b.tone}
                        className={styles.banner}
                        style={{ [b.side]: b.at, color: b.tone } as React.CSSProperties}
                    >
                        <svg viewBox="0 0 40 110">
                            <path d="M0 0h40v92l-20 18-20-18z" fill="currentColor" />
                            <path d="M0 8h40" stroke="#fff" strokeOpacity=".4" strokeWidth="2" />
                            <path d={b.emblem} fill="#fff" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" />
                        </svg>
                    </span>
                ))}
                <div className={styles.floor} />
                <span className={clsx(styles.torch, styles.torchLeft)}>
                    <i />
                </span>
                <span className={clsx(styles.torch, styles.torchRight)}>
                    <i />
                </span>
            </>
        )}
        {scene === 'nest' && (
            <>
                <Stars />
                <div className={styles.rock} />
            </>
        )}
        {scene === 'hall' && (
            <>
                <span className={clsx(styles.pillar, styles.pillarLeft)} />
                <span className={clsx(styles.pillar, styles.pillarRight)} />
                <span className={styles.rays} />
            </>
        )}
        {scene === 'market' && (
            <>
                <Stars />
                <div className={styles.awning} />
                {[14, 32, 50, 68, 86].map((x, i) => (
                    <span key={x} className={styles.lantern} style={{ left: `${x}%`, animationDelay: `${-i * 0.7}s` }} />
                ))}
            </>
        )}
        {dim && <div className={styles.dim} />}
    </div>
);

export default SceneBackdrop;
