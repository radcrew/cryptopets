import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
    getGeneration,
    getLifePercent,
    getPetClass,
    getPetProperties,
    getPetSkill,
    getRarityColor,
    getRarityName,
    getXpNumbers,
    getXpPercent,
    SLOT_NAMES,
    useChainCapabilities,
    usePetCooldowns,
    usePetEquipmentForPets,
    usePetList,
    type EquippedItem,
    type Pet,
    type PetCooldownStatus,
} from '@shared/core';

import ItemArt from '@components/item/item-art';
import CompanionPreview from '@components/pet/companion-preview';
import PetArt from '@components/pet/pet-art';
import StoryPreview from '@components/pet/story-preview';
import SendPetModal from '@components/pet/transfer/send-pet-modal';
import {
    BATTLE_PATH,
    BREED_PATH,
    INVENTORY_PATH,
    LEVELUP_PATH,
    RENAME_PATH,
    TRAIN_PATH,
} from '@constants/interactionRoutes';
import styles from './pet-sheet.module.css';

const SLOT_ICONS: Record<string, string> = { weapon: '⚔️', armor: '🛡️', trinket: '💠' };

/** The four stats derived from the pet's DNA. AGI has no backing in the data model, so the
 *  fourth is VIT (life). */
const stats = (pet: Pet) => {
    const p = getPetProperties(pet);
    return [
        { label: 'STR', value: p.attack, icon: '⚔️' },
        { label: 'INT', value: p.intelligence, icon: '🧠' },
        { label: 'DEF', value: p.defense, icon: '🛡️' },
        { label: 'VIT', value: p.life, icon: '❤️' },
    ];
};

type Overlay = 'send' | 'story' | 'talk' | null;

/**
 * One pet's character sheet, opened by tapping it on the Shore or in the party.
 *
 * Everything the old collection card showed, from the same reads: art, rarity, level,
 * skill, HP, XP, record, DNA stats, gear and cooldowns. Below them, a key for every
 * action. The actions that live on their own pages open that page with this pet already
 * chosen (`navigate(path, { state: { petId } })`, read by `usePetChoice`); sending, and the
 * story and companion previews, open over the sheet.
 */
const PetSheet: React.FC<{ petId: string; onClose: () => void; onBack?: () => void }> = ({
    petId,
    onClose,
    onBack,
}) => {
    const navigate = useNavigate();
    const { activeKind } = useChainCapabilities();
    const { pets } = usePetList();
    const pet = pets.find((p) => String(p.id) === petId) ?? null;
    const { statusFor } = usePetCooldowns(pet ? [pet] : []);
    const { byPet } = usePetEquipmentForPets({ chain: activeKind, petIds: pet ? [petId] : [] });
    const [overlay, setOverlay] = useState<Overlay>(null);
    const sheet = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        sheet.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
    }, []);

    // Escape closes the sheet only when nothing is open over it; those close themselves.
    useEffect(() => {
        if (overlay) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [overlay]);

    const go = (path: string) => navigate(path, { state: { petId } });

    const body = !pet ? (
        <div className={styles.gone}>
            <p>This pet is no longer in your party.</p>
            <button type="button" className={styles.keySmall} onClick={onClose} data-autofocus>
                Close
            </button>
        </div>
    ) : (
        <SheetBody pet={pet} cooldown={statusFor(pet)} equipped={byPet.get(petId)} go={go} onOverlay={setOverlay} />
    );

    return createPortal(
        <div className={styles.veil}>
            <div
                ref={sheet}
                className={styles.sheet}
                role="dialog"
                aria-modal="true"
                aria-label={pet ? `${pet.name}'s sheet` : 'Pet sheet'}
                style={pet ? ({ '--rc': getRarityColor(pet.rarity) } as React.CSSProperties) : undefined}
            >
                <div className={styles.topKeys}>
                    {onBack ? (
                        <button type="button" className={styles.round} onClick={onBack} aria-label="Back to your party">
                            ‹
                        </button>
                    ) : (
                        <span />
                    )}
                    <button type="button" className={styles.round} onClick={onClose} aria-label="Close" data-autofocus>
                        ×
                    </button>
                </div>
                {body}
            </div>

            {pet && overlay === 'send' && (
                <SendPetModal isOpen onClose={() => setOverlay(null)} pet={pet} petId={BigInt(pet.id)} />
            )}
            {pet && overlay === 'story' && <StoryPreview pet={pet} onClose={() => setOverlay(null)} />}
            {pet && overlay === 'talk' && <CompanionPreview pet={pet} onClose={() => setOverlay(null)} />}
        </div>,
        document.body,
    );
};

