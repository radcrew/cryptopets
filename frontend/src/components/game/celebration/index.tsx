import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

import NeonButton from '@components/ui/neon-button';
import { useSound, type SoundName } from '@contexts/sound';
import styles from './index.module.css';

/** Taps it takes to crack an egg: enough to feel earned, few enough not to be a chore. */
const EGG_TAPS = 3;
/** How long the egg bursts or the chest lid flies open before the reveal. */
const OPEN_MS = 650;

type Stage = 'intro' | 'opening' | 'reveal';

type CelebrationProps = {
    /** Stamped across the card on the reveal, and the dialog's accessible name. */
    title: string;
    sub?: React.ReactNode;
    /** The pet or item being celebrated. */
    art?: React.ReactNode;
    /** Glow, rays and frame colour: usually the pet's or the item's rarity colour. */
    tone?: string;
    /** Played on the reveal. */
    sound: SoundName;
    /** A tap-to-open moment before the reveal: crack an egg, or open a chest. */
    intro?: 'egg' | 'chest';
    onClose: () => void;
    /** Anything extra under the subtitle, such as an XP bar. */
    children?: React.ReactNode;
};

/**
 * A reward moment over the page: rays, the pet or item, a stamped title, its sound.
 *
 * Purely a celebration of something that has already happened. Every caller opens it from
 * a success the feature already reported, and closing it changes nothing. Escape closes it
 * at any stage, so the egg and the chest never stand between a player and the page.
 */
const Celebration: React.FC<CelebrationProps> = ({ title, sub, art, tone, sound, intro, onClose, children }) => {
    const { play } = useSound();
    const [stage, setStage] = useState<Stage>(intro ? 'intro' : 'reveal');
    const [taps, setTaps] = useState(0);
    const card = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (stage !== 'opening') return undefined;
        const timer = setTimeout(() => setStage('reveal'), OPEN_MS);
        return () => clearTimeout(timer);
    }, [stage]);

    useEffect(() => {
        if (stage === 'reveal') play(sound);
    }, [stage, sound, play]);

    // Focus follows the stage: the egg or chest first, then the button that closes the card.
    useEffect(() => {
        card.current?.querySelector('button')?.focus();
    }, [stage]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const tapIntro = () => {
        play('crack');
        if (intro === 'chest') {
            setStage('opening');
            return;
        }
        const next = taps + 1;
        setTaps(next);
        if (next >= EGG_TAPS) setStage('opening');
    };

    return createPortal(
        <div className={styles.veil}>
            <div
                ref={card}
                className={styles.card}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                style={tone ? ({ '--tone': tone } as React.CSSProperties) : undefined}
            >
                {stage === 'reveal' ? (
                    <>
                        <span className={styles.rays} aria-hidden />
                        {art && <div className={styles.art}>{art}</div>}
                        <h2 className={styles.title}>{title}</h2>
                        {sub && <p className={styles.sub}>{sub}</p>}
                        {children}
                        <NeonButton tone="amber" onClick={onClose}>
                            Nice!
                        </NeonButton>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            className={clsx(styles.intro, stage === 'opening' && styles.opening)}
                            onClick={tapIntro}
                            disabled={stage === 'opening'}
                            aria-label={
                                intro === 'egg'
                                    ? `Tap the egg to crack it, ${EGG_TAPS - taps} more`
                                    : 'Open the chest'
                            }
                        >
                            {intro === 'egg' ? <Egg cracks={taps} /> : <Chest open={stage === 'opening'} />}
                        </button>
                        <p className={styles.hint}>
                            {intro === 'egg' ? `Tap the egg · ${taps} / ${EGG_TAPS}` : 'Tap to open'}
                        </p>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
};

/** Crack lines, in the order the taps reveal them. */
const CRACKS = [
    'M50 18 L44 34 L54 44 L46 58',
    'M46 58 L36 66 L42 78 M54 44 L66 52 L60 64',
    'M42 78 L30 88 M60 64 L72 76 L64 90 M36 66 L22 64',
];

/** The egg, wobbling on each tap; keyed by the crack count so every tap replays the wobble. */
const Egg: React.FC<{ cracks: number }> = ({ cracks }) => (
    <svg key={cracks} className={styles.egg} viewBox="0 0 100 128" aria-hidden>
        <path
            d="M50 4 C76 4 94 52 94 82 A44 44 0 0 1 6 82 C6 52 24 4 50 4 Z"
            fill="url(#celebration-egg)"
            stroke="#ffcf70"
            strokeWidth="2"
        />
        <defs>
            <radialGradient id="celebration-egg" cx="36%" cy="30%" r="75%">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset=".3" stopColor="#fff4d6" />
                <stop offset="1" stopColor="#ffb347" />
            </radialGradient>
        </defs>
        <ellipse cx="38" cy="40" rx="6" ry="9" fill="#fff" opacity=".7" />
        <circle cx="62" cy="70" r="6" fill="#ff9f3a" opacity=".45" />
        <circle cx="40" cy="92" r="4" fill="#ff9f3a" opacity=".45" />
        {CRACKS.slice(0, cracks).map((d) => (
            <path key={d} d={d} fill="none" stroke="#5a2a10" strokeWidth="2.6" strokeLinecap="round" />
        ))}
    </svg>
);

const Chest: React.FC<{ open: boolean }> = ({ open }) => (
    <span className={clsx(styles.chest, open && styles.chestOpen)} aria-hidden>
        <span className={styles.beam} />
        <span className={styles.box} />
        <span className={styles.lid} />
        <span className={styles.lock} />
    </span>
);

export default Celebration;
