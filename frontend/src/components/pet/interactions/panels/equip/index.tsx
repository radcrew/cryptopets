import React, { useEffect, useMemo, useState } from 'react';
import {
    describeItemEffect,
    getRarityColor,
    SLOT,
    useChainCapabilities,
    useEquipItem,
    useInventory,
    usePetEquipment,
    usePetList,
    type ItemDefinition,
} from '@shared/core';

import TransactionStatus from '@components/common/transaction-status';
import NeonButton from '@components/ui/neon-button';
import Icon, { ShieldIcon } from '@components/ui/icon';
import PetPicker from '@components/ui/pet-picker';
import PetStage, { StageKicker } from '@components/game/pet-stage';
import { Tones } from '@constants/tones';
import { useNotifyError } from '@hooks/useNotifyError';
import { useTxErrorToast } from '@hooks/useTxErrorToast';
import styles from './index.module.css';

/**
 * Gear a pet (roadmap §4).
 *
 * Composes the shared hooks directly and keeps its state local, rather than sitting on a
 * controller hook. Per CLAUDE.md the test for a controller is a multi-step state machine
 * the player watches — request, reveal, settle — and this has none: an equip is one
 * transaction whose only intermediate state is the wallet, which `TransactionStatus`
 * already renders.
 *
 * Three slots are always drawn, filled or not. An empty slot is information ("you could
 * put something here"), and rendering only what is equipped would make a bare pet look
 * like a pet with no slots.
 */

const SLOTS = [
    { index: SLOT.weapon, label: 'Weapon' },
    { index: SLOT.armor, label: 'Armor' },
    { index: SLOT.trinket, label: 'Trinket' },
] as const;

export type EquipPanelProps = {
    /**
     * Pet to open on, e.g. when the bag sends someone here to strip a specific one.
     *
     * A starting value, not a controlled prop: the picker inside stays usable, so arriving
     * with a pet chosen does not trap you on it. Changing it later re-selects, which is what
     * makes a second click from the bag land on the second pet.
     */
    initialPetId?: string | null;
};

