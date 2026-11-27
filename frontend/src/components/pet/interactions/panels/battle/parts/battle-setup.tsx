import React, { useMemo } from 'react';
import clsx from 'clsx';
import {
    getLifePercent,
    getPetProperties,
    getRarityColor,
    getRarityName,
    opponentKey,
    shortAddress,
    type OpponentPet,
    type Pet,
    type ReadyPet,
    type WinEstimateResult,
    type EquippedItem,
    type OpponentsEmptyReason,
    describeNoOpponents,
    useChainCapabilities,
    usePetEquipmentForPets,
} from '@shared/core';
import { Tones } from '@constants/tones';
import { AuthActionButton } from '@components/common';
import Icon, { BattleIcon } from '@components/ui/icon';
import styles from '../index.module.css';
import EquippedBadges from '@components/pet/equipped-badges';
import PetPicker from '@components/ui/pet-picker';
import PetStage from '@components/game/pet-stage';

export type BattleSetupProps = {
    isStandaloneView: boolean;
    subtitle: string;
    selectedFighter: Pet | null;
    opponent?: OpponentPet;
    randomMatchDisabled: boolean;
    onRandomMatch: () => void;
    readyPets: ReadyPet[];
    /** The player's pets are still being read, so an empty list means "not yet", not "none". */
    petsLoading: boolean;
    selectedPet1: string;
    onSelectFighter: (petId: string) => void;
    sortedOpponents: OpponentPet[];
    selectedOpponentKey: string;
    onSelectOpponent: (key: string) => void;
    opponentsLoading: boolean;
    /** Why the picker is empty, when it is. Null whenever there is anything to show. */
    opponentsEmptyReason: OpponentsEmptyReason | null;
    onRefreshOpponents: () => void;
    onBattle: () => void;
    battleDisabled: boolean;
    battleButtonLabel: string;
    onCancel: () => void;
    winEstimate: WinEstimateResult;
};

/** Four real DNA-backed stats. AGI has no data backing, so we keep the app's
 *  STR / INT / DEF / VIT set rather than the mock's STR/AGI/INT/DEF. */
const STAT_KEYS = [
    { label: 'STR', key: 'attack' },
    { label: 'INT', key: 'intelligence' },
    { label: 'DEF', key: 'defense' },
    { label: 'VIT', key: 'life' },
] as const;

/**
 * One combatant on the arena floor: standing on its pedestal under a spotlight in its
 * side's colour, with its stats, its gear and its health beneath.
 *
 * The pedestal is there whether or not a pet is, holding a "?" and saying what to do, so
 * choosing a fighter steps one onto a stage already drawn and nothing around it moves.
 */
const CombatantCard: React.FC<{
    pet: Pet | OpponentPet | null;
    side: 'fighter' | 'rival';
    emptyLabel: string;
    owner?: string;
    /** Gear this combatant is wearing. It changes the fight, so it is worth seeing first. */
    equipped?: readonly EquippedItem[];
}> = ({ pet, side, emptyLabel, owner, equipped }) => {
    const rival = side === 'rival';
    const props = pet ? getPetProperties(pet) : null;
    const hp = pet ? getLifePercent(pet) : 0;

    return (
        <div className={clsx(styles.combatant, rival && styles.combatantRival)}>
            <div className={styles.combatantStage}>
                <PetStage pet={pet} tone={rival ? 'magenta' : 'cyan'} emptyHint={emptyLabel} />
                {pet && (
                    <EquippedBadges equipped={equipped} rarity={pet.rarity} size="md" corner="top-right" />
                )}
            </div>
            {pet && (
                <span className={styles.combatantRarity} style={{ color: getRarityColor(pet.rarity) }}>
                    {getRarityName(pet.rarity)}
                </span>
            )}
            {owner ? <div className={styles.combatantOwner}>{owner}</div> : null}
            <ul className={styles.combatantStats} aria-label="Stats">
                {STAT_KEYS.map((stat) => (
                    <li key={stat.label}>
                        <small>{stat.label}</small>
                        {props ? <b>{props[stat.key]}</b> : <b className={styles.statVoid} aria-hidden />}
                    </li>
                ))}
            </ul>
            <div className={styles.combatantHp}>
                <span className={styles.combatantHpHead}>
                    <b>HP</b>
                    {pet ? <span>{hp}/100</span> : null}
                </span>
                <span className={styles.combatantHpTrack}>
                    {pet ? (
                        <span
                            className={clsx(styles.combatantHpFill, rival && styles.combatantHpFillRival)}
                            style={{ width: `${hp}%` }}
                        />
                    ) : null}
                </span>
            </div>
        </div>
    );
};

/**
 * The battle setup screen, laid out like the arena in the game-feel prototype: the two
 * combatants face off on the floor with the win chance between them, and below them the
 * two rosters to pick from, as portraits rather than dropdowns, then the fight key.
 */
