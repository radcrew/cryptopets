import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

import { useSound } from '@contexts/sound';
import styles from './index.module.css';

/** Once a session: a title screen is a welcome, not a gate to pass on every visit home. */
const STORAGE_KEY = 'cp.title.entered';
/** How long the title takes to fade away after the tap. */
const LEAVE_MS = 500;

const readEntered = (): boolean => {
    try {
        return globalThis.sessionStorage?.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

const rememberEntered = () => {
    try {
        globalThis.sessionStorage?.setItem(STORAGE_KEY, 'true');
    } catch {
        // Storage can be blocked. Then the title shows again next visit, which is harmless.
    }
};

/** Fixed rather than random, so the sky is the same on every visit. */
const STARS = Array.from({ length: 40 }, (_, i) => ({
    left: (i * 41.3) % 100,
    top: (i * 17.9) % 100,
    delay: -((i * 0.53) % 3),
}));

/**
 * The title screen: the game's name over a night sky, and one tap to enter the Shore.
 *
 * Shown on the home page once a browser session; a link straight to any other page skips it.
 * The tap is also the gesture browsers require before a page may play sound, so the game's
 * sound starts with the jingle that plays on entering.
 */
const TitleScreen: React.FC = () => {
    const { play } = useSound();
    const [stage, setStage] = useState<'shown' | 'leaving' | 'gone'>(() => (readEntered() ? 'gone' : 'shown'));
    const dialog = useRef<HTMLDivElement>(null);

    const enter = () => {
        if (stage !== 'shown') return;
        play('levelUp');
        rememberEntered();
        setStage('leaving');
    };
    const enterRef = useRef(enter);
    enterRef.current = enter;

    // Focus goes to the screen rather than its button, so no focus ring frames the logo on
    // load; Enter or Space on the screen enters, as on any title screen. Keys aimed at the
    // button are left to it, which already turns them into a click.
    useEffect(() => {
        dialog.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.target === dialog.current && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                enterRef.current();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (stage !== 'leaving') return undefined;
        const timer = setTimeout(() => setStage('gone'), LEAVE_MS);
        return () => clearTimeout(timer);
    }, [stage]);

    if (stage === 'gone') return null;

    return createPortal(
        <div
            ref={dialog}
            className={clsx(styles.title, stage === 'leaving' && styles.leaving)}
            role="dialog"
            aria-modal="true"
            aria-label="Crypto Pets"
            tabIndex={-1}
        >
            <div className={styles.sky} aria-hidden>
                {STARS.map((s, i) => (
                    <span
                        key={i}
                        className={styles.star}
                        style={{ left: `${s.left}%`, top: `${s.top}%`, animationDelay: `${s.delay}s` }}
                    />
                ))}
            </div>
            <button
                type="button"
                className={styles.enter}
                onClick={enter}
                aria-label="Tap to enter the Quiet Shore"
            >
                <span className={styles.logo}>
                    Crypto
                    <br />
                    Pets
                </span>
                <span className={styles.tagline}>The Quiet Shore</span>
                <span className={styles.tap}>Tap to enter</span>
            </button>
            <p className={styles.note}>Sound starts when you tap in. The speaker key at the top mutes it.</p>
        </div>,
        document.body,
    );
};

export default TitleScreen;
