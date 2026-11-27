import React from 'react';

/*
 * The dock's drawn keys, from the game-feel prototype. Gradients live once in DockDefs;
 * zero-sized rather than display:none, because Chrome does not paint a gradient defined
 * inside an undisplayed SVG.
 */
export const DockDefs: React.FC = () => (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
        <defs>
            <linearGradient id="dock-leather" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#b8743a" />
                <stop offset="1" stopColor="#6b3a14" />
            </linearGradient>
            <linearGradient id="dock-flap" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#d98c46" />
                <stop offset="1" stopColor="#94521f" />
            </linearGradient>
            <linearGradient id="dock-gold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff4c2" />
                <stop offset=".5" stopColor="#ffd25a" />
                <stop offset="1" stopColor="#c8891c" />
            </linearGradient>
            <linearGradient id="dock-gold-dark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e0a83a" />
                <stop offset="1" stopColor="#7a4a0c" />
            </linearGradient>
            <linearGradient id="dock-gem-green" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#c8ffe9" />
                <stop offset="1" stopColor="#0fbf85" />
            </linearGradient>
            <linearGradient id="dock-gem-pink" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffd6f0" />
                <stop offset="1" stopColor="#e0308f" />
            </linearGradient>
            <linearGradient id="dock-blade" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#a9b8de" />
            </linearGradient>
            <radialGradient id="dock-egg" cx="38%" cy="32%" r="75%">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset=".35" stopColor="#fff0c4" />
                <stop offset="1" stopColor="#f0b245" />
            </radialGradient>
            <linearGradient id="dock-twig" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#a8754e" />
                <stop offset="1" stopColor="#5a3a20" />
            </linearGradient>
        </defs>
    </svg>
);

export const BagIcon: React.FC = () => (
    <svg viewBox="0 0 48 48" aria-hidden>
        <path d="M16 15 q8 -11 16 0" fill="none" stroke="#7a4a1e" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M29 9 l4.5 -5 4.5 5 -4.5 5z" fill="url(#dock-gem-green)" stroke="#fff" strokeWidth=".7" />
        <path d="M7 18 Q24 12 41 18 L39 39 Q24 45 9 39 Z" fill="url(#dock-leather)" stroke="#4a2808" strokeWidth="1.4" />
        <path d="M7 18 Q24 12 41 18 L38 28 Q24 32 10 28 Z" fill="url(#dock-flap)" stroke="#4a2808" strokeWidth="1.4" />
        <rect x="20" y="25" width="8" height="8" rx="2" fill="url(#dock-gold)" stroke="#8a5a10" />
        <circle cx="24" cy="29" r="1.5" fill="#6b3a14" />
    </svg>
);

export const NestIcon: React.FC = () => (
    <svg viewBox="0 0 48 48" aria-hidden>
        <ellipse cx="24" cy="21" rx="15" ry="14" fill="#ffeca8" opacity=".35" />
        <path d="M14 27 C14 16 18.5 6 24 6 S34 16 34 27 A10 10 0 0 1 14 27 Z" fill="url(#dock-egg)" stroke="#d49a3a" />
        <ellipse cx="20" cy="15" rx="2.4" ry="3.4" fill="#fff" opacity=".85" />
        <circle cx="28" cy="25" r="2.2" fill="#ffb347" opacity=".7" />
        <circle cx="21" cy="29" r="1.5" fill="#ffb347" opacity=".7" />
        <path d="M4 29 Q24 46 44 29 L42 36 Q24 50 6 36 Z" fill="url(#dock-twig)" stroke="#3a2412" />
        <path d="M7 33 Q24 44 41 33 M9 37 Q24 46 39 37" fill="none" stroke="#d4a070" strokeWidth="1.1" opacity=".8" />
    </svg>
);

export const SwordsIcon: React.FC = () => (
    <svg viewBox="0 0 48 48" aria-hidden>
        <circle cx="24" cy="22" r="13" fill="#fff" opacity=".16" />
        <path d="M9 7 L33 31 M39 7 L15 31" stroke="url(#dock-blade)" strokeWidth="5" strokeLinecap="round" />
        <path d="M28 36 L37 27 M11 27 L20 36" stroke="url(#dock-gold)" strokeWidth="4" strokeLinecap="round" />
        <path d="M34 33 L39 38 M14 33 L9 38" stroke="#6a2fa0" strokeWidth="5" strokeLinecap="round" />
        <circle cx="40.5" cy="39.5" r="3.2" fill="url(#dock-gold)" />
        <circle cx="7.5" cy="39.5" r="3.2" fill="url(#dock-gold)" />
        <path d="M24 16.5 L28 22 L24 27.5 L20 22 Z" fill="url(#dock-gem-pink)" stroke="#fff" strokeWidth=".8" />
    </svg>
);

export const TrophyIcon: React.FC = () => (
    <svg viewBox="0 0 48 48" aria-hidden>
        <path d="M15 11 H9 a6 6 0 0 0 7 9 M33 11 H39 a6 6 0 0 1 -7 9" fill="none" stroke="#e0a83a" strokeWidth="3" />
        <path d="M14 6 H34 V15 A10 10 0 0 1 14 15 Z" fill="url(#dock-gold)" stroke="#a86a10" />
        <path d="M24 8.5 l1.7 3.4 3.7 .5 -2.7 2.6 .6 3.7 -3.3 -1.8 -3.3 1.8 .6 -3.7 -2.7 -2.6 3.7 -.5z" fill="#fff6c8" />
        <path d="M21 25 H27 V31 H21 Z" fill="url(#dock-gold-dark)" />
        <path d="M15 31 H33 L35 40 H13 Z" fill="url(#dock-gold-dark)" stroke="#7a4a0c" />
        <path d="M13 40 L9 47 L14 45.5 L16 48 L19 40 M35 40 L39 47 L34 45.5 L32 48 L29 40" fill="#ff7bcb" />
    </svg>
);

/** A paw print in the pet's own colours: the collection. */
export const PawIcon: React.FC = () => (
    <svg viewBox="0 0 48 48" aria-hidden>
        <circle cx="24" cy="24" r="20" fill="#fff" opacity=".14" />
        <ellipse cx="24" cy="31" rx="9" ry="8" fill="#fff6fb" stroke="#ff7bcb" strokeWidth="1.5" />
        {[
            [13, 21],
            [19.5, 13],
            [28.5, 13],
            [35, 21],
        ].map(([cx, cy]) => (
            <ellipse key={cx} cx={cx} cy={cy} rx="4" ry="5" fill="#fff6fb" stroke="#ff7bcb" strokeWidth="1.5" />
        ))}
    </svg>
);

/** Four coloured tiles: every other page. */
export const MoreIcon: React.FC = () => (
    <svg viewBox="0 0 48 48" aria-hidden>
        {[
            [9, 9, '#7dd6ff'],
            [27, 9, '#ff7bcb'],
            [9, 27, '#ffd25a'],
            [27, 27, '#0fffae'],
        ].map(([x, y, fill]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="12" height="12" rx="3.5" fill={fill as string} stroke="#fff" strokeOpacity=".5" />
        ))}
    </svg>
);
