import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getRarityColor, useChainCapabilities, usePetCooldowns, usePetList } from '@shared/core';

import PetArt from '@components/pet/pet-art';
import styles from './party-drawer.module.css';

/**
 * The party: every pet the player owns, as portraits, with the key to summon another.
 *
 * The Shore draws only a handful of pets so the beach never turns into a crowd; this is
 * where all of them are, highest level first. Picking one opens its sheet.
 */
const PartyDrawer: React.FC<{
    onPick: (petId: string) => void;
    onSummon: () => void;
    onClose: () => void;
}> = ({ onPick, onSummon, onClose }) => {
    const { isConnected } = useChainCapabilities();
    const { pets, isLoading, error, refetch } = usePetList();
    const { statusFor } = usePetCooldowns(pets);
    const drawer = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    const party = useMemo(() => [...pets].sort((a, b) => b.level - a.level || b.winCount - a.winCount), [pets]);
    const wins = pets.reduce((sum, pet) => sum + pet.winCount, 0);

    useEffect(() => {
        drawer.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const content = !isConnected ? (
        <p className={styles.note}>Connect your wallet and your pets will come out to meet you.</p>
    ) : isLoading ? (
        <p className={styles.note}>Calling your pets…</p>
    ) : error ? (
        <p className={styles.note} role="alert">
            Your pets could not be found.{' '}
            <button type="button" className={styles.retry} onClick={() => void refetch()}>
                Try again
            </button>
        </p>
    ) : (
        <ul className={styles.grid}>
            {party.map((pet) => {
                const resting = statusFor(pet).onCooldown;
                return (
                    <li key={`${pet.chain}-${pet.id}`}>
                        <button
                            type="button"
                            className={styles.pet}
                            style={{ '--rc': getRarityColor(pet.rarity) } as React.CSSProperties}
                            onClick={() => onPick(String(pet.id))}
                            aria-label={`${pet.name}, level ${pet.level}${resting ? ', resting' : ''}`}
                        >
                            <span className={styles.face}>
                                <PetArt pet={pet} fill emojiClassName={styles.emoji} />
                                {resting && (
                                    <span className={styles.resting} aria-hidden title="Resting">
                                        ⏳
                                    </span>
                                )}
                            </span>
                            <span className={styles.lv}>Lv {pet.level}</span>
                            <span className={styles.name}>{pet.name}</span>
                        </button>
                    </li>
                );
            })}
            <li>
                <button type="button" className={styles.summon} onClick={onSummon}>
                    <span className={styles.plus} aria-hidden>
                        +
                    </span>
                    <span className={styles.name}>Summon</span>
                </button>
            </li>
        </ul>
    );

    return createPortal(
        <div className={styles.veil} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
            <div ref={drawer} className={styles.drawer} role="dialog" aria-modal="true" aria-label="Your party">
                <header className={styles.head}>
                    <span>
                        <h2 className={styles.title}>Your party</h2>
                        {isConnected && !isLoading && !error && (
                            <span className={styles.count}>
                                {pets.length} {pets.length === 1 ? 'pet' : 'pets'} · {wins} {wins === 1 ? 'win' : 'wins'}
                            </span>
                        )}
                    </span>
                    <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </header>
                {content}
            </div>
        </div>,
        document.body,
    );
};

export default PartyDrawer;
