import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useBattleConfig, useChainCapabilities, usePetList } from '@shared/core';

import PulseOrb from '@components/game/pulse-orb';
import { useParty } from '@contexts/party';
import Places from './parts/places';
import ShoreDefs from './parts/shore-defs';
import ShorePet from './parts/shore-pet';
import styles from './index.module.css';

/** More than this and the beach turns into a crowd; the party (the dock's Pets key) has everyone. */
const MAX_WALKERS = 8;

/** The width one walking pet needs for its portrait and its name, in pixels. A narrower beach
 *  shows fewer pets rather than stacking them on top of each other. */
const WALKER_ROOM = 90;

/** Fixed rather than random so the sky is the same on every render and every visit. */
const STARS = Array.from({ length: 48 }, (_, i) => ({
    left: (i * 37.7) % 100,
    top: (i * 23.3) % 54,
    delay: -((i * 0.61) % 3),
}));

const LANTERNS = [12, 34, 48, 66, 90];

/** The cove's shoreline, in the land drawing's 1000 by 500 box: high ground at both ends, where
 *  the Hall and the Tower stand, and a bay in the middle under the Pulse. */
const SHORELINE = 'M0 30 C110 4 250 10 330 52 C410 92 590 92 670 52 C750 10 890 4 1000 30';

/** The strip of sand pets walk on, in percent of the scene's height. Full screen it sits
 *  higher, clear of the dock that floats over the bottom of the screen. */
const LANE = { min: 81, max: 88 };
const FULLSCREEN_LANE = { min: 69, max: 77 };

/**
 * The Quiet Shore: the home screen as a place rather than a dashboard.
 *
 * The player's own pets stroll on the sand, the Pulse beats in the sky with the real
 * drand round, and each building is a door to a page that already exists. It owns no
 * game state: everything comes from the same shared hooks the HUD and the party use.
 * Tapping a pet opens its sheet. Full screen, it is the home page.
 */
const ShoreScene: React.FC<{ fullscreen?: boolean }> = ({ fullscreen = false }) => {
    const { isConnected } = useChainCapabilities();
    const { pets, isLoading } = usePetList();
    const { data: battleConfig } = useBattleConfig();
    const { openPet, openSummon } = useParty();
    const scene = useRef<HTMLElement>(null);
    const [width, setWidth] = useState<number | null>(null);

    useEffect(() => {
        const el = scene.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const room = width === null ? MAX_WALKERS : Math.max(3, Math.floor(width / WALKER_ROOM));
    const walkers = isConnected ? pets.slice(0, Math.min(MAX_WALKERS, room)) : [];

    return (
        <section ref={scene} className={clsx(styles.shore, fullscreen && styles.full)} aria-label="The Quiet Shore">
            <ShoreDefs />
            <div className={styles.sky} aria-hidden>
                {STARS.map((s, i) => (
                    <span
                        key={i}
                        className={styles.star}
                        style={{ left: `${s.left}%`, top: `${s.top}%`, animationDelay: `${s.delay}s` }}
                    />
                ))}
            </div>
            <div className={styles.pulse}>
                <PulseOrb />
            </div>
            <div className={styles.sea} aria-hidden>
                <div className={styles.reflection} />
                {[styles.waveBack, styles.waveMid, styles.waveFront].map((wave) => (
                    <svg key={wave} className={wave} viewBox="0 0 200 60" preserveAspectRatio="none">
                        <path d="M0 18 Q25 6 50 18 T100 18 T150 18 T200 18 V60 H0 Z" />
                    </svg>
                ))}
            </div>
            <svg className={styles.land} viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden>
                <defs>
                    <linearGradient id="shore-land" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#8a739c" />
                        <stop offset=".05" stopColor="#5d4a78" />
                        <stop offset=".22" stopColor="#2f2e52" />
                        <stop offset=".6" stopColor="#1f1f3a" />
                        <stop offset="1" stopColor="#141428" />
                    </linearGradient>
                </defs>
                <path d={`${SHORELINE} V500 H0 Z`} fill="url(#shore-land)" />
                <path className={styles.surfGlow} d={SHORELINE} />
                <path className={styles.surf} d={SHORELINE} />
            </svg>
            {LANTERNS.map((x, i) => (
                <span
                    key={x}
                    className={styles.lantern}
                    style={{ left: `${x}%`, animationDelay: `${-i * 0.7}s` }}
                    aria-hidden
                />
            ))}

            <Places teamBattles={Boolean(battleConfig?.team?.enabled)} />

            {walkers.map((pet, index) => (
                <ShorePet
                    key={pet.id}
                    pet={pet}
                    index={index}
                    count={walkers.length}
                    lane={fullscreen ? FULLSCREEN_LANE : LANE}
                    onOpen={() => openPet(String(pet.id))}
                />
            ))}

            {isConnected && !isLoading && pets.length === 0 && (
                <div className={styles.sign}>
                    <span>The beach is empty. Summon your first pet!</span>
                    <button type="button" className={styles.summon} onClick={openSummon}>
                        Summon a pet
                    </button>
                </div>
            )}

            {!isConnected && (
                <p className={styles.sign}>Connect your wallet and your pets will come out to play.</p>
            )}
        </section>
    );
};

export default ShoreScene;
