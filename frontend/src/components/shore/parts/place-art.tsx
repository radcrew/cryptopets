import React from 'react';

import styles from './places.module.css';

/*
 * Drawn art for each place on the Shore. Pure SVG over the gradients in ShoreDefs;
 * the only motion is CSS (flags, flames, the floating trophy), so nothing here
 * re-renders on its own.
 */

/** y of the arena's curved top edge at x, matching its `Q110 2` path. */
const arenaTop = (x: number) => {
    const t = (x - 10) / 200;
    return 70 - 136 * t * (1 - t);
};

export const HallArt: React.FC = () => (
    <svg viewBox="0 0 160 190" preserveAspectRatio="xMidYMax meet" aria-hidden>
        <path className={styles.glow} d="M80 58 L42 -40 H118 Z" fill="#ffd25a" fillOpacity=".12" />
        <rect x="18" y="183" width="124" height="7" rx="3.5" fill="url(#shore-marble)" stroke="#5b4d9a" />
        <rect x="26" y="174" width="108" height="10" rx="2" fill="url(#shore-marble)" stroke="#5b4d9a" />
        <rect x="34" y="165" width="92" height="10" rx="2" fill="url(#shore-marble)" stroke="#5b4d9a" />
        <rect className={styles.glow} x="50" y="110" width="60" height="55" fill="#ffd25a" fillOpacity=".2" />
        {[40, 60, 90, 110].map((x) => (
            <g key={x}>
                <rect x={x} y="110" width="10" height="55" fill="url(#shore-marble)" stroke="#6b5cb0" />
                <rect x={x - 2} y="106" width="14" height="5" fill="url(#shore-gold)" />
            </g>
        ))}
        <path d="M30 106 H130 L122 96 H38 Z" fill="url(#shore-gold)" stroke="#a86a10" strokeWidth=".8" />
        <path d="M44 96 Q80 44 116 96 Z" fill="url(#shore-marble)" stroke="#ffd25a" strokeWidth="1.6" />
        <path d="M58 96 Q80 62 102 96 M70 96 Q80 76 90 96" fill="none" stroke="#ffd25a" strokeOpacity=".45" />
        <path d="M80 70 V55" stroke="#ffd25a" strokeWidth="2" />
        <g className={styles.float}>
            <path d="M71 30 H65 a5 5 0 0 0 6 7 M89 30 H95 a5 5 0 0 1 -6 7" fill="none" stroke="#e0a83a" strokeWidth="2.2" />
            <path d="M70 26 H90 V34 A10 10 0 0 1 70 34 Z" fill="url(#shore-gold)" stroke="#a86a10" />
            <rect x="77" y="44" width="6" height="6" fill="url(#shore-gold-dark)" />
            <rect x="72" y="50" width="16" height="5" rx="1" fill="url(#shore-gold-dark)" />
            <path className={styles.sparkle} d="M80 10 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z" fill="#fff" />
        </g>
        <path d="M38 96 V74" stroke="#cfd3e6" strokeWidth="1.2" />
        <path className={styles.flag} d="M38 74 l14 4 -14 4 z" fill="#ff7bcb" />
        <path d="M122 96 V74" stroke="#cfd3e6" strokeWidth="1.2" />
        <path className={styles.flag} d="M122 74 l14 4 -14 4 z" fill="#7dd6ff" />
    </svg>
);

/** Stone tiers, narrowing to a spire, each with its own flag. */
const TOWER_TIERS: [number, number, number, number, string][] = [
    [26, 94, 236, 320, '#7dd6ff'],
    [32, 88, 162, 228, '#b58cff'],
    [38, 82, 98, 154, '#ff7bcb'],
];
const TOWER_WINDOWS = [[40, 256], [74, 256], [57, 276], [44, 180], [70, 180], [57, 200], [50, 116], [64, 116], [57, 134]];

