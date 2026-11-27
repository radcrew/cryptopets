import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBattleConfig, useChainCapabilities, usePetList } from '@shared/core';

import PulseOrb from '@components/game/pulse-orb';
import { BATTLE_PATH } from '@constants/interactionRoutes';
import Places from './parts/places';
import ShoreDefs from './parts/shore-defs';
import ShorePet from './parts/shore-pet';
import styles from './index.module.css';

/** More than this and the beach turns into a crowd; the gallery below shows everyone. */
const MAX_WALKERS = 8;

/** Fixed rather than random so the sky is the same on every render and every visit. */
const STARS = Array.from({ length: 48 }, (_, i) => ({
    left: (i * 37.7) % 100,
    top: (i * 23.3) % 54,
    delay: -((i * 0.61) % 3),
}));

const LANTERNS = [12, 34, 48, 66, 90];

/**
 * The Quiet Shore: the home screen as a place rather than a dashboard.
 *
 * The player's own pets stroll on the sand, the Pulse beats in the sky with the real
 * drand round, and each building is a door to a page that already exists. It owns no
 * game state: everything comes from the same shared hooks the gallery and the sidebar
 * use, and the gallery still renders below it.
 */
const ShoreScene: React.FC = () => {
    const navigate = useNavigate();
    const { isConnected } = useChainCapabilities();
    const { pets } = usePetList();
    const { data: battleConfig } = useBattleConfig();
    const [openId, setOpenId] = useState<string | null>(null);

    const walkers = isConnected ? pets.slice(0, MAX_WALKERS) : [];

    return (
        <section className={styles.shore} aria-label="The Quiet Shore">
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
            <div className={styles.sand} aria-hidden />
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
                    open={openId === pet.id}
                    onToggle={() => setOpenId((id) => (id === pet.id ? null : pet.id))}
                    onBattle={() => navigate(BATTLE_PATH, { state: { petId: pet.id } })}
                />
            ))}

            {!isConnected && (
                <p className={styles.sign}>Connect your wallet and your pets will come out to play.</p>
            )}
        </section>
    );
};

export default ShoreScene;
