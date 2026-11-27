import React from 'react';
import clsx from 'clsx';
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
    type Pet,
    type EquippedItem,
    type PetCooldownStatus,
} from '@shared/core';
import { Tones } from '@constants/tones';
import Icon, { BattleIcon, SendIcon } from '@components/ui/icon';
import PetArt from '@components/pet/pet-art';
import EquippedBadges from '@components/pet/equipped-badges';
import styles from '../index.module.css';

/** Four stat tiles derived from the pet's DNA properties. AGI has no backing in
 *  the data model, so the fourth tile shows VIT (life); see plan §8 Q2. */
const petStatTiles = (pet: Pet): { label: string; value: number }[] => {
    const p = getPetProperties(pet);
    return [
        { label: 'STR', value: p.attack },
        { label: 'INT', value: p.intelligence },
        { label: 'DEF', value: p.defense },
        { label: 'VIT', value: p.life },
    ];
};

const winRatio = (pet: Pet): number => {
    const total = pet.winCount + pet.lossCount;
    return total === 0 ? 0 : Math.round((pet.winCount / total) * 100);
};

type PetCardProps = {
    pet: Pet;
    cooldown: PetCooldownStatus;
    /** Gear worn by this pet. Undefined until the batched read lands, empty for a bare pet. */
    equipped?: readonly EquippedItem[];
    onBattle: () => void;
    onSendClick: () => void;
};

/** One pet's card in the gallery grid: rarity/level/skill, avatar, XP, record,
 *  DNA stat tiles, cooldown status, and the Battle/Send actions. */
const PetCard: React.FC<PetCardProps> = ({ pet, cooldown, equipped, onBattle, onSendClick }) => {
    const rarityColor = getRarityColor(pet.rarity);
    const xp = getXpNumbers(pet);
    const skill = getPetSkill(pet.speciesId);

    return (
        // The card's frame glows in the pet's own rarity colour, like a collectible card.
        <div className={styles.petCard} style={{ '--rc': rarityColor } as React.CSSProperties}>
            <div
                className={styles.rarityBar}
                style={{ background: rarityColor, boxShadow: `0 0 8px ${rarityColor}` }}
            />
            <div className={styles.visual}>
                <div className={styles.rarity}>
                    {getRarityName(pet.rarity)}
                </div>
                <div className={styles.level}>Lv. {pet.level}</div>
                {skill ? (
                    <div className={styles.skill} title={skill.description}>
                        {skill.name}
                    </div>
                ) : null}
                {/* Not wrapped in `.avatar`: that class carries a drop-shadow and
                    an animated transform, either of which would become the
                    containing block for the filling image and pin it to the
                    emoji's size. It goes on the emoji itself instead. */}
                <PetArt pet={pet} fill emojiClassName={styles.avatar} />
                {/* Inside the art wrapper, which is the positioned ancestor the badges pin to. */}
                <EquippedBadges equipped={equipped} rarity={pet.rarity} />
            </div>

            <div className={styles.info}>
                <div className={styles.head}>
                    <div>
                        <div className={styles.name}>{pet.name}</div>
                        <div className={styles.petClass}>
                            {getPetClass(pet.dna)} · Gen {pet.generation ?? getGeneration(pet.dna)}
                        </div>
                    </div>
                    <div className={styles.hp}>
                        <span className={styles.hpLabel}>HP</span>
                        <span className={styles.hpValue}>{getLifePercent(pet)}%</span>
                    </div>
                </div>

                <div>
                    <div className={styles.xpRow}>
                        <span className={styles.xpLabel}>XP</span>
                        <span className={styles.xpValue}>
                            {xp.xpCurrent}/{xp.xpMax}
                        </span>
                    </div>
                    <div className={styles.xpTrack}>
                        <div className={styles.xpFill} style={{ width: `${getXpPercent(pet)}%` }} />
                    </div>
                </div>

                <div className={styles.record}>
                    <span className={styles.wins}>{pet.winCount}W</span>
                    <span className={styles.sep}>/</span>
                    <span className={styles.losses}>{pet.lossCount}L</span>
                    <span className={styles.dot}>·</span>
                    <span className={styles.wr}>{winRatio(pet)}% WR</span>
                </div>
            </div>

            <div className={styles.cardStats}>
                {petStatTiles(pet).map((tile) => (
                    <div className={styles.statTile} key={tile.label}>
                        <div className={styles.tileLabel}>{tile.label}</div>
                        <div className={styles.tileValue}>{tile.value}</div>
                    </div>
                ))}
            </div>

            {cooldown.onCooldown && (
                <div className={styles.status}>
                    {cooldown.battleOnCooldown && (
                        <div className={styles.cooldown}>⚔️ Battle ready in {cooldown.battleLabel}</div>
                    )}
                    {cooldown.breedOnCooldown && (
                        <div className={styles.cooldown}>🥚 Breed ready in {cooldown.breedLabel}</div>
                    )}
                    {cooldown.trainOnCooldown && (
                        <div className={styles.cooldown}>💪 Train ready in {cooldown.trainLabel}</div>
                    )}
                </div>
            )}

            <div className={styles.actions}>
                <button type="button" className={styles.battleBtn} onClick={onBattle}>
                    <Icon as={BattleIcon} tone={Tones.Magenta} glow="none" noGap />
                    Battle
                </button>
                <button
                    type="button"
                    className={clsx(styles.sendBtn, !cooldown.battleReady && styles.onCooldown)}
                    onClick={onSendClick}
                    title="Send / transfer pet"
                    aria-label={`Send ${pet.name}`}
                >
                    <Icon as={SendIcon} tone={cooldown.battleReady ? Tones.Emerald : Tones.Amber} glow="none" noGap />
                </button>
            </div>
        </div>
    );
};

export default PetCard;
