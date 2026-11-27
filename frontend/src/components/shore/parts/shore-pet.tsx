import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { getRarityColor, type Pet } from '@shared/core';

import PetArt from '@components/pet/pet-art';
import styles from './shore-pet.module.css';

/** The width of the beach pets walk across, in percent of the scene. */
const X_MIN = 6;
const X_MAX = 94;

type Spot = { x: number; y: number };
/** The strip of sand pets walk on, in percent of the scene's height. */
export type Lane = { min: number; max: number };

/** The stretch of beach a pet keeps to: its own column, less a margin, so two pets never
 *  wander into each other however long the page stays open. */
type Band = { min: number; max: number };

const bandFor = (index: number, count: number): Band => {
    const width = (X_MAX - X_MIN) / Math.max(count, 1);
    const left = X_MIN + index * width;
    return { min: left + width * 0.2, max: left + width * 0.8 };
};

/** A stable starting spot from the pet's id, so a re-render never teleports anyone. */
const startSpot = (id: string, band: Band, lane: Lane): Spot => {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { x: (band.min + band.max) / 2, y: lane.min + ((h % 100) / 100) * (lane.max - lane.min) };
};

const prefersStill = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

type Walk = { spot: Spot; seconds: number; facingLeft: boolean; walking: boolean };

/**
 * A short stroll, a rest of a few seconds, then another stroll. Slow on purpose: the
 * Shore should feel lived in, not busy. Never moves under reduced motion.
 */
const useWander = (start: Spot, band: Band, lane: Lane): Walk => {
    const [walk, setWalk] = useState<Walk>({ spot: start, seconds: 0, facingLeft: false, walking: false });
    const spot = useRef(start);

    useEffect(() => {
        if (prefersStill()) return;
        let timer: ReturnType<typeof setTimeout>;
        const stroll = () => {
            const from = spot.current;
            const x = Math.min(band.max, Math.max(band.min, from.x + (Math.random() - 0.5) * (band.max - band.min)));
            const y = Math.min(lane.max, Math.max(lane.min, from.y + (Math.random() - 0.5) * 5));
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
    }, [band.min, band.max, lane]);

    return walk;
};

type ShorePetProps = {
    pet: Pet;
    index: number;
    count: number;
    lane: Lane;
    /** Opens the pet's sheet. */
    onOpen: () => void;
};

/** One of the player's pets, strolling on the sand. Tapping it opens its sheet. */
const ShorePet: React.FC<ShorePetProps> = ({ pet, index, count, lane, onOpen }) => {
    const band = bandFor(index, count);
    const [start] = useState(() => startSpot(pet.id, band, lane));
    const walk = useWander(start, band, lane);
    const color = getRarityColor(pet.rarity);

    return (
        <div
            className={clsx(styles.pet, walk.walking && styles.walking, walk.facingLeft && styles.facingLeft)}
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
                onClick={onOpen}
                aria-haspopup="dialog"
                aria-label={`${pet.name}, level ${pet.level}`}
            >
                <span className={styles.frame}>
                    <PetArt pet={pet} fill emojiClassName={styles.emoji} />
                </span>
                <span className={styles.name}>{pet.name}</span>
            </button>
        </div>
    );
};

export default ShorePet;
