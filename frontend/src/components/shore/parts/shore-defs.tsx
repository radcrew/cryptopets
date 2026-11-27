import React from 'react';

/**
 * Gradients shared by every place on the Shore, defined once.
 *
 * Zero-sized rather than `display: none`: Chrome does not paint a gradient whose
 * definition sits inside an undisplayed SVG, so a hidden defs block draws nothing.
 * The ids are prefixed because they are document-global.
 */
const ShoreDefs: React.FC = () => (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
        <defs>
            <linearGradient id="shore-gold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff4c2" />
                <stop offset=".5" stopColor="#ffd25a" />
                <stop offset="1" stopColor="#c8891c" />
            </linearGradient>
            <linearGradient id="shore-gold-dark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e0a83a" />
                <stop offset="1" stopColor="#7a4a0c" />
            </linearGradient>
            <linearGradient id="shore-marble" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#433a80" />
                <stop offset="1" stopColor="#1c1844" />
            </linearGradient>
            <linearGradient id="shore-arena-wall" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5e2c78" />
                <stop offset="1" stopColor="#22103c" />
            </linearGradient>
            <radialGradient id="shore-gate" cx="50%" cy="65%" r="65%">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset=".3" stopColor="#ffb3e3" />
                <stop offset=".7" stopColor="#ff4fae" />
                <stop offset="1" stopColor="#5a1040" />
            </radialGradient>
            <radialGradient id="shore-flame" cx="50%" cy="70%" r="60%">
                <stop offset="0" stopColor="#fff6c8" />
                <stop offset=".4" stopColor="#ffcf70" />
                <stop offset=".8" stopColor="#ff7a59" />
                <stop offset="1" stopColor="#ff7a59" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="shore-egg" cx="38%" cy="32%" r="75%">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset=".35" stopColor="#fff0c4" />
                <stop offset="1" stopColor="#f0b245" />
            </radialGradient>
            <linearGradient id="shore-wood" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#a8754e" />
                <stop offset="1" stopColor="#5a3a20" />
            </linearGradient>
            <linearGradient id="shore-leather" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#c27a36" />
                <stop offset="1" stopColor="#6b3a14" />
            </linearGradient>
        </defs>
    </svg>
);

export default ShoreDefs;
