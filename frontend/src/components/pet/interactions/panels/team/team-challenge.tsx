import clsx from 'clsx';
import React, { useCallback, useMemo } from 'react';

import { AuthActionButton } from '@components/common';
import PetArt from '@components/pet/pet-art';
import InfoTooltip from '@components/ui/info-tooltip';
import { useTeamBattlePanel } from '@hooks/team/useTeamBattlePanel';
import {
    shortAddress,
    SQUAD_SIZE,
    type Tactic,
    type TeamOpponent,
    useChainCapabilities,
    usePetNames,
} from '@shared/core';

import duel from '../battle/index.module.css';
import { type ArtPet, teamPetArt } from './art';
import { tacticShort } from './tactics';
import TeamBattleScene, { type ScenePhase } from './team-battle-scene';
import { type BoardFighter, ZoneGrid } from './team-board';
import TeamLineup, { type LineupPet, ORDINALS } from './team-lineup';
import TeamPetGrid from './team-pet-grid';
import styles from './index.module.css';

const STATE_LABELS: Record<string, string> = {
    accepted: 'Challenge accepted. Freezing both teams…',
    committed: 'Waiting for the randomness round both sides were promised…',
    seeded: 'Fighting…',
    computed: 'Fight computed. Waiting for the independent verifier to agree…',
    verified: 'Verified. Signing the receipt…',
};

const teamLabel = (o: TeamOpponent) => `${shortAddress(o.defenderOwner)}'s team`;

/**
 * The team challenge screen, a view over `useTeamBattlePanel`, laid out like the duel's: your
 * squad on the left, the rival team on the right, and between them the order your squad acts in.
 * Each side is a lineup beside its zone, and the two zones face each other across the centre the
 * way they meet on the battle map.
 *
 * The rival side stays unknown. A defender's pets, tiles and tactics are not served before the
 * battle (they are what an attacker would counter-build from), so the screen shows only the
 * team's owner and level band, and the battle scene reveals the defenders with the result.
 */
