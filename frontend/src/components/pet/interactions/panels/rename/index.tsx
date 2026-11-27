import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import TransactionStatus from '@components/common/transaction-status';
import NeonButton from '@components/ui/neon-button';
import {
    getPetClass,
    getReadyPetsUnified,
    useChainCapabilities,
    usePetList,
    useRenamePet,
} from '@shared/core';
import { useNotifyError } from '@hooks/useNotifyError';
import { usePetChoice } from '@hooks/usePetChoice';
import { useTxErrorToast } from '@hooks/useTxErrorToast';
import Icon, { CheckIcon, QuillIcon } from '@components/ui/icon';
import { Tones } from '@constants/tones';
import PetShowcase from '../_shared/pet-showcase';
import styles from './index.module.css';
import PetArt from '@components/pet/pet-art';
import PetSelect from '@components/ui/pet-select';

const MAX_NAME_LEN = 20;

export type RenamePanelProps = {
    isStandaloneView?: boolean;
};

const RenamePanel: React.FC<RenamePanelProps> = ({ isStandaloneView = true }) => {
    const { renameMinLevel, isConnected } = useChainCapabilities();
    const { pets, refetch } = usePetList();
    const notifyError = useNotifyError();

    const readyPets = useMemo(() => getReadyPetsUnified(pets), [pets]);
    const selectablePets = useMemo(
        () =>
            renameMinLevel > 1
                ? readyPets.filter(({ pet }) => pet.level >= renameMinLevel)
                : readyPets,
        [readyPets, renameMinLevel],
    );
    const [selectedPet, setSelectedPet] = usePetChoice(
        useMemo(() => selectablePets.map(({ id }) => id), [selectablePets]),
    );
    const [newName, setNewName] = useState('');
    const [success, setSuccess] = useState<string | null>(null);

    // Settlement is lifecycle-driven (EVM: receipt confirmed; Solana: resolve).
    const handleRenameComplete = () => {
        setSuccess(`Pet name changed to "${newName}"!`);
        setSelectedPet('');
        setNewName('');
        refetch();
    };

    const {
        mutate,
        isPending,
        error: hookError,
        reset,
        lifecycle,
    } = useRenamePet({
        onSuccess: handleRenameComplete,
    });

    useTxErrorToast(hookError);

    /**
     * Why the pet list is empty, said out loud.
     *
     * The standalone page renders no subtitle, so the level floor (2 on EVM, 1 on
     * Solana) was never stated anywhere: a player whose only pet is a level-1 starter
     * met an empty control and nothing explaining it. Each cause reads differently
     * because each has a different fix.
     */
    const emptyReason =
        pets.length === 0
            ? 'You have no pets yet.'
            : readyPets.length === 0
            ? 'Every pet is still on cooldown.'
            : `Renaming needs a level ${renameMinLevel} pet. Level one up first.`;

    const selectedPetObj = selectablePets.find(({ id }) => id === selectedPet)?.pet ?? null;
    const previewName = newName.trim() || selectedPetObj?.name || 'New Name';
    const meetsMin = newName.trim().length >= 2;

    const handleChangeName = async () => {
        if (!isConnected) {
            notifyError('Please connect your wallet first', undefined, 'rename-validation');
            return;
        }
        if (!selectedPet || !newName.trim()) {
            notifyError('Please select a pet and enter a new name', undefined, 'rename-validation');
            return;
        }

        reset();
        setSuccess(null);

        try {
            await mutate({ petId: selectedPet, name: newName.trim() });
        } catch (err) {
            console.error('[rename]', err);
        }
    };

    return (
        <>
            <div className="interface">
                {!isStandaloneView && (
                    <>
                        <h4>
                            <Icon as={QuillIcon} tone={Tones.Cyan} />
                            Change Pet Name
                        </h4>
                        <p>
                            {renameMinLevel > 1
                                ? `Change your pet's name (requires level ${renameMinLevel}+)`
                                : "Change your pet's name"}
                        </p>
                    </>
                )}

                {/* The slot is always rendered, with a placeholder standing in before a
                    pet is chosen, so picking one swaps content into a box that is
                    already the right size and nothing on the panel shifts. */}
                <div className="interaction-visual">
                    {!selectedPetObj && (
                        // Built from the same classes as the filled state rather than
                        // its own skeleton layout, so the two are the same height by
                        // construction instead of by hand-matched numbers that drift.
                        <PetShowcase
                            avatar={<span className="pet-slot-glyph">?</span>}
                            accent="cyan"
                        >
                            <div className={styles.preview}>
                                <span className="skeleton-bar wide" />
                            </div>
                            <div className={styles.sub}>
                                <span className="skeleton-bar narrow" />
                            </div>
                            <div className={styles.reqs}>
                                <div className={styles.isPending}>○ Min 2 characters</div>
                                <div className={styles.isPending}>
                                    ○ Max {MAX_NAME_LEN} characters
                                </div>
                            </div>
                        </PetShowcase>
                    )}
                    {selectedPetObj && (
                        <PetShowcase avatar={<PetArt pet={selectedPetObj} />} accent="cyan">
                            <div className={styles.preview}>{previewName}</div>
                            <div className={styles.sub}>
                                {getPetClass(selectedPetObj.dna)} · Lv.{selectedPetObj.level}
                            </div>
                            <div className={styles.reqs}>
                                <div className={meetsMin ? styles.isOk : styles.isPending}>
                                    {meetsMin ? '✓' : '○'} Min 2 characters
                                </div>
                                <div className={styles.isOk}>
                                    ✓ Max {MAX_NAME_LEN} characters ({newName.length})
                                </div>
                            </div>
                        </PetShowcase>
                    )}
                </div>

                <div className="picker">
                    <div className="field">
                        <label htmlFor="rename-pet">Select Pet</label>
                        <PetSelect
                            id="rename-pet"
                            pets={selectablePets}
                            value={selectedPet}
                            onChange={setSelectedPet}
                            placeholder="Select pet..."
                            disabled={selectablePets.length === 0}
                        />
                        {selectablePets.length === 0 && (
                            <p className={styles.emptyNote}>{emptyReason}</p>
                        )}
                    </div>

                    <div className="field">
                        <label htmlFor="rename-new-name">New Name</label>
                        <input
                            id="rename-new-name"
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Enter new name..."
                            maxLength={MAX_NAME_LEN}
                        />
                    </div>
                </div>

                <div className={clsx('action-controls', styles.actionControls)}>
                    <NeonButton
                        tone="emerald"
                        onClick={handleChangeName}
                        disabled={isPending || !selectedPet || !newName.trim() || !isConnected}
                    >
                        {isPending ? 'Changing Name...' : 'Change Name'}
                    </NeonButton>
                </div>
            </div>

            {success && (
                <div className="success-message">
                    <Icon as={CheckIcon} tone={Tones.Emerald} />
                    {success}
                </div>
            )}

            <TransactionStatus lifecycle={lifecycle} />
        </>
    );
};

export default RenamePanel;