const EquipPanel: React.FC<EquipPanelProps> = ({ initialPetId = null }) => {
    const { activeKind: chain, isConnected } = useChainCapabilities();
    const { pets } = usePetList();
    const notifyError = useNotifyError();

    const [selectedPet, setSelectedPet] = useState<string>(initialPetId ?? '');
    // Follows the caller when it changes, so clicking a second pet in the bag moves the
    // selection rather than leaving the panel on the first.
    useEffect(() => {
        if (initialPetId) setSelectedPet(initialPetId);
    }, [initialPetId]);
    /** Which item is chosen per slot, before the player commits it. */
    const [choice, setChoice] = useState<Record<number, string>>({});

    const petId = selectedPet || null;
    const { entries } = useInventory({ chain });
    const { bySlot, isLoading: slotsLoading } = usePetEquipment({ chain, petId });
    const { canEquip, equip, unequip, equipLifecycle, unequipLifecycle, isPending } = useEquipItem({
        chain,
        petId,
    });

    useTxErrorToast((equipLifecycle.error ?? unequipLifecycle.error) as Error | null);

    /**
     * Held equipment, bucketed by the slot it goes in.
     *
     * Filtered from the bag rather than fetched separately: the inventory read is already
     * on screen, and an item's slot is part of its definition, so a second query would ask
     * the server for something the client can answer.
     */
    const bySlotChoices = useMemo(() => {
        const buckets = new Map<number, ItemDefinition[]>();
        for (const entry of entries) {
            if (entry.item.category !== 'equipment' || entry.item.slot == null) continue;
            const bucket = buckets.get(entry.item.slot);
            if (bucket) bucket.push(entry.item);
            else buckets.set(entry.item.slot, [entry.item]);
        }
        return buckets;
    }, [entries]);

    const selectedPetObj = pets.find((pet) => String(pet.id) === selectedPet) ?? null;

    const handleEquip = async (slot: number) => {
        const itemType = choice[slot];
        if (!isConnected) {
            notifyError('Please connect your wallet first', undefined, 'equip-validation');
            return;
        }
        if (!selectedPet || !itemType) {
            notifyError('Pick a pet and an item first', undefined, 'equip-validation');
            return;
        }
        try {
            await equip(slot, itemType);
            setChoice((current) => ({ ...current, [slot]: '' }));
        } catch (err) {
            console.error('[equip]', err);
        }
    };

    const handleUnequip = async (slot: number) => {
        try {
            await unequip(slot);
        } catch (err) {
            console.error('[equip]', err);
        }
    };

    return (
        <>
            <div className="interface">
                <h4>
                    <Icon as={ShieldIcon} tone={Tones.Amber} />
                    Equipment
                </h4>
                <p>Fit your pet with gear. Stats apply in backend battles.</p>

                {/* The pet on its pedestal, its three gear slots beside it like a character
                    screen. Always drawn, with a "?" before a pet is chosen, so nothing moves. */}
                <PetStage
                    className="interaction-visual"
                    pet={selectedPetObj}
                    tone="amber"
                    emptyHint="Pick a pet from your roster below."
                >
                    <StageKicker>Gear</StageKicker>
                    {!canEquip && (
                        // Said out loud rather than shown as a dead control: on Solana there is
                        // no item contract yet, and on EVM the address may simply be unset.
                        <p className={styles.note}>Equipping is not available on this deployment yet.</p>
                    )}
                    {canEquip && !selectedPet && <p className={styles.note}>Choose a pet to see what it wears.</p>}
                    {selectedPet && canEquip && (
                        <ul className={styles.slots}>
                            {SLOTS.map(({ index, label }) => {
                                const equipped = bySlot.get(index);
                                const options = bySlotChoices.get(index) ?? [];
                                return (
                                    <li key={index} className={styles.slot}>
                                        <span className={styles.slotLabel}>{label}</span>

                                        {equipped ? (
                                            <>
                                                <span
                                                    className={styles.equipped}
                                                    style={
                                                        {
                                                            '--rarity': getRarityColor(equipped.item.rarity),
                                                        } as React.CSSProperties
                                                    }
                                                >
                                                    <span className={styles.equippedName}>
                                                        {equipped.item.name}
                                                    </span>
                                                    <span className={styles.equippedEffect}>
                                                        {describeItemEffect(equipped.item.effect)}
                                                    </span>
                                                </span>
                                                <NeonButton
                                                    tone="magenta"
                                                    size="sm"
                                                    onClick={() => void handleUnequip(index)}
                                                    disabled={isPending}
                                                >
                                                    Unequip
                                                </NeonButton>
                                            </>
                                        ) : (
                                            <>
                                                <select
                                                    className={styles.select}
                                                    aria-label={`${label} to equip`}
                                                    value={choice[index] ?? ''}
                                                    onChange={(event) =>
                                                        setChoice((current) => ({
                                                            ...current,
                                                            [index]: event.target.value,
                                                        }))
                                                    }
                                                    disabled={options.length === 0}
                                                >
                                                    <option value="">
                                                        {options.length === 0
                                                            ? 'Nothing for this slot'
                                                            : 'Choose an item…'}
                                                    </option>
                                                    {options.map((item) => (
                                                        <option key={item.itemType} value={item.itemType}>
                                                            {item.name}
                                                            {describeItemEffect(item.effect)
                                                                ? ` — ${describeItemEffect(item.effect)}`
                                                                : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                                <NeonButton
                                                    tone="emerald"
                                                    size="sm"
                                                    onClick={() => void handleEquip(index)}
                                                    disabled={isPending || !choice[index]}
                                                >
                                                    Equip
                                                </NeonButton>
                                            </>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </PetStage>

                <div className="picker">
                    <div className="field">
                        <span className="field-label">Your roster</span>
                        <PetPicker
                            pets={pets.map((pet) => ({ id: String(pet.id), pet }))}
                            value={selectedPet}
                            onChange={setSelectedPet}
                            label="Pet to equip"
                            emptyHint="You have no pets yet."
                        />
                    </div>
                </div>


                {selectedPet && canEquip && slotsLoading && (
                    <p className={styles.note}>Reading this pet’s gear…</p>
                )}

                {/* The lag is real and worth naming: these rows come from the indexed
                    projection, so a confirmed transaction shows up once the indexer has
                    seen it rather than the instant the wallet returns. */}
                {isPending && (
                    <p className={styles.note}>
                        Waiting for the change to be indexed — this can take a moment after
                        the transaction confirms.
                    </p>
                )}
            </div>

            <TransactionStatus lifecycle={equipLifecycle.phase !== 'idle' ? equipLifecycle : unequipLifecycle} />
        </>
    );
};

export default EquipPanel;