const TeamChallenge: React.FC = () => {
    const panel = useTeamBattlePanel();
    const { activeKind } = useChainCapabilities();
    const { moving, inFlight } = panel;

    const ownPet = useCallback((petId: string) => panel.pets.find((p) => p.id === petId), [panel.pets]);
    const petName = useCallback((petId: string) => ownPet(petId)?.name ?? `Pet ${petId}`, [ownPet]);
    const ownArt = (petId: string): ArtPet => ownPet(petId) ?? teamPetArt(petId, 0n, petName(petId));
    const opponent = panel.opponent;

    // The defenders are named only once the verified result has revealed who they were.
    const rivalIds = useMemo(
        () => (panel.result?.playback.fighters[1] ?? []).map((f) => f.petId),
        [panel.result],
    );
    const rivalNames = usePetNames(activeKind === 'evm' || activeKind === 'solana' ? activeKind : null, rivalIds);
    const fighterName = useCallback(
        (side: 0 | 1, slot: number) => {
            const petId = panel.result?.playback.fighters[side][slot]?.petId ?? (side === 0 ? panel.squad[slot]?.petId : undefined);
            if (!petId) return side === 0 ? `Your pet ${slot + 1}` : `Rival ${slot + 1}`;
            return side === 0 ? petName(petId) : (rivalNames.get(petId) ?? `Pet ${petId}`);
        },
        [panel.result, panel.squad, petName, rivalNames],
    );

    const orderOf = (slot: number) => {
        const i = panel.turnOrder.indexOf(slot);
        return i >= 0 ? i : undefined;
    };
    // A zone tile says when its pet acts and how, so the order and tactics read at a glance.
    const tileSub = (slot: number, tactic: Tactic) => {
        const order = orderOf(slot);
        return order !== undefined ? `${ORDINALS[order]} · ${tacticShort(tactic)}` : tacticShort(tactic);
    };

    const ownLineup: LineupPet[] = panel.squad.map((m, slot) => {
        const pet = ownPet(m.petId);
        return {
            petId: m.petId,
            art: ownArt(m.petId),
            name: petName(m.petId),
            level: pet?.level ?? 1,
            rarity: pet?.rarity ?? 1,
            dna: pet?.dna ?? 0n,
            speciesId: pet?.speciesId,
            tactic: m.tactic,
            order: orderOf(slot),
        };
    });
    const railEntries = panel.turnOrder.map((slot) => ({ slot, pet: ownLineup[slot] }));

    // Why the battle cannot start yet, or that it can.
    const hint = inFlight
        ? 'Your team battle is under way.'
        : panel.petsLoading
        ? 'Loading your pets…'
        : !panel.signedIn
          ? 'Sign in to challenge a team.'
          : !opponent
          ? 'Choose a team to challenge.'
          : !opponent.ready
            ? 'This team is resting. Choose another.'
            : panel.squad.length < SQUAD_SIZE
              ? `Add ${SQUAD_SIZE - panel.squad.length} more pet${SQUAD_SIZE - panel.squad.length === 1 ? '' : 's'} to your squad.`
              : !panel.levelInBand
                ? `This team takes challengers from level ${opponent.minLevel} to ${opponent.maxLevel}, and your squad counts as level ${panel.squadLevel}.`
                : !panel.squadReady
                  ? 'One of your pets is still resting.'
                  : 'Ready to fight.';
    const blocked = hint !== 'Ready to fight.';

    const opponentEmpty = !panel.signedIn
        ? 'Sign in to see teams'
        : panel.opponentsLoading
        ? 'Finding teams…'
        : panel.opponents.length === 0
          ? 'No teams are open right now'
          : 'Choose a team';

    // Your squad as it lines up; the defenders' half of the map stays unknown until the result.
    const lineup: BoardFighter[] = panel.squad.map((m, slot) => ({
        side: 0,
        slot,
        x: m.col,
        row: m.row,
        art: ownArt(m.petId),
        name: petName(m.petId),
        hp: 1,
        startHp: 1,
        note: tacticShort(m.tactic),
    }));
    const status =
        panel.phase === 'submitting'
            ? 'Confirm the challenge in your wallet…'
            : panel.phase === 'failed'
              ? `This battle did not finish: ${panel.failureReason ?? panel.error?.message ?? 'unknown reason'}.`
              : panel.phase === 'running'
                ? (STATE_LABELS[panel.battleState ?? 'accepted'] ?? 'Battle in progress…')
                : null;

    return (
        <>
            {panel.inBattle && !panel.sceneOpen && (
                <p className={styles.status} role="status">
                    {inFlight ? 'Your team battle is still running.' : 'Your team battle has finished.'}{' '}
                    <button type="button" className={styles.linkButton} onClick={panel.showScene}>
                        {inFlight ? 'Watch it' : 'See the result'}
                    </button>
                </p>
            )}

            <div className={clsx('interface', duel.battleSetup, styles.teamSetup)}>
                <div className={clsx(duel.showdown, styles.teamShowdown)}>
                    {/* Your squad */}
                    <div className={clsx(duel.combatantCol, duel.combatantColFighter)}>
                        <div className={duel.combatantColLabel}>Your Squad</div>
                        <div className={styles.squadBar}>
                            <span>
                                <strong>
                                    {panel.squad.length}/{SQUAD_SIZE}
                                </strong>{' '}
                                pets
                            </span>
                            {panel.squadLevel !== null && <span>Counts as level {panel.squadLevel}</span>}
                            <InfoTooltip subject="Building your squad">
                                Pick three pets from your list below. Select one of yours, then tap an empty tile to move
                                it, or drag it onto another pet to swap them. Melee pets can only reach the enemy front
                                line, the column nearest the centre. A squad counts as its highest-level pet against a
                                team&apos;s level range.
                            </InfoTooltip>
                        </div>
                        <div className={styles.bay}>
                            <TeamLineup
                                label="Your squad"
                                slots={SQUAD_SIZE}
                                pets={ownLineup}
                                selectedPetId={moving}
                                onSelect={inFlight ? undefined : panel.selectPet}
                                onTacticChange={inFlight ? undefined : panel.setTactic}
                            />
                            <ZoneGrid
                                label="Your zone"
                                side={0}
                                members={panel.squad.map((m, slot) => ({
                                    petId: m.petId,
                                    col: m.col,
                                    row: m.row,
                                    art: ownArt(m.petId),
                                    label: petName(m.petId),
                                    sub: tileSub(slot, m.tactic),
                                }))}
                                selectedPetId={moving}
                                onPetClick={inFlight ? undefined : panel.selectPet}
                                onEmptyClick={moving && !inFlight ? panel.placeMoving : undefined}
                                onDropPet={inFlight ? undefined : panel.placePet}
                            />
                        </div>
                    </div>

                    {/* The spine: the order your squad acts in among itself. */}
                    <div className={clsx(duel.vs, styles.teamVs)}>
                        <div className={duel.vsMark}>VS</div>
                        <ol className={styles.turnRail} aria-label="Your squad's turn order">
                            {railEntries.map((e, i) => (
                                <li key={e.slot} className={styles.turnPip} title={`${ORDINALS[i]}: ${e.pet?.name ?? ''}`}>
                                    <span className={styles.turnPipArt} aria-hidden>
                                        {e.pet && <PetArt pet={e.pet.art} />}
                                    </span>
                                    <span className={styles.turnPipNum}>{i + 1}</span>
                                    <span className={styles.srOnly}>{`${ORDINALS[i]}: ${e.pet?.name ?? ''}`}</span>
                                </li>
                            ))}
                        </ol>
                        {railEntries.length > 0 && <div className={duel.vsWinrateLabel}>Your order</div>}
                    </div>

                    {/* The rival team: who and which levels, never which pets. */}
                    <div className={clsx(duel.combatantCol, duel.combatantColRival)}>
                        <div className={duel.combatantColLabel}>Rival Team</div>
                        {/* Every open team as a card to pick: whose it is and the levels it takes. With
                            none, the empty bay below says why. */}
                        {panel.opponents.length > 0 && (
                            <div className={styles.teamCards} role="radiogroup" aria-label="Choose a team to challenge">
                                {panel.opponents.map((o) => {
                                    const chosen = opponent?.planHash === o.planHash;
                                    return (
                                        <button
                                            key={o.planHash}
                                            type="button"
                                            role="radio"
                                            aria-checked={chosen}
                                            className={clsx(
                                                styles.teamCard,
                                                chosen && styles.teamCardChosen,
                                                !o.ready && styles.teamCardResting,
                                            )}
                                            disabled={inFlight || !o.ready}
                                            onClick={() => panel.chooseOpponent(o)}
                                        >
                                            <span className={styles.teamCardCrest} aria-hidden>
                                                🛡️
                                            </span>
                                            <span className={styles.teamCardName}>{teamLabel(o)}</span>
                                            <span className={styles.teamCardLevels}>
                                                Lv {o.minLevel}–{o.maxLevel}
                                                {o.ready ? '' : ' · resting'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        <div className={duel.combatantSelect}>
                            <button
                                type="button"
                                className={duel.combatantSelectBtn}
                                onClick={panel.chooseRandomOpponent}
                                disabled={inFlight || panel.opponents.length === 0}
                                title="Pick a random ready team your squad's level qualifies for"
                            >
                                🎲 Random
                            </button>
                            <button
                                type="button"
                                className={duel.combatantSelectBtn}
                                onClick={panel.refreshOpponents}
                                disabled={!panel.signedIn || panel.opponentsFetching}
                            >
                                {panel.opponentsFetching ? '…' : 'Refresh'}
                            </button>
                        </div>
                        {opponent ? (
                            <div className={styles.bay}>
                                <ZoneGrid label="Rival zone, hidden until the battle" side={1} members={[]} concealed />
                                <TeamLineup label="Rival team" slots={SQUAD_SIZE} pets={[]} concealed />
                            </div>
                        ) : (
                            <div className={clsx(styles.bay, styles.bayEmpty)}>
                                <div className={duel.combatantCardArena} aria-hidden>
                                    <div className={duel.combatantCardArenaGrid} />
                                    <div className={duel.combatantCardArenaPlinth} />
                                    <div className={duel.combatantCardArenaSweep} />
                                </div>
                                <p className={styles.bayPlaceholder}>{opponentEmpty}</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className={duel.actions}>
                    <AuthActionButton tone="magenta" onClick={() => void panel.start()} disabled={!panel.canStart}>
                        ⚔ Start Team Battle
                    </AuthActionButton>
                    <button type="button" onClick={panel.cancel} disabled={inFlight} className="cancel-button">
                        Cancel
                    </button>
                </div>
                <p className={clsx(styles.startHint, blocked && styles.startHintBlocked)} role="status">
                    {hint}
                </p>
                {panel.error && !panel.inBattle && <p className={styles.error}>{panel.error.message}</p>}

                <TeamPetGrid
                    label="Your pets"
                    pets={panel.pets}
                    loading={panel.petsLoading}
                    selected={panel.squad.map((m) => m.petId)}
                    max={SQUAD_SIZE}
                    blockResting
                    disabled={inFlight}
                    onToggle={(petId) =>
                        panel.squad.some((m) => m.petId === petId) ? panel.removePet(petId) : panel.addPet(petId)
                    }
                />
            </div>

            {panel.sceneOpen && (
                <TeamBattleScene
                    key={panel.battleId ?? 'pending'}
                    phase={panel.phase as ScenePhase}
                    status={status}
                    lineup={lineup}
                    result={panel.phase === 'result' ? panel.result : null}
                    name={fighterName}
                    rivalLabel={opponent ? teamLabel(opponent) : 'the rival team'}
                    onDone={panel.reset}
                    onHide={panel.hideScene}
                    awaitingPulse={
                        panel.phase === 'running' &&
                        (panel.battleState === 'accepted' || panel.battleState === 'committed')
                    }
                />
            )}
        </>
    );
};

export default TeamChallenge;
