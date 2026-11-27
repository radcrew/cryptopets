import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
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
    useLevelUpPet,
    usePetList,
    type Pet,
} from '@shared/core';
import { useNotifyError } from '@hooks/useNotifyError';
import { usePetChoice } from '@hooks/usePetChoice';
import { useTxErrorToast } from '@hooks/useTxErrorToast';
import Icon, { CheckIcon } from '@components/ui/icon';
import { Tones } from '@constants/tones';
import SyncMetadataButton from './sync-metadata-button';
import PetStage, { StageBar, StageKicker } from '@components/game/pet-stage';
import styles from './index.module.css';
import PetArt from '@components/pet/pet-art';
import Celebration from '@components/game/celebration';

export type LevelUpPanelProps = {
    isStandaloneView?: boolean;
};

const LevelUpPanel: React.FC<LevelUpPanelProps> = ({ isStandaloneView = true }) => {
    const { levelUpFee, isConnected } = useChainCapabilities();
    const { pets, refetch } = usePetList();
    const notifyError = useNotifyError();

    const readyPets = useMemo(() => getReadyPetsUnified(pets), [pets]);
    const [selectedPet, setSelectedPet] = usePetChoice(useMemo(() => readyPets.map(({ id }) => id), [readyPets]));
    const [success, setSuccess] = useState<string | null>(null);
    const [leveledUpPetId, setLeveledUpPetId] = useState<string | null>(null);
    /** The pet to celebrate, read at success time: a level-up is always exactly one level. */
    const [celebrated, setCelebrated] = useState<{ pet: Pet; level: number } | null>(null);

    // Settlement is lifecycle-driven (EVM: receipt confirmed; Solana: resolve).
    const handleLevelUpComplete = () => {
        setLeveledUpPetId(selectedPet);
        const pet = pets.find((p) => String(p.id) === selectedPet);
        if (pet) setCelebrated({ pet, level: pet.level + 1 });
        setSuccess('Pet leveled up successfully!');
        setSelectedPet('');
        refetch();
    };

    const {
        mutate,
        isPending,
        error: hookError,
        reset,
        lifecycle,
    } = useLevelUpPet({
        onSuccess: handleLevelUpComplete,
    });
    const fees = useFees();
    const selectedPetObj = readyPets.find(({ id }) => id === selectedPet)?.pet ?? null;
    const selectedLevel = selectedPetObj?.level;
    const selectedXp = selectedPetObj ? getXpNumbers(selectedPetObj) : null;

    // Level-up fee is level-scaled: baseFee × (100 + (level-1)²) / 100.
    const levelUpCost = useMemo(() => {
        if (selectedLevel == null || fees.levelUpFee == null) return null;
        const diff = BigInt(Math.max(selectedLevel - 1, 0));
        const multiplier = 100n + diff * diff;
        return fees.formatAmount((fees.levelUpFee * multiplier) / 100n);
    }, [fees, selectedLevel]);

    useTxErrorToast(hookError);

    const handleLevelUp = async () => {
        if (!isConnected) {
            notifyError('Please connect your wallet first', undefined, 'level-up-validation');
            return;
        }
        if (!selectedPet) {
            notifyError('Please select a pet to level up', undefined, 'level-up-validation');
            return;
        }

        reset();
        setSuccess(null);

        try {
            await mutate({ petId: selectedPet });
        } catch (err) {
            console.error('[level-up]', err);
        }
    };

    const buttonLabel = isPending
        ? 'Leveling Up...'
        : levelUpCost
        ? `Level Up (${levelUpCost})`
        : levelUpFee
        ? `Level Up (from ${levelUpFee.amount} ${levelUpFee.symbol})`
        : 'Level Up';

    return (
        <>
            <div className="interface">
                {!isStandaloneView && (
                    <>
                        <h4>⬆️ Level Up Pet</h4>
                        <p>
                            {levelUpFee
                                ? `Pay from ${levelUpFee.amount} ${levelUpFee.symbol} to level up your pet — cost rises with level`
                                : 'Pay a small SOL fee to level up your pet'}
                        </p>
                    </>
                )}

                {/* The pet on its stage. Always drawn, with a "?" on the pedestal before a pet is
                    chosen, so choosing one moves nothing below it. */}
                <PetStage
                    className="interaction-visual"
                    pet={selectedPetObj}
                    tone="violet"
                    emptyHint="Pick a pet from your roster below."
                >
                    <StageKicker>Level up</StageKicker>
                    {selectedPetObj && selectedXp ? (
                        <>
                            <div className={styles.transition}>
                                <span className={clsx(styles.badge, styles.badgeCur)}>Lv {selectedPetObj.level}</span>
                                <span className={styles.arrow} aria-hidden>
                                    ➜
                                </span>
                                <span className={clsx(styles.badge, styles.badgeNext)}>Lv {selectedPetObj.level + 1}</span>
                            </div>
                            <StageBar
                                label="XP"
                                value={`${selectedXp.xpCurrent} / ${selectedXp.xpMax}`}
                                percent={getXpPercent(selectedPetObj)}
                            />
                            <p className={styles.note}>Always exactly one level. The fee rises with level.</p>
                            {levelUpCost && <p className={styles.cost}>🪙 Cost: {levelUpCost}</p>}
                        </>
                    ) : (
                        <p className={styles.note}>Choose a pet from your roster to see its next level and the fee.</p>
                    )}
                    <div className="action-controls">
                        <NeonButton
                            tone="emerald"
                            onClick={handleLevelUp}
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
                            label="Pet to level up"
                            emptyHint="No pets are ready right now."
                        />
                    </div>
                </div>
            </div>

            {success && (
                <div className="success-message">
                    <Icon as={CheckIcon} tone={Tones.Emerald} />
                    {success}
                    <SyncMetadataButton petId={leveledUpPetId ?? undefined} />
                </div>
            )}

            {celebrated && (
                <Celebration
                    title="Level up!"
                    sub={`${celebrated.pet.name} reached level ${celebrated.level}`}
                    art={<PetArt pet={celebrated.pet} fill />}
                    tone={getRarityColor(celebrated.pet.rarity)}
                    sound="levelUp"
                    onClose={() => setCelebrated(null)}
                />
            )}

            <TransactionStatus lifecycle={lifecycle} />
        </>
    );
};

export default LevelUpPanel;
