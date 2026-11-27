import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    useChainCapabilities,
    usePetCooldowns,
    usePetList,
    type Pet,
    type PetCooldownStatus,
} from '@shared/core';
import { BATTLE_PATH } from '@constants/interactionRoutes';
import { useNotifyError } from '@hooks/useNotifyError';

export interface UsePetGallery {
    isConnected: boolean;
    pets: Pet[];
    isLoading: boolean;
    error: Error | null;
    totalWins: number;
    statusFor: (pet: Pet) => PetCooldownStatus;
    onRefetch: () => void;
    onBattle: (pet: Pet) => void;
    onSendClick: (pet: Pet) => void;
    sendModalOpen: boolean;
    sendSelection: { pet: Pet; petId: bigint } | null;
    onCloseSendModal: () => void;
    createModalOpen: boolean;
    onOpenCreateModal: () => void;
    onCloseCreateModal: () => void;
    /** The pet whose story preview is open, or null. */
    storyPet: Pet | null;
    onStoryClick: (pet: Pet) => void;
    onCloseStory: () => void;
}

/**
 * Headless controller for the pet gallery — same convention as useBattlePanel:
 * owns all state/handlers, the component is a pure view over this hook.
 */
export const usePetGallery = (): UsePetGallery => {
    const navigate = useNavigate();
    const { isConnected } = useChainCapabilities();
    const { pets, isLoading, error, refetch } = usePetList();
    const notifyError = useNotifyError();
    const [sendModalOpen, setSendModalOpen] = useState(false);
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [sendSelection, setSendSelection] = useState<{ pet: Pet; petId: bigint } | null>(null);
    const [storyPet, setStoryPet] = useState<Pet | null>(null);

    const { statusFor } = usePetCooldowns(pets);

    const totalWins = useMemo(
        () => pets.reduce((sum, pet) => sum + (pet.winCount ?? 0), 0),
        [pets],
    );

    useEffect(() => {
        if (!error) return;
        notifyError('Failed to load pet data. Please try again.', error, 'pet-list');
    }, [error, notifyError]);

    const onBattle = (pet: Pet) => navigate(BATTLE_PATH, { state: { petId: pet.id } });

    const onSendClick = (pet: Pet) => {
        setSendSelection({ pet, petId: BigInt(pet.id) });
        setSendModalOpen(true);
    };

    const onCloseSendModal = () => {
        setSendModalOpen(false);
        setSendSelection(null);
    };

    return {
        isConnected,
        pets,
        isLoading,
        error,
        totalWins,
        statusFor,
        onRefetch: refetch,
        onBattle,
        onSendClick,
        sendModalOpen,
        sendSelection,
        onCloseSendModal,
        createModalOpen,
        onOpenCreateModal: () => setCreateModalOpen(true),
        onCloseCreateModal: () => setCreateModalOpen(false),
        storyPet,
        onStoryClick: setStoryPet,
        onCloseStory: () => setStoryPet(null),
    };
};
