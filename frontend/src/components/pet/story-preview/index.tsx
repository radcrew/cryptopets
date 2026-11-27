import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { getGeneration, getRarityColor, type Pet } from '@shared/core';

import ComingSoon from '@components/game/coming-soon';
import PetArt from '@components/pet/pet-art';
import styles from './index.module.css';
import RoundKey from '@components/ui/round-key';

/** The arcs roadmap §8 plans, each with what would unlock it. The first is shown open. */
const chapters = (name: string) => [
    { title: 'Born under the Pulse', arc: 'Origin', unlock: null },
    { title: 'Blood of the nest', arc: 'Lineage', unlock: `Unlocks for a bred pet, carrying on its parents' story` },
    { title: 'Prove your worth', arc: 'Milestone', unlock: `Unlocks when ${name} reaches level 5` },
    { title: 'The rival', arc: 'Rivalry', unlock: 'Unlocks after a run of fights against the same rival' },
    { title: 'Two hearts', arc: 'Family', unlock: `Unlocks when ${name} marries` },
];

/**
 * A preview of pet stories, a planned feature (roadmap §8): chapters written for each pet as
 * it grows, from its origin, its parents, its rivals and its family.
 *
 * Opened from a pet's card, so the book is about that pet: its name, art and generation are
 * real. Every chapter and choice is sample content inside a Coming soon frame; nothing is
 * generated, stored or unlocked.
 */
const StoryPreview: React.FC<{ pet: Pet; onClose: () => void }> = ({ pet, onClose }) => {
    const closeButton = useRef<HTMLButtonElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const generation = pet.generation ?? getGeneration(pet.dna);
    const list = chapters(pet.name);

    useEffect(() => {
        closeButton.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return createPortal(
        <div className={styles.veil} role="dialog" aria-modal="true" aria-label={`${pet.name}'s story`}>
            <RoundKey ref={closeButton} icon="close" className={styles.close} onClick={onClose} aria-label="Close the story" />
            <div className={styles.book} style={{ '--rc': getRarityColor(pet.rarity) } as React.CSSProperties}>
                <header className={styles.cover}>
                    <span className={styles.portrait}>
                        <PetArt pet={pet} fill />
                    </span>
                    <span>
                        <h2 className={styles.title}>{pet.name}&rsquo;s Story</h2>
                        <span className={styles.byline}>
                            Generation {generation} · Lv {pet.level}
                        </span>
                    </span>
                </header>

                <ComingSoon note="Every pet will get a story written as it grows: where it came from, its parents, its rivals and its family. Chapters unlock as it levels up, breeds, battles and marries.">
                    <div className={styles.spread}>
                        <ol className={styles.contents}>
                            {list.map((chapter, i) => (
                                <li key={chapter.title} className={clsx(styles.entry, i === 0 && styles.entryOpen)}>
                                    <span className={styles.number}>{i + 1}</span>
                                    <span>
                                        <b>{chapter.title}</b>
                                        <small>{chapter.unlock ?? `${chapter.arc} · open`}</small>
                                    </span>
                                    {chapter.unlock && (
                                        <span className={styles.lock} aria-hidden>
                                            🔒
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ol>

                        <article className={styles.page}>
                            <span className={styles.kicker}>Chapter 1 · Origin</span>
                            <h3 className={styles.chapter}>{list[0]!.title}</h3>
                            <p>
                                The night {pet.name} hatched, the Pulse beat once over the Quiet Shore and the tide
                                went still. One by one, the other pets came down to the water to see who had arrived.
                            </p>
                            <p>
                                {pet.name} blinked at the lanterns, then at the sea, as if deciding which of them to
                                trust first.
                            </p>
                            <p className={styles.ask}>What does {pet.name} do first?</p>
                            <span className={styles.choices}>
                                <button type="button" className={styles.choice}>
                                    Follow the lantern light
                                </button>
                                <button type="button" className={styles.choice}>
                                    Wade into the tide
                                </button>
                            </span>
                        </article>
                    </div>
                </ComingSoon>
            </div>
        </div>,
        document.body,
    );
};

export default StoryPreview;
