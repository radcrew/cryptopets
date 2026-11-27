import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { createSynth, type SoundName } from './synth';

export type { SoundName } from './synth';

type SoundContextValue = {
    muted: boolean;
    toggleMuted: () => void;
    play: (name: SoundName) => void;
};

/** Outside the provider (tests, previews) everything is silent rather than an error:
 *  sound is decoration, and no component should fail to render for want of it. */
const SILENT: SoundContextValue = { muted: true, toggleMuted: () => {}, play: () => {} };

const SoundContext = createContext<SoundContextValue>(SILENT);

/** A stated preference, so it survives a reload. */
const STORAGE_KEY = 'cp.sound.muted';

const readStored = (): boolean => {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

/**
 * Game sound effects for the whole app.
 *
 * Every enabled button plays a tap, from one capture-phase listener here rather than from
 * each component, so the feedback is uniform and no feature has to opt in. Anything with a
 * richer cue (a toast, later a battle) calls `play` through `useSound`.
 */
export const SoundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [muted, setMuted] = useState(readStored);
    const [synth] = useState(createSynth);
    const mutedRef = useRef(muted);

    useEffect(() => {
        mutedRef.current = muted;
        try {
            globalThis.localStorage?.setItem(STORAGE_KEY, String(muted));
        } catch {
            // A preference that cannot be saved still applies for this session.
        }
    }, [muted]);

    const play = useCallback(
        (name: SoundName) => {
            if (!mutedRef.current) synth.play(name);
        },
        [synth],
    );

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target.closest('button') : null;
            if (target && !target.disabled) play('tap');
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [play]);

    const toggleMuted = useCallback(() => setMuted((m) => !m), []);
    const value = useMemo(() => ({ muted, toggleMuted, play }), [muted, toggleMuted, play]);

    return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
};

export const useSound = (): SoundContextValue => useContext(SoundContext);
