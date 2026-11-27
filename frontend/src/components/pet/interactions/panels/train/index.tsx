import React, { useMemo, useState } from 'react';
import TransactionStatus from '@components/common/transaction-status';
import NeonButton from '@components/ui/neon-button';
import PetPicker from '@components/ui/pet-picker';
import {
    getPetClass,
    getRarityColor,
    getReadyPetsUnified,
    getXpNumbers,
    getXpPercent,
    useChainCapabilities,
    useFees,
    useTrainPet,
    usePetList,
    type Pet,
} from '@shared/core';
import { useNotifyError } from '@hooks/useNotifyError';
import { usePetChoice } from '@hooks/usePetChoice';
import { useTxErrorToast } from '@hooks/useTxErrorToast';
import Icon, { CheckIcon } from '@components/ui/icon';
import { Tones } from '@constants/tones';
import styles from './index.module.css';
import PetArt from '@components/pet/pet-art';
import Celebration from '@components/game/celebration';
import XpGain from './xp-gain';

export type TrainPanelProps = {
    isStandaloneView?: boolean;
};

const TrainPanel: React.FC<TrainPanelProps> = ({ isStandaloneView = true }) => {
    const { isConnected } = useChainCapabilities();
    const { pets, refetch } = usePetList();
    const notifyError = useNotifyError();

    const readyPets = useMemo(() => getReadyPetsUnified(pets), [pets]);
    const [selectedPet, setSelectedPet] = usePetChoice(useMemo(() => readyPets.map(({ id }) => id), [readyPets]));
    const [success, setSuccess] = useState<string | null>(null);
    /** The pet to celebrate, as it was before training, so its XP bar can fill from there. */
    const [trained, setTrained] = useState<Pet | null>(null);

    const handleTrainComplete = () => {
        setTrained(pets.find((p) => String(p.id) === selectedPet) ?? null);
        setSuccess('Pet trained successfully!');
        setSelectedPet('');
        refetch();
    };

    const {
        mutate,
        isPending,
        error: hookError,
        reset,
        lifecycle,
    } = useTrainPet({
        onSuccess: handleTrainComplete,
    });
    const fees = useFees();
    const selectedPetObj = readyPets.find(({ id }) => id === selectedPet)?.pet ?? null;
    const selectedLevel = selectedPetObj?.level;
    const selectedXp = selectedPetObj ? getXpNumbers(selectedPetObj) : null;

    // Train fee is level-scaled: baseFee × (100 + 2·level) / 100.
    const trainCost = useMemo(() => {
        if (selectedLevel == null || fees.trainFee == null) return null;
        const multiplier = BigInt(100 + 2 * selectedLevel);
        return fees.formatAmount((fees.trainFee * multiplier) / 100n);
    }, [fees, selectedLevel]);

    useTxErrorToast(hookError);

    const handleTrain = async () => {
        if (!isConnected) {
            notifyError('Please connect your wallet first', undefined, 'train-validation');
            return;
        }
        if (!selectedPet) {
            notifyError('Please select a pet to train', undefined, 'train-validation');
            return;
        }

        reset();
        setSuccess(null);

        try {
            await mutate({ petId: selectedPet });
        } catch (err) {
            console.error('[train]', err);
        }
    };

    const buttonLabel = isPending ? 'Training...' : trainCost ? `Train (${trainCost})` : 'Train';

    return (
        <>
            <div className="interface">
                {!isStandaloneView && (
                    <>
                        <h4>💪 Train Pet</h4>
                        <p>Pay a level-scaled fee for an instant XP boost.</p>
                    </>
                )}

                {/* Always rendered, with a placeholder before a pet is chosen: the card
                    keeps its size either way, so selecting a pet moves nothing. */}
                <div className={`interaction-visual ${styles.status}`}>
                    <div className={styles.visual}>
                        {selectedPetObj ? (
                            <>
                                <span className={styles.level}>Lv.{selectedPetObj.level}</span>
                                <span className={styles.avatar}>
                                    <PetArt pet={selectedPetObj} />
                                </span>
                            </>
                        ) : (
                            <span className={styles.avatar}>
                                <span className="pet-slot-glyph">?</span>
                            </span>
                        )}
                    </div>
                    <div className={styles.body}>
                        {selectedPetObj ? (
                            <>
                                <div className={styles.name}>{selectedPetObj.name}</div>
                                <div className={styles.petClass}>
                                    {getPetClass(selectedPetObj.dna)}
                                </div>
                                <div className={styles.xpTrack}>
                                    <div
                                        className={styles.xpFill}
                                        style={{ width: `${getXpPercent(selectedPetObj)}%` }}
                                    />
                                </div>
                                <div className={styles.xp}>
                                    {selectedXp?.xpCurrent}/{selectedXp?.xpMax} XP
                                </div>
                            </>
                        ) : (
                            // Same classes as the filled state, so both are the same
                            // height by construction rather than by matched numbers.
                            <>
                                <div className={styles.name}>
                                    <span className="skeleton-bar wide" />
                                </div>
                                <div className={styles.petClass}>
                                    <span className="skeleton-bar narrow" />
                                </div>
                                <div className={styles.xpTrack} />
                                <div className={styles.xp}>Select a pet to see its XP</div>
                            </>
                        )}
                    </div>
                </div>

                <div className="picker">
                    <div className="field">
                        <span className="field-label">Select Pet</span>
                        <PetPicker
                            pets={readyPets}
                            value={selectedPet}
                            onChange={setSelectedPet}
                            label="Pet to train"
                            emptyHint="No pets are ready right now."
                        />
                    </div>
                    {trainCost && <p className="train-cost">Cost: {trainCost}</p>}
                </div>

                <div className="action-controls">
                    <NeonButton
                        tone="emerald"
                        onClick={handleTrain}
                        disabled={isPending || !selectedPet || !isConnected}
                    >
                        {buttonLabel}
                    </NeonButton>
                </div>
            </div>

            {success && (
                <div className="success-message">
                    <Icon as={CheckIcon} tone={Tones.Emerald} />
                    {success}
                </div>
            )}

            {trained && (
                <Celebration
                    title="Trained!"
                    sub={`${trained.name} worked hard and earned XP`}
                    art={<PetArt pet={trained} fill />}
                    tone={getRarityColor(trained.rarity)}
                    sound="levelUp"
                    onClose={() => setTrained(null)}
                >
                    <XpGain before={trained} />
                </Celebration>
            )}

            <TransactionStatus lifecycle={lifecycle} />
        </>
    );
};

export default TrainPanel;