/** The Tower on the horizon: a planned mode, so it stands in the distance. */
export const TowerArt: React.FC = () => (
    <svg viewBox="0 0 120 320" preserveAspectRatio="xMidYMax meet" aria-hidden>
        <path d="M0 320 Q60 294 120 320 Z" fill="#141a3e" />
        {TOWER_TIERS.map(([x1, x2, y1, y2, flag], i) => (
            <g key={y1}>
                <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="#202a62" stroke="#2c3a7a" />
                <rect x={x1 - 4} y={y1 - 4} width={x2 - x1 + 8} height="5" fill="#33408a" />
                {Array.from({ length: Math.floor((x2 - x1 + 8) / 10) }, (_, k) => (
                    <rect key={k} x={x1 - 4 + k * 10} y={y1 - 10} width="6" height="6" fill="#33408a" />
                ))}
                <path d={`M${x2 + 2} ${y1 - 10} v-16`} stroke="#cfd6ee" strokeWidth="1.2" />
                <path
                    className={styles.flag}
                    style={{ animationDelay: `-${i * 0.5}s` }}
                    d={`M${x2 + 2} ${y1 - 26} l12 3 -12 4z`}
                    fill={flag}
                />
            </g>
        ))}
        {TOWER_WINDOWS.map(([x, y], i) => (
            <rect
                key={i}
                className={styles.window}
                style={{ animationDelay: `-${(i * 0.7).toFixed(1)}s`, fill: '#ffcf70' }}
                x={x - 3}
                y={y}
                width="6"
                height="8"
                rx="3"
            />
        ))}
        <path d="M52 320 V302 a8 8 0 0 1 16 0 V320 Z" fill="#ffcf70" />
        <path d="M42 92 L60 50 L78 92 Z" fill="#202a62" stroke="#2c3a7a" />
        <g className={styles.float}>
            <circle cx="60" cy="26" r="17" fill="#7dd6ff" fillOpacity=".22" />
            <path d="M60 9 L69 26 L60 43 L51 26 Z" fill="#a6e6ff" stroke="#e6f7ff" strokeWidth=".8" />
        </g>
    </svg>
);

const ARENA_FLAGS = ['#ff7bcb', '#b58cff', '#ffd25a', '#7dd6ff', '#0fffae'];

export const ArenaArt: React.FC = () => (
    <svg viewBox="0 0 220 150" aria-hidden>
        <path className={styles.spotLeft} d="M84 70 L40 -80 L96 -80 Z" fill="#ff7bcb" fillOpacity=".16" />
        <path className={styles.spotRight} d="M136 70 L124 -80 L180 -80 Z" fill="#7dd6ff" fillOpacity=".16" />
        <path d="M10 148 V70 Q110 2 210 70 V148 Z" fill="url(#shore-arena-wall)" stroke="#ff7bcb" strokeOpacity=".55" strokeWidth="1.2" />
        <path d="M10 82 Q110 14 210 82" fill="none" stroke="#ff7bcb" strokeOpacity=".35" strokeWidth="1.2" />
        {Array.from({ length: 11 }, (_, i) => 24 + i * 16).map((x, i) => {
            const y = arenaTop(x) + 15;
            return (
                <path
                    key={x}
                    className={styles.window}
                    style={{ animationDelay: `-${(i * 0.37).toFixed(2)}s` }}
                    d={`M${x - 4} ${y + 10} v-6 a4 4 0 0 1 8 0 v6 z`}
                />
            );
        })}
        <path d="M10 102 H210" stroke="#ff7bcb" strokeOpacity=".45" strokeWidth="2" />
        {[22, 46, 70, 150, 174, 198].map((x) => (
            <path key={x} d={`M${x - 9} 148 V120 a9 9 0 0 1 18 0 V148 Z`} fill="#12081f" stroke="#ff9ad8" strokeOpacity=".6" />
        ))}
        <path className={styles.glow} d="M93 148 V112 a17 17 0 0 1 34 0 V148 Z" fill="url(#shore-gate)" stroke="#ffd25a" strokeWidth="1.5" />
        <circle cx="110" cy="84" r="12" fill="#ff7bcb" fillOpacity=".28" stroke="#ff7bcb" />
        <path d="M103 77 L117 91 M117 77 L103 91" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        {[30, 70, 110, 150, 190].map((x, i) => {
            const y = arenaTop(x);
            return (
                <g key={x}>
                    <path d={`M${x} ${y} v-16`} stroke="#e8e0f6" strokeWidth="1.2" />
                    <path
                        className={styles.flag}
                        style={{ animationDelay: `-${i * 0.3}s` }}
                        d={`M${x} ${y - 16} l13 3 -13 4z`}
                        fill={ARENA_FLAGS[i]}
                    />
                </g>
            );
        })}
        {[4, 216].map((x) => (
            <g key={x}>
                <circle cx={x} cy="98" r="15" fill="#ff8a50" fillOpacity=".22" />
                <rect x={x - 2} y="104" width="4" height="44" fill="#5a3a20" />
                <ellipse className={styles.flame} cx={x} cy="97" rx="5.5" ry="9" fill="url(#shore-flame)" />
            </g>
        ))}
    </svg>
);

