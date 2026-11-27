import React from 'react';
import type { Pet, PetChain } from '@shared/core';
import Nest from './nest';
import ParentSpot from './parent-spot';
import PendingBreedNotice from './pending-breed-notice';
import SpouseLabel from './spouse-label';
import styles from '../index.module.css';
import nest from '../nest.module.css';

export type WithSpouseTabProps = {
    allPets: { id: string; pet: Pet }[];
    chain: PetChain | null;
    spousePetId: string;
    onSpousePetChange: (id: string) => void;
    childName: string;
    onChildNameChange: (name: string) => void;
    marriageLoading: boolean;
    isMarried: boolean;
    spouseId?: string;
    studFeeLabel: string | null;
    areRelated: boolean;
    /** Hide the pending-breed recovery notice while a breed is settling. */
    showPendingNotices: boolean;
    /** Breed action button, rendered in the nest once the pet is married. */
    breedAction?: React.ReactNode;
};

/** Breed one of the user's pets with its married partner (cross-owner). */
const WithSpouseTab: React.FC<WithSpouseTabProps> = ({
    allPets,
    chain,
    spousePetId,
    onSpousePetChange,
    childName,
    onChildNameChange,
    marriageLoading,
    isMarried,
    spouseId,
    studFeeLabel,
    areRelated,
    showPendingNotices,
    breedAction,
}) => {
    const selected = allPets.find(({ id }) => id === spousePetId)?.pet ?? null;

    const cycle = (dir: 1 | -1) => {
        if (allPets.length === 0) return;
        const idx = allPets.findIndex(({ id }) => id === spousePetId);
        const base = idx < 0 ? 0 : idx;
        const next = allPets[(base + dir + allPets.length) % allPets.length];
        onSpousePetChange(next.id);
    };

    return (
        <div className={styles.tabPanel}>
            <p className={styles.tabHint}>Cycle to a married pet to breed with its spouse.</p>
            {/* Your pet and its partner on their pedestals, the nest between them. */}
            <div className={nest.scene}>
                <ParentSpot
                    pet={selected}
                    emptyHint="Choose one of your pets."
                    cycleName="pet"
                    onPrev={allPets.length > 0 ? () => cycle(-1) : undefined}
                    onNext={allPets.length > 0 ? () => cycle(1) : undefined}
                />
                <Nest petA={selected} petB={null} waiting="With its spouse" ready={Boolean(spouseId)}>
                    {spousePetId && !marriageLoading && !isMarried ? (
                        <div className={styles.noMarried}>
                            <p>This pet is not married yet.</p>
                            <p>
                                Go to the <strong>Marriage</strong> page to propose first.
                            </p>
                        </div>
                    ) : (
                        spouseId && (
                            <>
                                <label className={nest.nameField}>
                                    <span>Name the egg</span>
                                    <input
                                        id="breed-spouse-offspring-name"
                                        type="text"
                                        value={childName}
                                        onChange={(e) => onChildNameChange(e.target.value)}
                                        placeholder="Name for the new pet…"
                                        maxLength={20}
                                    />
                                </label>
                                {breedAction && <div className={nest.action}>{breedAction}</div>}
                            </>
                        )
                    )}
                </Nest>
                <div className={nest.partner}>
                    <span className={nest.ring} aria-hidden>
                        💍
                    </span>
                    <span className={nest.partnerLabel}>
                        {!spousePetId ? (
                            'Choose your pet first'
                        ) : marriageLoading ? (
                            'Checking…'
                        ) : spouseId ? (
                            <SpouseLabel chain={chain} spouseId={spouseId} />
                        ) : (
                            'Not married'
                        )}
                    </span>
                    <small>Partner&apos;s pet</small>
                </div>
            </div>

            {spouseId && (
                <>
                    {studFeeLabel && (
                        <div className={styles.studFeeNotice}>
                            Stud fee: <strong>{studFeeLabel}</strong> — paid to the spouse owner.
                        </div>
                    )}
                    {areRelated && (
                        <p className={styles.relativeWarning}>
                            Your pet and their spouse are relatives and cannot breed together.
                        </p>
                    )}
                    {/* Only show recovery notice for the user's own pet.
                        The spouse's pet also has a pending flag while the breed
                        is in-flight, but the user can't settle/cancel it and
                        showing those buttons there is confusing. */}
                    {showPendingNotices && (
                        <PendingBreedNotice
                            petId={spousePetId || undefined}
                            label={`#${spousePetId}`}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default WithSpouseTab;
