import React, { useRef } from 'react';
import clsx from 'clsx';
import type { Pet } from '@shared/core';

import PetArt from '@components/pet/pet-art';
import styles from './index.module.css';

export type PetPickerOption = {
    id: string;
    pet: Pet;
};

export type PetPickerProps = {
    /** Pets to choose from, in display order. */
    pets: PetPickerOption[];
    /** Selected pet id, or '' for none. */
    value: string;
    onChange: (petId: string) => void;
    disabled?: boolean;
    /** Labels the group for assistive technology. */
    label: string;
    /** Shown when the player has no eligible pets. */
    emptyHint?: string;
    /** A wrapping grid of portraits, or one scrolling strip, the roster along a game screen. */
    layout?: 'grid' | 'strip';
};

/**
 * Pet chooser: every pet on screen as a tile, pick one by clicking it.
 *
 * Deliberately not a dropdown. A menu hides the pets behind a control and shows their
 * names as text, which is the one thing a pet is not — the art is how a player
 * recognises which pet is which. Laying them out costs the space a dropdown was
 * "saving", and these panels had that space going spare anyway.
 *
 * Semantics are a radio group rather than a listbox: exactly one pet is chosen, the
 * options are always visible, and there is no popup. That gives arrow-key navigation and
 * a single tab stop for free, which is the behaviour a keyboard user expects from a set
 * of visible choices.
 */
const PetPicker: React.FC<PetPickerProps> = ({
    pets,
    value,
    onChange,
    disabled = false,
    label,
    emptyHint = 'No pets available',
    layout = 'grid',
}) => {
    const groupRef = useRef<HTMLDivElement>(null);

    // Roving focus: arrows move between tiles and select as they go, matching how a
    // native radio group behaves. Bound to the tiles rather than the group, because the
    // group is never itself a tab stop.
    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
        if (!keys.includes(event.key) || pets.length === 0) return;
        event.preventDefault();

        const current = pets.findIndex((option) => option.id === value);
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        let next: number;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = pets.length - 1;
        else if (current < 0) next = 0;
        else next = (current + (forward ? 1 : -1) + pets.length) % pets.length;

        const option = pets[next];
        if (!option) return;
        onChange(option.id);
        const tiles = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
        tiles?.[next]?.focus();
    };

    if (pets.length === 0) {
        return <p className={styles.empty}>{emptyHint}</p>;
    }

    return (
        <div
            ref={groupRef}
            className={clsx(styles.grid, layout === 'strip' && styles.strip, disabled && styles.disabled)}
            role="radiogroup"
            aria-label={label}
        >
            {pets.map((option) => {
                const isSelected = option.id === value;
                return (
                    <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        // One tab stop for the whole group: tab reaches the selection,
                        // arrows move within it.
                        tabIndex={isSelected || (!value && option === pets[0]) ? 0 : -1}
                        className={clsx(styles.tile, isSelected && styles.isSelected)}
                        // The ring takes the pet's rarity colour, keyed in CSS so the picker needs
                        // nothing from @shared/core beyond the pet itself.
                        data-rarity={option.pet.rarity}
                        disabled={disabled}
                        onClick={() => onChange(option.id)}
                        onKeyDown={onKeyDown}
                    >
                        <span className={styles.art} aria-hidden>
                            <PetArt pet={option.pet} />
                        </span>
                        <span className={styles.name}>{option.pet.name}</span>
                        <span className={styles.level}>Lv {option.pet.level}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default PetPicker;
