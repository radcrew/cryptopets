import React, { useMemo } from 'react';
import clsx from 'clsx';
import { useChainCapabilities, usePetEquipmentForPets } from '@shared/core';
import { Tones } from '@constants/tones';
import Icon, { CloseIcon, PawIcon } from '@components/ui/icon';
import NeonButton from '@components/ui/neon-button';
import CreatePetModal from '@components/pet/creation/create-pet-modal';
import SendPetModal from '@components/pet/transfer/send-pet-modal';
import StoryPreview from '@components/pet/story-preview';
import { usePetGallery } from '@hooks/pet-gallery/usePetGallery';
import PetCard from './parts/pet-card';
import { Leaders, RankStat } from './parts/standing';
import styles from './index.module.css';

const PetGallery: React.FC = () => {
    const {
        isConnected,
        pets,
        isLoading,
        error,
        totalWins,
        statusFor,
        onRefetch,
        onBattle,
        onSendClick,
        sendModalOpen,
        sendSelection,
        onCloseSendModal,
        createModalOpen,
        onOpenCreateModal,
        onCloseCreateModal,
        storyPet,
        onStoryClick,
        onCloseStory,
    } = usePetGallery();

    /**
     * Gear for the whole grid in one request.
     *
     * Batched rather than per card: a roster of twenty pets would otherwise be twenty
     * queries fired the moment the gallery mounts.
     */
    const { activeKind: chain } = useChainCapabilities();
    const petIds = useMemo(() => pets.map((pet) => String(pet.id)), [pets]);
    const { byPet: equippedByPet } = usePetEquipmentForPets({ chain, petIds });


    if (!isConnected) {
        return (
            <div className={clsx(styles.idle, styles.idleMessage)}>
                <div className={styles.prompt}>
                    <Icon as={PawIcon} tone={Tones.Cyan} glow="strong" noGap />
                    <h2>Your Pet Collection</h2>
                    <p>Connect your wallet to view your pets.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.idle}>
            {/* Stat strip: the player's pets, wins and rank, all read from real data. */}
            <div className={styles.stats}>
                <div className={clsx(styles.stat, styles.cyan)}>
                    <span className={styles.statIcon} aria-hidden>
                        🐾
                    </span>
                    <div className={styles.statBody}>
                        <div className={styles.statValue}>{pets.length}</div>
                        <div className={styles.statLabel}>Pets</div>
                    </div>
                </div>
                <div className={clsx(styles.stat, styles.violet)}>
                    <span className={styles.statIcon} aria-hidden>
                        ⚔
                    </span>
                    <div className={styles.statBody}>
                        <div className={styles.statValue}>{totalWins}</div>
                        <div className={styles.statLabel}>Wins</div>
                    </div>
                </div>
                <div className={clsx(styles.stat, styles.gold)}>
                    <span className={styles.statIcon} aria-hidden>
                        🏆
                    </span>
                    <RankStat />
                </div>
            </div>

            {/* The top of the player board, full width below the stats. */}
            <Leaders />

            {isLoading && (
                <div className="loading-container">
                    <div className="loading-spinner" />
                    <p>Loading your pets...</p>
                </div>
            )}

            {error && !isLoading && (
                <div className="error-container">
                    <p>
                        <Icon as={CloseIcon} tone={Tones.Magenta} />
                        Failed to load pet data. Please try again.
                    </p>
                    <NeonButton tone="magenta" size="sm" onClick={() => onRefetch()}>
                        Try Again
                    </NeonButton>
                </div>
            )}

            {!isLoading && !error && (
                <div className={styles.petGrid}>
                    {pets.map((pet) => (
                        <PetCard
                            key={`${pet.chain}-${pet.id}`}
                            pet={pet}
                            cooldown={statusFor(pet)}
                            equipped={equippedByPet.get(String(pet.id))}
                            onBattle={() => onBattle(pet)}
                            onSendClick={() => onSendClick(pet)}
                            onStoryClick={() => onStoryClick(pet)}
                        />
                    ))}

                    <button type="button" className={styles.summonTile} onClick={onOpenCreateModal}>
                        <span className={styles.summonPlus}>+</span>
                        <span className={styles.summonLabel}>Summon a Pet</span>
                    </button>
                </div>
            )}

            {sendModalOpen && sendSelection && (
                <SendPetModal
                    isOpen={sendModalOpen}
                    onClose={onCloseSendModal}
                    pet={sendSelection.pet}
                    petId={sendSelection.petId}
                />
            )}

            {storyPet && <StoryPreview pet={storyPet} onClose={onCloseStory} />}

            <CreatePetModal isOpen={createModalOpen} onClose={onCloseCreateModal} />
        </div>
    );
};

export default PetGallery;
