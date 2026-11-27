import React, { useEffect } from 'react';
import type { Pet } from '@shared/core';
import PetPicker from '@components/ui/pet-picker';
import PendingBreedNotice from './pending-breed-notice';
import Nest from './nest';
import ParentSpot from './parent-spot';
import styles from '../index.module.css';
import nest from '../nest.module.css';

export type OwnPetsTabProps = {
    petCount: number;
    allPets: { id: string; pet: Pet }[];
    pet1: string;
    pet2: string;
    childName: string;
    onPet1Change: (id: string) => void;
    onPet2Change: (id: string) => void;
    onChildNameChange: (name: string) => void;
    areRelated: boolean;
    /** Hide the pending-breed recovery notices while a breed is settling. */
    showPendingNotices: boolean;
    /** Breed action button, rendered in the nest between the two pets. */
    breedAction?: React.ReactNode;
};

/** Breed two of the user's own pets together. */
const OwnPetsTab: React.FC<OwnPetsTabProps> = ({
    petCount,
    allPets,
    pet1,
    pet2,
    childName,
    onPet1Change,
    onPet2Change,
    onChildNameChange,
    areRelated,
    showPendingNotices,
    breedAction,
}) => {
    // Show a matchup immediately: default to the first two pets when nothing is
    // chosen (mirrors the mock, where two parents are always on the table).
    useEffect(() => {
        if (petCount >= 2 && allPets.length >= 2 && !pet1 && !pet2) {
            onPet1Change(allPets[0].id);
            onPet2Change(allPets[1].id);
        }
    }, [petCount, allPets, pet1, pet2, onPet1Change, onPet2Change]);

    if (petCount < 2) {
        return (
            <div className={styles.tabPanel}>
                <div className={styles.noMarried}>
                    <p>You need at least 2 pets to breed here.</p>
                    <p>
                        Use the <strong>With Spouse</strong> tab if your pet is married.
                    </p>
                </div>
            </div>
        );
    }

    const parentA = allPets.find(({ id }) => id === pet1)?.pet ?? null;
    const parentB = allPets.find(({ id }) => id === pet2)?.pet ?? null;

    /** Cycle `current` through the pets not held by the other parent. */
    const cycle = (
        current: string,
        other: string,
        dir: 1 | -1,
        setter: (id: string) => void,
    ) => {
        const pool = allPets.filter(({ id }) => id !== other);
        if (pool.length === 0) return;
        const idx = pool.findIndex(({ id }) => id === current);
        const base = idx < 0 ? 0 : idx;
        const next = pool[(base + dir + pool.length) % pool.length];
        setter(next.id);
    };

    return (
        <div className={styles.tabPanel}>
            <p className={styles.tabHint}>Pick two parents from your pets, or cycle each side.</p>
            {/* The two parents on their pedestals, facing each other across the nest. */}
            <div className={nest.scene}>
                <ParentSpot
                    pet={parentA}
                    emptyHint="Choose the first parent below."
                    cycleName="first parent"
                    onPrev={() => cycle(pet1, pet2, -1, onPet1Change)}
                    onNext={() => cycle(pet1, pet2, 1, onPet1Change)}
                />
                <Nest petA={parentA} petB={parentB}>
                    <label className={nest.nameField}>
                        <span>Name the egg</span>
                        <input
                            id="breed-offspring-name"
                            type="text"
                            value={childName}
                            onChange={(e) => onChildNameChange(e.target.value)}
                            placeholder="Name for the new pet…"
                            maxLength={20}
                        />
                    </label>
                    {breedAction && <div className={nest.action}>{breedAction}</div>}
                </Nest>
                <ParentSpot
                    pet={parentB}
                    emptyHint="Choose the second parent below."
                    cycleName="second parent"
                    onPrev={() => cycle(pet2, pet1, -1, onPet2Change)}
                    onNext={() => cycle(pet2, pet1, 1, onPet2Change)}
                />
            </div>
            {/* The nest's rosters: each parent picked from the pets the other is not. */}
            <div className={styles.parentRosters}>
                <section className={styles.parentRoster} aria-label="First parent">
                    <div className={styles.parentRosterHead}>First parent</div>
                    <PetPicker
                        layout="strip"
                        label="Choose the first parent"
                        pets={allPets.filter(({ id }) => id !== pet2)}
                        value={pet1}
                        onChange={onPet1Change}
                    />
                </section>
                <section className={styles.parentRoster} aria-label="Second parent">
                    <div className={styles.parentRosterHead}>Second parent</div>
                    <PetPicker
                        layout="strip"
                        label="Choose the second parent"
                        pets={allPets.filter(({ id }) => id !== pet1)}
                        value={pet2}
                        onChange={onPet2Change}
                    />
                </section>
            </div>

            {areRelated && (
                <p className={styles.relativeWarning}>
                    These pets are relatives and cannot breed together.
                </p>
            )}
            {showPendingNotices && (
                <>
                    <PendingBreedNotice petId={pet1 || undefined} label={`#${pet1}`} checkSolana />
                    <PendingBreedNotice petId={pet2 || undefined} label={`#${pet2}`} />
                </>
            )}
        </div>
    );
};

export default OwnPetsTab;
