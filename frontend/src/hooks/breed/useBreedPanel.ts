import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    useBreedPets,
    useBreedRelationCheck,
    useChainCapabilities,
    useFees,
    useMarriageInfo,
    usePendingBreed,
    usePetList,
    type Pet,
    type TxLifecycle,
} from '@shared/core';
import { formatTxHashHint } from '@hooks/usePetError';
import { usePetChoice } from '@hooks/usePetChoice';
import { usePetErrorToast } from '@hooks/usePetErrorToast';
import type { OwnPetsTabProps } from '@components/pet/interactions/panels/breed/parts/own-pets-tab';
import type { WithSpouseTabProps } from '@components/pet/interactions/panels/breed/parts/with-spouse-tab';
import type { BreedTab } from '@components/pet/interactions/panels/breed/types';

const BREED_FAIL_MESSAGE = 'Failed to breed pets. Please try again.';

export interface UseBreedPanel {
    tab: BreedTab;
    onTabChange: (tab: BreedTab) => void;
    ownPetsTab: Omit<OwnPetsTabProps, 'breedAction'>;
    withSpouseTab: WithSpouseTabProps;
    breedButtonLabel: string;
    breedDisabled: boolean;
    onBreed: () => void;
    /** Shows the "hang tight" hint while an async (VRF) breed hasn't minted yet. */
    isAwaitingFulfillment: boolean;
    success: string | null;
    /**
     * The pet that just hatched, for the egg-cracking celebration. `pet` is null until the
     * refreshed list contains it: found by name among pets that did not exist before the breed.
     */
    hatchling: { name: string; pet: Pet | null } | null;
    onHatchlingSeen: () => void;
    hashHint: string | null;
    receipt: TxLifecycle;
}

/**
 * Headless controller for the breed panel — same convention as useBattlePanel:
 * owns all state/handlers, the component is a pure view over this hook.
 */