/** Three tents for the squads, the middle one flying the 3v3 pennant. */
const TENTS: [number, number, number, number, string][] = [
    [6, 66, 36, 54, '#7dd6ff'],
    [104, 164, 134, 54, '#b58cff'],
    [50, 120, 85, 30, '#ff7bcb'],
];

export const TeamCampArt: React.FC = () => (
    <svg viewBox="0 0 170 124" aria-hidden>
        {TENTS.map(([x1, x2, ax, ay, color]) => (
            <g key={ax}>
                <path d={`M${x1} 114 L${ax} ${ay} L${x2} 114 Z`} fill={color} fillOpacity=".88" stroke="#1a0b2e" strokeOpacity=".45" />
                <path d={`M${ax} ${ay} L${ax} 114`} stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" />
                <path d={`M${ax - 9} 114 L${ax} ${ay + 34} L${ax + 9} 114 Z`} fill="#1a0b2e" fillOpacity=".65" />
                <path d={`M${ax} ${ay} v-14`} stroke="#e8e0f6" strokeWidth="1.2" />
                <path className={styles.flag} d={`M${ax} ${ay - 14} l13 3 -13 4z`} fill={color} />
            </g>
        ))}
        <text x="88" y="11" className={styles.pennant}>
            3V3
        </text>
        <path d="M76 120 L94 116 M76 116 L94 120" stroke="#5a3a20" strokeWidth="3" strokeLinecap="round" />
        <ellipse className={styles.flame} cx="85" cy="110" rx="6" ry="10" fill="url(#shore-flame)" />
    </svg>
);

export const NestArt: React.FC = () => (
    <svg viewBox="0 0 120 110" aria-hidden>
        <ellipse className={styles.glow} cx="60" cy="58" rx="40" ry="34" fill="#ffcf70" fillOpacity=".28" />
        <path d="M38 70c0-22 10-44 22-44s22 22 22 44a22 22 0 0 1-44 0z" fill="url(#shore-egg)" stroke="#ffcf70" strokeWidth="2" />
        <circle cx="52" cy="54" r="3" fill="#fff" fillOpacity=".8" />
        <circle cx="66" cy="70" r="4" fill="#e0a03a" fillOpacity=".5" />
        <circle cx="56" cy="78" r="2.5" fill="#e0a03a" fillOpacity=".5" />
        <path
            d="M14 84c14 14 78 14 92 0M10 78c18 20 82 20 100 0M18 92c14 10 70 10 84 0"
            fill="none"
            stroke="url(#shore-wood)"
            strokeWidth="6"
            strokeLinecap="round"
        />
    </svg>
);

