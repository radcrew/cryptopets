import React, { useCallback, useState } from 'react';

import PetArt from '@components/pet/pet-art';
import NeonButton from '@components/ui/neon-button';
import { SQUAD_SIZE, useTeamBattlePanel } from '@hooks/team/useTeamBattlePanel';
import type { Tactic } from '@shared/core';

import { type ArtPet, teamPetArt } from './art';
import { TACTIC_OPTIONS } from './tactics';
import { ZoneGrid } from './team-board';
import TeamPetDetails, { type PetSelection, rankFact } from './team-pet-details';
import TeamPetGrid from './team-pet-grid';
import TeamPlayback from './team-playback';
import styles from './index.module.css';

const STATE_LABELS: Record<string, string> = {
    accepted: 'Challenge accepted. Freezing both teams…',
    committed: 'Waiting for the randomness round both sides were promised…',
    seeded: 'Drawing the defenders and fighting…',
    computed: 'Fight computed. Waiting for the independent verifier to agree…',
    verified: 'Verified. Signing the receipt…',
};

const ORDINALS = ['1st', '2nd', '3rd'] as const;

/**
 * The team challenge flow, a view over `useTeamBattlePanel`: pick a defender, build and place a
 * squad of three, sign, then watch the verified battle.
 */
const TeamChallenge: React.FC = () => {
    const panel = useTeamBattlePanel();
    // The pet whose details are shown: one of the player's, which can then be moved, or a rival's.
    const [inspected, setInspected] = useState<{ side: 0 | 1; petId: string } | null>(null);
    const toggleInspected = (side: 0 | 1, petId: string) =>
        setInspected((current) => (current?.side === side && current.petId === petId ? null : { side, petId }));
    const ownPet = useCallback((petId: string) => panel.pets.find((p) => p.id === petId), [panel.pets]);
    const petName = useCallback((petId: string) => ownPet(petId)?.name ?? `Pet ${petId}`, [ownPet]);
    const ownArt = (petId: string): ArtPet => ownPet(petId) ?? teamPetArt(petId, 0n, petName(petId));
    const fighterName = useCallback(
        (side: 0 | 1, slot: number) => {
            const view = panel.result?.playback.fighters[side][slot];
            if (!view) return side === 0 ? `Your pet ${slot + 1}` : `Rival ${slot + 1}`;
            if (side === 0) return petName(view.petId);
            return panel.opponent?.roster.find((p) => p.petId === view.petId)?.name ?? `Pet ${view.petId}`;
        },
        [panel.opponent, panel.result, petName],
    );

    if (panel.phase === 'result' && panel.result) {
        return <TeamPlayback result={panel.result} name={fighterName} onDone={panel.reset} />;
    }

    if (panel.phase === 'running' || panel.phase === 'submitting') {
        return (
            <div className={styles.panel}>
                <p className={styles.status} role="status">
                    {panel.phase === 'submitting'
                        ? 'Confirm the challenge in your wallet…'
                        : (STATE_LABELS[panel.battleState ?? 'accepted'] ?? 'Battle in progress…')}
                </p>
            </div>
        );
    }

    if (panel.phase === 'failed') {
        return (
            <div className={styles.panel}>
                <p className={styles.error} role="alert">
                    This battle did not finish: {panel.failureReason ?? panel.error?.message ?? 'unknown reason'}.
                </p>
                <NeonButton tone="azure" onClick={panel.reset}>
                    Back to opponents
                </NeonButton>
            </div>
        );
    }

    if (panel.phase === 'choose-opponent' || !panel.opponent) {
        return (
            <div className={styles.panel}>
                <p className={styles.muted}>
                    Each defender sets five pets. Three of them, drawn at random with higher ranks
                    more likely, meet your squad of three on the battle map.
                </p>
                {panel.opponentsLoading && <p className={styles.muted}>Loading teams…</p>}
                {!panel.opponentsLoading && panel.opponents.length === 0 && (
                    <p className={styles.muted}>No teams are open to challenges right now.</p>
                )}
                <div className={styles.list}>
                    {panel.opponents.map((o) => (
                        <div key={o.planHash} className={styles.listItem}>
                            <div className={styles.rosterStrip}>
                                {[...o.roster]
                                    .sort((a, b) => a.rank - b.rank)
                                    .map((p) => (
                                        <span key={p.petId} className={styles.rosterPet} title={`${p.name}, level ${p.level}, rank ${p.rank}`}>
                                            <span className={styles.miniArt} aria-hidden>
                                                <PetArt pet={teamPetArt(p.petId, p.dna, p.name)} />
                                            </span>
                                            <span className={styles.tokenName}>{p.name}</span>
                                            <span className={styles.tokenSub}>Lv {p.level}</span>
                                        </span>
                                    ))}
                            </div>
                            <span className={styles.muted}>{o.ready ? `Levels ${o.minLevel}–${o.maxLevel}` : 'Resting'}</span>
                            <NeonButton size="sm" tone="magenta" disabled={!o.ready} onClick={() => panel.chooseOpponent(o)}>
                                Challenge
                            </NeonButton>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const opponent = panel.opponent;
    const squadIds = panel.squad.map((m) => m.petId);
    const movingPetId = inspected?.side === 0 ? inspected.petId : null;
    const selection = ((): PetSelection | null => {
        if (inspected?.side === 0) {
            const slot = panel.squad.findIndex((m) => m.petId === inspected.petId);
            const member = panel.squad[slot];
            const pet = ownPet(inspected.petId);
            if (!member || !pet) return null;
            const order = panel.turnOrder.indexOf(slot);
            return {
                petId: pet.id,
                side: 0,
                pet: { art: pet, name: pet.name, level: pet.level, rarity: pet.rarity, dna: pet.dna, speciesId: pet.speciesId, readyAt: pet.readyAt },
                col: member.col,
                row: member.row,
                tactic: member.tactic,
                facts: order >= 0 ? [{ label: 'Turn order', value: `Acts ${ORDINALS[order] ?? order + 1} in your squad` }] : [],
            };
        }
        if (inspected?.side === 1) {
            const p = opponent.roster.find((r) => r.petId === inspected.petId);
            if (!p) return null;
            return {
                petId: p.petId,
                side: 1,
                pet: { art: teamPetArt(p.petId, p.dna, p.name), name: p.name, level: p.level, rarity: p.rarity, dna: BigInt(p.dna), speciesId: p.speciesId, readyAt: p.readyAt },
                col: p.col,
                row: p.row,
                tactic: p.tactic,
                facts: [rankFact(p.rank)],
            };
        }
        return null;
    })();
    return (
        <div className={styles.panel}>
            <div className={styles.row}>
                <div className={styles.zoneColumn}>
                    <h4>Your squad</h4>
                    <ZoneGrid
                        label="Your zone"
                        side={0}
                        members={panel.squad.map((m) => ({ petId: m.petId, col: m.col, row: m.row, art: ownArt(m.petId), label: petName(m.petId) }))}
                        selectedPetId={movingPetId}
                        onPetClick={(petId) => toggleInspected(0, petId)}
                        onEmptyClick={movingPetId ? (col, row) => panel.placePet(movingPetId, col, row) : undefined}
                        onDropPet={panel.placePet}
                    />
                </div>
                <div className={styles.zoneColumn}>
                    <h4>Their team</h4>
                    <ZoneGrid
                        label="Rival zone"
                        side={1}
                        selectedPetId={inspected?.side === 1 ? inspected.petId : null}
                        onPetClick={(petId) => toggleInspected(1, petId)}
                        members={opponent.roster.map((p) => ({
                            petId: p.petId,
                            col: p.col,
                            row: p.row,
                            art: teamPetArt(p.petId, p.dna, p.name),
                            label: p.name,
                            sub: `Rank ${p.rank}`,
                        }))}
                    />
                </div>
                <TeamPetDetails
                    selection={selection}
                    onTacticChange={selection?.side === 0 ? (tactic) => panel.setTactic(selection.petId, tactic) : undefined}
                />
            </div>
            <p className={styles.muted}>
                Tap a pet below to add or remove it. Tap a pet on either zone to see its details. To
                move one of yours, select it and tap an empty tile, or drag it onto another pet to swap
                them. Melee pets can only reach the enemy front line.
            </p>

            {panel.squad.length > 0 && (
                <div className={styles.list}>
                    {panel.squad.map((m) => (
                        <div key={m.petId} className={styles.listItem}>
                            <span className={styles.miniArt} aria-hidden>
                                <PetArt pet={ownArt(m.petId)} />
                            </span>
                            <span className={styles.grow}>{petName(m.petId)}</span>
                            <select aria-label={`Tactic for ${petName(m.petId)}`} value={m.tactic} onChange={(e) => panel.setTactic(m.petId, e.target.value as Tactic)}>
                                {TACTIC_OPTIONS.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
            )}

            <h4>
                Choose your squad ({panel.squad.length}/{SQUAD_SIZE})
            </h4>
            <TeamPetGrid
                label="Your pets"
                pets={panel.pets}
                selected={squadIds}
                max={SQUAD_SIZE}
                blockResting
                onToggle={(petId) => (squadIds.includes(petId) ? panel.removePet(petId) : panel.addPet(petId))}
            />

            {panel.squad.length === SQUAD_SIZE && (
                <p className={styles.muted}>
                    Your squad acts in this order: {panel.turnOrder.map((slot) => petName(panel.squad[slot]?.petId ?? '')).join(', ')}.
                    The defenders join the order once they are drawn.
                </p>
            )}
            {!panel.squadReady && <p className={styles.error}>One of your pets is still resting.</p>}
            {panel.error && <p className={styles.error}>{panel.error.message}</p>}

            <div className={styles.row}>
                <NeonButton tone="magenta" disabled={!panel.canStart} onClick={() => void panel.start()}>
                    Start team battle
                </NeonButton>
                <NeonButton tone="azure" onClick={() => panel.chooseOpponent(null)}>
                    Pick another team
                </NeonButton>
            </div>
        </div>
    );
};

export default TeamChallenge;