const SheetBody: React.FC<{
    pet: Pet;
    cooldown: PetCooldownStatus;
    equipped: readonly EquippedItem[] | undefined;
    go: (path: string) => void;
    onOverlay: (overlay: Overlay) => void;
}> = ({ pet, cooldown, equipped, go, onOverlay }) => {
    const skill = getPetSkill(pet.speciesId);
    const xp = getXpNumbers(pet);
    const hp = getLifePercent(pet);
    const fought = pet.winCount + pet.lossCount;
    const winRate = fought === 0 ? null : Math.round((pet.winCount / fought) * 100);
    const gear = [0, 1, 2].map((slot) => ({ slot, name: SLOT_NAMES[slot] ?? 'gear', worn: equipped?.find((e) => e.slot === slot) }));

    return (
        <div className={styles.body}>
            <div className={styles.hero}>
                <div className={styles.portrait}>
                    <PetArt pet={pet} fill emojiClassName={styles.emoji} />
                    <span className={styles.ribbon}>{getRarityName(pet.rarity)}</span>
                    <span className={styles.level}>Lv {pet.level}</span>
                </div>
                <h2 className={styles.name}>{pet.name}</h2>
                <p className={styles.kind}>
                    {getPetClass(pet.dna)} · Gen {pet.generation ?? getGeneration(pet.dna)}
                </p>
                {skill && (
                    <span className={styles.skill} title={skill.description}>
                        {skill.name}
                    </span>
                )}
            </div>

            <div className={styles.details}>
                <div className={styles.bars}>
                    <Bar label="HP" value={`${hp}%`} percent={hp} tone="hp" />
                    <Bar label="XP" value={`${xp.xpCurrent} / ${xp.xpMax}`} percent={getXpPercent(pet)} tone="xp" />
                </div>

                <div className={styles.record}>
                    <span className={styles.wins}>{pet.winCount}W</span>
                    <span className={styles.losses}>{pet.lossCount}L</span>
                    <span>{winRate === null ? 'No battles yet' : `${winRate}% win rate`}</span>
                </div>

                <ul className={styles.stats}>
                    {stats(pet).map((s) => (
                        <li key={s.label} className={styles.stat}>
                            <span aria-hidden>{s.icon}</span>
                            <b>{s.value}</b>
                            <small>{s.label}</small>
                        </li>
                    ))}
                </ul>

                <div className={styles.gear} aria-label="Gear">
                    {gear.map(({ slot, name, worn }) => (
                        <span key={slot} className={clsx(styles.slot, worn && styles.slotWorn)} title={worn ? worn.item.name : `No ${name}`}>
                            {worn ? <ItemArt item={worn.item} /> : <span aria-hidden>{SLOT_ICONS[name]}</span>}
                            <small>{worn ? worn.item.name : name}</small>
                        </span>
                    ))}
                </div>

                {cooldown.onCooldown && (
                    <div className={styles.cooldowns}>
                        {cooldown.battleOnCooldown && <span>⚔️ Battle in {cooldown.battleLabel}</span>}
                        {cooldown.breedOnCooldown && <span>🥚 Breed in {cooldown.breedLabel}</span>}
                        {cooldown.trainOnCooldown && <span>💪 Train in {cooldown.trainLabel}</span>}
                    </div>
                )}

                <div className={styles.actions}>
                    <button type="button" className={clsx(styles.key, styles.battle)} onClick={() => go(BATTLE_PATH)}>
                        ⚔️ Battle
                    </button>
                    <button type="button" className={clsx(styles.key, styles.train)} onClick={() => go(TRAIN_PATH)}>
                        💪 Train
                    </button>
                    <button type="button" className={clsx(styles.key, styles.levelUp)} onClick={() => go(LEVELUP_PATH)}>
                        ⬆️ Level up
                    </button>
                    <button type="button" className={clsx(styles.key, styles.breed)} onClick={() => go(BREED_PATH)}>
                        🥚 Breed
                    </button>
                    <button type="button" className={clsx(styles.key, styles.rename)} onClick={() => go(RENAME_PATH)}>
                        ✒️ Rename
                    </button>
                    <button type="button" className={clsx(styles.key, styles.gearKey)} onClick={() => go(INVENTORY_PATH)}>
                        🎒 Gear
                    </button>
                </div>

                <div className={styles.extras}>
                    <button type="button" className={styles.keySmall} onClick={() => onOverlay('story')} aria-label={`${pet.name}'s story, coming soon`}>
                        📖 Story <small>soon</small>
                    </button>
                    <button type="button" className={styles.keySmall} onClick={() => onOverlay('talk')} aria-label={`Talk with ${pet.name}, coming soon`}>
                        💬 Talk <small>soon</small>
                    </button>
                    <button type="button" className={styles.keySmall} onClick={() => onOverlay('send')} aria-label={`Send ${pet.name}`}>
                        📤 Send
                    </button>
                </div>
            </div>
        </div>
    );
};

const Bar: React.FC<{ label: string; value: string; percent: number; tone: 'hp' | 'xp' }> = ({ label, value, percent, tone }) => (
    <div className={styles.bar}>
        <span className={styles.barHead}>
            <b>{label}</b>
            <span>{value}</span>
        </span>
        <span className={styles.barTrack}>
            <span className={clsx(styles.barFill, styles[tone])} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </span>
    </div>
);

export default PetSheet;
