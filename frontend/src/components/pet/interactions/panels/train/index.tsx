import React, { useMemo, useState } from 'react';
import TransactionStatus from '@components/common/transaction-status';
import NeonButton from '@components/ui/neon-button';
import PetPicker from '@components/ui/pet-picker';
import {
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
import PetStage, { StageBar, StageKicker } from '@components/game/pet-stage';
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

                {/* The pet on its stage. Always drawn, with a "?" on the pedestal before a pet is
                    chosen, so choosing one moves nothing below it. */}
                <PetStage
                    className="interaction-visual"
                    pet={selectedPetObj}
                    tone="cyan"
                    emptyHint="Pick a pet from your roster below."
                >
                    <StageKicker>Training session</StageKicker>
                    {selectedPetObj && selectedXp ? (
                        <>
                            <StageBar
                                label="XP"
                                value={`${selectedXp.xpCurrent} / ${selectedXp.xpMax}`}
                                percent={getXpPercent(selectedPetObj)}
                            />
                            <p className={styles.note}>One session adds XP at once. The fee rises with level.</p>
                            {trainCost && <p className={styles.cost}>🪙 Cost: {trainCost}</p>}
                        </>
                    ) : (
                        <p className={styles.note}>Choose a pet from your roster to see its XP and the fee.</p>
                    )}
                    <div className="action-controls">
                        <NeonButton
                            tone="emerald"
                            onClick={handleTrain}
                            disabled={isPending || !selectedPet || !isConnected}
                        >
                            {buttonLabel}
                        </NeonButton>
                    </div>
                </PetStage>

                <div className="picker">
                    <div className="field">
                        <span className="field-label">Your roster</span>
                        <PetPicker
                            pets={readyPets}
                            value={selectedPet}
                            onChange={setSelectedPet}
                            label="Pet to train"
                            emptyHint="No pets are ready right now."
                        />
                    </div>
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