export const useBreedPanel = (): UseBreedPanel => {
    const { randomness, activeKind } = useChainCapabilities();
    const { pets, refetch } = usePetList();
    const fees = useFees();

    const [tab, setTab] = useState<BreedTab>('own');
    const [success, setSuccess] = useState<string | null>(null);
    const [hatch, setHatch] = useState<{ name: string; knownIds: string[] } | null>(null);
    const autoSwitched = useRef(false);

    // ── My Pets tab state ──────────────────────────────────────────────────────
    const [ownPet2, setOwnPet2] = useState('');
    const [ownChildName, setOwnChildName] = useState('');

    // ── With Spouse tab state ──────────────────────────────────────────────────
    const [spousePetId, setSpousePetId] = useState('');
    const [spouseChildName, setSpouseChildName] = useState('');

    const allPets = useMemo(() => pets.map((pet) => ({ id: pet.id, pet })), [pets]);
    // The first parent can arrive chosen, from a pet's sheet on the Shore.
    const [ownPet1, setOwnPet1] = usePetChoice(useMemo(() => allPets.map(({ id }) => id), [allPets]));

    // Auto-switch to "With Spouse" tab when user has fewer than 2 own pets —
    // they can't use the "My Pets" tab anyway, and they likely have a married pet.
    useEffect(() => {
        if (!autoSwitched.current && pets.length > 0 && pets.length < 2) {
            autoSwitched.current = true;
            setTab('spouse');
        }
    }, [pets.length]);

    // Auto-select in the "With Spouse" tab:
    // 1. Prefer the first pet that already carries spouseId (Solana on-chain field).
    // 2. Fall back to the only pet when there is just one (EVM — marriage detected
    //    lazily via useMarriageInfo after selection).
    useEffect(() => {
        if (tab === 'spouse' && !spousePetId) {
            const marriedPet = pets.find((p) => p.spouseId != null && p.spouseId !== 0);
            if (marriedPet) {
                setSpousePetId(marriedPet.id);
            } else if (pets.length === 1) {
                setSpousePetId(pets[0].id);
            }
        }
    }, [tab, pets, spousePetId]);

    // Selected pet for "With Spouse" tab — use the proven useMarriageInfo hook
    // (same as the marriage panel) to detect if the selected pet is married.
    const selectedSpousePet = allPets.find(({ id }) => id === spousePetId)?.pet;
    const marriageInfo = useMarriageInfo(selectedSpousePet);
    const spouseId = marriageInfo.isMarried ? marriageInfo.spouseId?.toString() : undefined;

    const studFeeLabel = useMemo(() => {
        if (fees.studFee == null) return null;
        return fees.formatAmount(fees.studFee);
    }, [fees]);

    // Relative/lineage check — EVM-only, inert (never related) on other chains.
    const relPetA = tab === 'own' ? ownPet1 : spousePetId;
    const relPetB = tab === 'own' ? ownPet2 : spouseId ?? '';
    const { areRelated } = useBreedRelationCheck(relPetA, relPetB);

    // Pending breed state is tab-specific — only check the relevant pets.
    // For cross-owner: we check both pets (contract rejects new requests when either
    // has a pending one), but only show the recovery UI for the user's OWN pet —
    // the spouse's pet notice would show settle/cancel buttons the user can't use.
    const pendingOwn1 = usePendingBreed(tab === 'own' ? ownPet1 || undefined : undefined);
    const pendingOwn2 = usePendingBreed(tab === 'own' ? ownPet2 || undefined : undefined);
    const pendingMarried = usePendingBreed(tab === 'spouse' ? spousePetId || undefined : undefined);
    const pendingSpouse = usePendingBreed(tab === 'spouse' ? spouseId : undefined);
    const hasPendingBreed =
        tab === 'own'
            ? pendingOwn1.isPending || pendingOwn2.isPending
            : pendingMarried.isPending || pendingSpouse.isPending;

    const handleSuccess = useCallback(
        ({ name }: { name: string }) => {
            setSuccess(`"${name}" created!`);
            setHatch({ name, knownIds: pets.map((p) => p.id) });
            setOwnPet1('');
            setOwnPet2('');
            setOwnChildName('');
            setSpousePetId('');
            setSpouseChildName('');
            void refetch();
        },
        [pets, refetch, setOwnPet1],
    );

    const hatchling = useMemo(
        () =>
            hatch && {
                name: hatch.name,
                pet: pets.find((p) => p.name === hatch.name && !hatch.knownIds.includes(p.id)) ?? null,
            },
        [hatch, pets],
    );
    const onHatchlingSeen = useCallback(() => setHatch(null), []);

    const breed = useBreedPets({ onSuccess: handleSuccess });

    usePetErrorToast(breed.error, null, null, BREED_FAIL_MESSAGE);

    const usesSwitchboardVrf = randomness.provider === 'switchboard';
    const hashHint = usesSwitchboardVrf ? formatTxHashHint(breed.hash) : null;

    const pendingLabel = usesSwitchboardVrf ? 'Generating randomness…' : 'Submitting…';
    const breedButtonLabel = breed.isPending
        ? pendingLabel
        : breed.isAwaitingFulfillment
        ? 'Creating…'
        : tab === 'own'
        ? 'Breed Pets'
        : 'Breed with Spouse';

    const canSubmit =
        tab === 'own'
            ? Boolean(ownPet1 && ownPet2 && ownChildName.trim() && !areRelated)
            : Boolean(spousePetId && spouseId && spouseChildName.trim() && !areRelated);

    const onBreed = () => {
        breed.clearErrors();
        setSuccess(null);
        if (!canSubmit) return;

        if (tab === 'own') {
            void breed.mutate({
                parentId1: ownPet1,
                parentId2: ownPet2,
                name: ownChildName.trim(),
            });
        } else if (spouseId) {
            void breed.mutate({
                parentId1: spousePetId,
                parentId2: spouseId,
                name: spouseChildName.trim(),
                crossOwner: true,
            });
        }
    };

    const breedDisabled = breed.isPending || breed.isAwaitingFulfillment || hasPendingBreed || !canSubmit;
    const showPendingNotices = !breed.isAwaitingFulfillment;

    return {
        tab,
        onTabChange: setTab,
        ownPetsTab: {
            petCount: pets.length,
            allPets,
            pet1: ownPet1,
            pet2: ownPet2,
            childName: ownChildName,
            onPet1Change: setOwnPet1,
            onPet2Change: setOwnPet2,
            onChildNameChange: setOwnChildName,
            areRelated,
            showPendingNotices,
        },
        withSpouseTab: {
            allPets,
            chain: activeKind,
            spousePetId,
            onSpousePetChange: setSpousePetId,
            childName: spouseChildName,
            onChildNameChange: setSpouseChildName,
            marriageLoading: marriageInfo.isLoading,
            isMarried: marriageInfo.isMarried,
            spouseId,
            studFeeLabel,
            areRelated,
            showPendingNotices,
        },
        breedButtonLabel,
        breedDisabled,
        onBreed,
        isAwaitingFulfillment: breed.isAwaitingFulfillment,
        success,
        hatchling,
        onHatchlingSeen,
        hashHint,
        receipt: breed.lifecycle,
    };
};