/** A straw training dummy with a target, and a sword stuck in the sand. */
export const TrainingArt: React.FC = () => (
    <svg viewBox="0 0 120 130" aria-hidden>
        <rect x="56" y="40" width="8" height="82" rx="2" fill="url(#shore-wood)" />
        <rect x="26" y="52" width="68" height="7" rx="3" fill="url(#shore-wood)" />
        <ellipse cx="60" cy="76" rx="20" ry="26" fill="#d9b27a" stroke="#8a5a2c" strokeWidth="2" />
        <path d="M42 68 H78 M42 86 H78" stroke="#8a5a2c" strokeWidth="2" strokeOpacity=".6" />
        <circle cx="60" cy="76" r="10" fill="#ff7bcb" fillOpacity=".9" />
        <circle cx="60" cy="76" r="4.5" fill="#fff" />
        <circle cx="60" cy="30" r="12" fill="#d9b27a" stroke="#8a5a2c" strokeWidth="2" />
        <path d="M53 26 l4 4 M57 26 l-4 4 M63 26 l4 4 M67 26 l-4 4" stroke="#5a3a20" strokeWidth="1.6" />
        <path d="M100 122 L104 84" stroke="#e8eeff" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M97 92 L110 94" stroke="url(#shore-gold)" strokeWidth="3.5" strokeLinecap="round" />
        <path className={styles.sparkle} d="M106 74 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1z" fill="#fff" />
    </svg>
);

/** Runes on the tall stone, top to bottom: a glyph, then its line of carving. */
const RUNE_ROWS = [30, 46, 62, 78];

/** The Ledger Stones: three standing stones, the tallest carved with runes that glow in turn. */
export const StonesArt: React.FC = () => (
    <svg viewBox="0 0 120 110" aria-hidden>
        <path d="M10 104 V60 C10 51 16 46 24 46 S38 51 38 60 V104 Z" fill="url(#shore-stone)" stroke="#2c3a7a" />
        <path d="M82 104 V64 C82 56 88 52 95 52 S108 56 108 64 V104 Z" fill="url(#shore-stone)" stroke="#2c3a7a" />
        <path d="M38 104 V26 C38 14 48 6 60 6 S82 14 82 26 V104 Z" fill="url(#shore-stone)" stroke="#6b5cb0" />
        <path d="M43 26 C43 17 50 11 60 11" stroke="#fff" strokeOpacity=".2" strokeWidth="2" fill="none" strokeLinecap="round" />
        {RUNE_ROWS.map((y, i) => (
            <g key={y} className={styles.rune} style={{ animationDelay: `${i * 0.5}s` }}>
                <circle cx="50" cy={y} r="3" fill="#b58cff" />
                <path d={`M57 ${y} H${i % 2 ? 68 : 72}`} stroke="#d9c8ff" strokeWidth="2.4" strokeLinecap="round" />
            </g>
        ))}
        <path d="M17 64 H31 M17 72 H28 M89 68 H101" stroke="#9aa0c0" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

const AWNING = ['#ff7bcb', '#ffd25a'];

/** A market stall, with the player's satchel and a couple of tonics on the counter. */
export const BagArt: React.FC = () => (
    <svg viewBox="0 0 150 124" aria-hidden>
        <rect x="16" y="28" width="5" height="88" fill="url(#shore-wood)" />
        <rect x="129" y="28" width="5" height="88" fill="url(#shore-wood)" />
        <rect x="12" y="18" width="126" height="9" rx="3" fill="#3a1d58" />
        {Array.from({ length: 7 }, (_, i) => (
            <path key={i} d={`M${14 + i * 17.4} 26 h17.4 v14 a8.7 8.7 0 0 1 -17.4 0 z`} fill={AWNING[i % 2]} />
        ))}
        <path d="M46 80 L42 64 h10 v-6 h6 v6 h10 L64 80 Z" fill="#7dd6ff" fillOpacity=".85" />
        <path d="M100 80 l-2 -14 h4 v-5 h5 v5 h4 l-2 14 Z" fill="#0fffae" fillOpacity=".8" />
        <path d="M66 80 Q86 72 106 80 L103 56 Q86 50 69 56 Z" fill="url(#shore-leather)" stroke="#4a2808" strokeWidth="1.4" />
        <path d="M69 56 Q86 50 103 56 L101 66 Q86 70 71 66 Z" fill="#d98c46" stroke="#4a2808" strokeWidth="1.2" />
        <rect x="82" y="62" width="8" height="8" rx="2" fill="url(#shore-gold)" stroke="#8a5a10" />
        <rect x="10" y="80" width="130" height="36" rx="4" fill="url(#shore-wood)" />
        <rect x="10" y="78" width="130" height="6" rx="2" fill="#c08a5a" />
        <path className={styles.sparkle} d="M60 48 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1z" fill="#fff" />
    </svg>
);
