import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { getRarityColor, getRarityName, type Pet } from '@shared/core';

import PetArt from '@components/pet/pet-art';
import NeonButton from '@components/ui/neon-button';
import styles from './shore-pet.module.css';

/** The strip of sand pets walk on, in percent of the scene. */
const X_MIN = 6;
const X_MAX = 94;
const Y_MIN = 81;
const Y_MAX = 88;

type Spot = { x: number; y: number };

/** A stable starting spot from the pet's id, so a re-render never teleports anyone. */
const startSpot = (id: string, index: number, count: number): Spot => {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const lane = (index + 0.5) / Math.max(count, 1);
    return { x: X_MIN + lane * (X_MAX - X_MIN), y: Y_MIN + (h % 100) / 100 * (Y_MAX - Y_MIN) };
};

const prefersStill = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

type Walk = { spot: Spot; seconds: number; facingLeft: boolean; walking: boolean };

/**
 * A short stroll, a rest of a few seconds, then another stroll. Slow on purpose: the
 * Shore should feel lived in, not busy. Paused while the pet's card is open so it does
 * not walk away from the player reading it, and never moves under reduced motion.
 */
const useWander = (start: Spot, paused: boolean): Walk => {
    const [walk, setWalk] = useState<Walk>({ spot: start, seconds: 0, facingLeft: false, walking: false });
    const spot = useRef(start);

    useEffect(() => {
        if (paused || prefersStill()) return;
        let timer: ReturnType<typeof setTimeout>;
        const stroll = () => {
            const from = spot.current;
            const x = Math.min(X_MAX, Math.max(X_MIN, from.x + (Math.random() - 0.5) * 18));
            const y = Math.min(Y_MAX, Math.max(Y_MIN, from.y + (Math.random() - 0.5) * 5));
            const seconds = Math.max(4, Math.hypot(x - from.x, (y - from.y) * 2) * 0.9);
            spot.current = { x, y };
            setWalk({ spot: { x, y }, seconds, facingLeft: x < from.x, walking: true });
            timer = setTimeout(rest, seconds * 1000);
        };
        const rest = () => {
            setWalk((w) => ({ ...w, walking: false }));
            timer = setTimeout(stroll, 3000 + Math.random() * 6000);
        };
        timer = setTimeout(stroll, 1000 + Math.random() * 4000);
        return () => clearTimeout(timer);
    }, [paused]);

    return walk;
};

type ShorePetProps = {
    pet: Pet;
    index: number;
    count: number;
    open: boolean;
    onToggle: () => void;
    onBattle: () => void;
};

const ShorePet: React.FC<ShorePetProps> = ({ pet, index, count, open, onToggle, onBattle }) => {
    const [start] = useState(() => startSpot(pet.id, index, count));
    const walk = useWander(start, open);
    const color = getRarityColor(pet.rarity);

    return (
        <div
            className={clsx(styles.pet, walk.walking && styles.walking, walk.facingLeft && styles.facingLeft, open && styles.open)}
            style={
                {
                    left: `${walk.spot.x}%`,
                    top: `${walk.spot.y}%`,
                    transitionDuration: `${walk.seconds}s`,
                    '--rc': color,
                } as React.CSSProperties
            }
        >
            <button
                type="button"
                className={styles.token}
                onClick={onToggle}
                aria-expanded={open}
                aria-label={`${pet.name}, level ${pet.level}`}
            >
                <span className={styles.frame}>
                    <PetArt pet={pet} fill emojiClassName={styles.emoji} />
                </span>
                <span className={styles.name}>{pet.name}</span>
            </button>
            {open && (
                <div className={styles.card} role="group" aria-label={`${pet.name} details`}>
                    <b className={styles.cardName}>{pet.name}</b>
                    <span className={styles.cardMeta}>
                        <span style={{ color }}>{getRarityName(pet.rarity)}</span> · Lv {pet.level} · {pet.winCount}W{' '}
                        {pet.lossCount}L
                    </span>
                    <NeonButton tone="magenta" size="sm" onClick={onBattle}>
                        Battle
                    </NeonButton>
                </div>
            )}
        </div>
    );
};

export default ShorePet;