const BattleSetup: React.FC<BattleSetupProps> = ({
    isStandaloneView,
    subtitle,
    selectedFighter,
    opponent,
    randomMatchDisabled,
    onRandomMatch,
    readyPets,
    petsLoading,
    selectedPet1,
    onSelectFighter,
    sortedOpponents,
    selectedOpponentKey,
    onSelectOpponent,
    opponentsLoading,
    opponentsEmptyReason,
    onRefreshOpponents,
    onBattle,
    battleDisabled,
    battleButtonLabel,
    onCancel,
    winEstimate,
}) => {
    /**
     * Gear for both combatants in one request.
     *
     * The rival's gear matters as much as your own here — it is what makes an opponent
     * stronger than their level suggests — and it is a claim about chain state anyone is
     * entitled to check, which is why the read is public.
     */
    const { activeKind: chain } = useChainCapabilities();
    const petIds = useMemo(
        () => [selectedFighter?.id, opponent?.id].filter(Boolean).map(String),
        [selectedFighter?.id, opponent?.id],
    );
    const { byPet: equippedByPet } = usePetEquipmentForPets({ chain, petIds });

    const winRate = winEstimate.isLoading
        ? '…'
        : winEstimate.winProbability != null
        ? `${Math.round(winEstimate.winProbability * 100)}%`
        : '—';

    // The rail only draws a split it actually has. Without an estimate it shows neutral
    // hatching instead of filling to 50%, which would read as a real even match rather
    // than as "no estimate yet" — the two mean different things to someone deciding
    // whether to take the fight.
    const hasOdds = !winEstimate.isLoading && winEstimate.winProbability != null;
    const oddsPct = Math.round((winEstimate.winProbability ?? 0.5) * 100);

    // The rival list is keyed by owner+id, not by pet id: two players can hold the same
    // token id on different chains, and the panel reports the composite key back.
    const opponentOptions = useMemo(
        () => sortedOpponents.map((o) => ({ id: opponentKey(o.owner, o.id), pet: o })),
        [sortedOpponents],
    );

    // Names which of four situations produced the blank picker. They are identical to a
    // player and only some are theirs to act on, so "none" alone sends people looking for
    // a mistake that may not be theirs.
    const opponentEmpty = opponentsLoading
        ? 'Finding challengers…'
        : sortedOpponents.length === 0
        ? describeNoOpponents(opponentsEmptyReason)
        : 'Select an opponent';

    return (
        <div className={clsx('interface', styles.battleSetup)}>
            {!isStandaloneView && (
                <>
                    <h4>
                        <Icon as={BattleIcon} tone={Tones.Magenta} />
                        Battle Pets
                    </h4>
                    <p>{subtitle}</p>
                </>
            )}

            <div className={styles.showdown}>
                {/* Your fighter */}
                <div className={clsx(styles.combatantCol, styles.combatantColFighter)}>
                    <div className={styles.combatantColLabel}>Your Fighter</div>
                    <CombatantCard
                        pet={selectedFighter}
                        side="fighter"
                        emptyLabel={
                            petsLoading
                                ? 'Loading your pets…'
                                : readyPets.length === 0
                                ? 'No ready fighters'
                                : 'Choose your fighter'
                        }
                        equipped={selectedFighter ? equippedByPet.get(String(selectedFighter.id)) : undefined}
                    />
                </div>

                {/* The spine. One rail spanning both bays, rather than a VS floating between
                    two hairlines that joined nothing and a win-rate box off to itself. */}
                <div className={styles.vs}>
                    <div className={styles.vsMark}>VS</div>
                    <div className={clsx(styles.vsRail, !hasOdds && styles.vsRailUnknown)}>
                        {hasOdds ? (
                            <>
                                <div className={styles.vsRailFill} style={{ height: `${oddsPct}%` }} />
                                <div className={styles.vsRailPin} style={{ bottom: `${oddsPct}%` }} />
                            </>
                        ) : null}
                    </div>
                    <div className={styles.vsWinrate}>
                        <div className={styles.vsWinrateLabel}>Win Rate</div>
                        <div className={styles.vsWinrateVal}>{winRate}</div>
                    </div>
                </div>

                {/* On-chain rival */}
                <div className={clsx(styles.combatantCol, styles.combatantColRival)}>
                    <div className={styles.combatantColLabel}>On-Chain Rival</div>
                    <CombatantCard
                        pet={opponent ?? null}
                        side="rival"
                        emptyLabel={opponentEmpty}
                        owner={opponent ? shortAddress(opponent.owner) : undefined}
                        equipped={opponent ? equippedByPet.get(String(opponent.id)) : undefined}
                    />
                </div>
            </div>

            {/* The rosters: your ready pets, and the rivals open to a challenge. */}
            <div className={styles.rosters}>
                <section className={styles.roster} aria-label="Your fighters">
                    <div className={styles.rosterHead}>
                        <span>Pick your fighter</span>
                    </div>
                    <PetPicker
                        layout="strip"
                        label="Choose your fighter"
                        pets={readyPets}
                        value={selectedPet1}
                        onChange={onSelectFighter}
                        emptyHint={petsLoading ? 'Loading your pets…' : 'No ready fighters'}
                    />
                </section>
                <section className={clsx(styles.roster, styles.rosterRival)} aria-label="Rivals">
                    <div className={styles.rosterHead}>
                        <span>Pick a rival</span>
                        <button
                            type="button"
                            className={styles.rosterKey}
                            onClick={onRandomMatch}
                            disabled={randomMatchDisabled}
                            title={
                                selectedFighter
                                    ? 'Pick a random opponent near your fighter level'
                                    : 'Select your fighter first'
                            }
                        >
                            🎲 Random
                        </button>
                        <button
                            type="button"
                            className={styles.rosterKey}
                            onClick={onRefreshOpponents}
                            disabled={opponentsLoading}
                        >
                            {opponentsLoading ? '…' : 'Refresh'}
                        </button>
                    </div>
                    <PetPicker
                        layout="strip"
                        label="Select an opponent"
                        pets={opponentOptions}
                        value={selectedOpponentKey}
                        onChange={onSelectOpponent}
                        emptyHint={opponentEmpty}
                    />
                </section>
            </div>

            <div className={styles.actions}>
                <AuthActionButton tone="magenta" onClick={onBattle} disabled={battleDisabled}>
                    ⚔ {battleButtonLabel}
                </AuthActionButton>
                <button type="button" onClick={onCancel} className="cancel-button">
                    Cancel
                </button>
            </div>
        </div>
    );
};

export default BattleSetup;
