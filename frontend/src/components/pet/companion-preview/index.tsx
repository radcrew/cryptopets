import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getRarityColor, type Pet } from '@shared/core';

import ComingSoon from '@components/game/coming-soon';
import PetArt from '@components/pet/pet-art';
import styles from './index.module.css';

/** Sample traits. The real ones are generated once per pet and never touch combat. */
const TRAITS = ['Bold', 'Curious', 'Loyal'];

/**
 * A preview of AI pet companions, a planned feature (roadmap §10): a pet with a personality
 * of its own that suggests what to do next and keeps a journal of its battles.
 *
 * Opened from a pet on the Shore, so it is about that pet: its name, art and level are real.
 * The traits, the proposal and the journal are sample content inside a Coming soon frame.
 * The note states the roadmap's rules rather than leaving them implied: a pet only proposes
 * and the player's wallet signs, journal entries cite signed battle receipts, and personality
 * never changes how a fight plays out.
 */
const CompanionPreview: React.FC<{ pet: Pet; onClose: () => void }> = ({ pet, onClose }) => {
    const closeButton = useRef<HTMLButtonElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        closeButton.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return createPortal(
        <div className={styles.veil} role="dialog" aria-modal="true" aria-label={`Talk with ${pet.name}`}>
            <button ref={closeButton} type="button" className={styles.close} onClick={onClose} aria-label="Close">
                ×
            </button>
            <div className={styles.panel} style={{ '--rc': getRarityColor(pet.rarity) } as React.CSSProperties}>
                <header className={styles.head}>
                    <span className={styles.portrait}>
                        <PetArt pet={pet} fill />
                    </span>
                    <span>
                        <h2 className={styles.title}>{pet.name}</h2>
                        <span className={styles.meta}>Lv {pet.level} · your companion</span>
                    </span>
                </header>

                <ComingSoon note="Your pets will get a personality of their own, suggest what to do next and keep a journal of their battles. A pet only proposes: your wallet signs every action, and personality never changes a fight.">
                    <div className={styles.body}>
                        <div className={styles.traits}>
                            {TRAITS.map((trait) => (
                                <span key={trait} className={styles.trait}>
                                    {trait}
                                </span>
                            ))}
                        </div>

                        <p className={styles.says}>
                            I&rsquo;ve been watching the Training Ground. One good session today and I&rsquo;m closer to
                            level {pet.level + 1}. Shall we?
                        </p>

                        <div className={styles.proposal}>
                            <span className={styles.kicker}>Proposal</span>
                            <b>Train {pet.name}</b>
                            <small>{pet.name} proposes it. Your wallet signs it, or nothing happens.</small>
                            <span className={styles.keys}>
                                <button type="button" className={styles.approve}>
                                    Approve and sign
                                </button>
                                <button type="button" className={styles.decline}>
                                    Not now
                                </button>
                            </span>
                        </div>

                        <section className={styles.journal} aria-label="Journal">
                            <h3 className={styles.journalTitle}>{pet.name}&rsquo;s journal</h3>
                            <article className={styles.entry}>
                                <time>Yesterday</time>
                                <p>Lost in six rounds to a fox far quicker than me. Next time I strike first.</p>
                                <span className={styles.cite}>📜 Cites Ledger Stone #1,283</span>
                            </article>
                            <article className={styles.entry}>
                                <time>Two days ago</time>
                                <p>Won on the last blow. The Pulse picked a kind beat for once.</p>
                                <span className={styles.cite}>📜 Cites Ledger Stone #1,279</span>
                            </article>
                        </section>
                    </div>
                </ComingSoon>
            </div>
        </div>,
        document.body,
    );
};

export default CompanionPreview;
