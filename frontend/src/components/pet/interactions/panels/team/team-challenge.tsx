import React, { useCallback, useState } from 'react';

import NeonButton from '@components/ui/neon-button';
import { useTeamBattlePanel } from '@hooks/team/useTeamBattlePanel';
import type { Tactic } from '@shared/core';

import { TACTIC_OPTIONS } from './tactics';
import { ZoneGrid } from './team-board';
import TeamPlayback from './team-playback';
import styles from './index.module.css';

const STATE_LABELS: Record<string, string> = {
    accepted: 'Challenge accepted. Freezing both teams…',
    committed: 'Waiting for the randomness round both sides were promised…',
    seeded: 'Drawing the defenders and fighting…',
    computed: 'Fight computed. Waiting for the independent verifier to agree…',
    verified: 'Verified. Signing the receipt…',
};

/**
 * The team challenge flow, a view over `useTeamBattlePanel`: pick a defender, build and place a
 * squad of three, sign, then watch the verified battle.
 */
const TeamChallenge: React.FC = () => {
    const panel = useTeamBattlePanel();
    const [selected, setSelected] = useState<string | null>(null);
    const petName = useCallback((petId: string) => panel.pets.find((p) => p.id === petId)?.name ?? `Pet ${petId}`, [panel.pets]);
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
                            <span className={styles.grow}>
                                {o.roster.map((p) => `${p.name} (Lv ${p.level})`).join(', ')}
                            </span>
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
    const inSquad = new Set(panel.squad.map((m) => m.petId));
    return (
        <div className={styles.panel}>
            <div className={styles.row}>
                <div>
                    <h4>Your squad</h4>
                    <ZoneGrid
                        label="Your zone"
                        side={0}
                        members={panel.squad.map((m) => ({ petId: m.petId, col: m.col, row: m.row, label: petName(m.petId) }))}
                        selectedPetId={selected}
                        onTileClick={(col, row) => {
                            const here = panel.squad.find((m) => m.col === col && m.row === row);
                            if (selected) {
                                panel.placePet(selected, col, row);
                                setSelected(null);
                            } else if (here) {
                                setSelected(here.petId);
                            }
                        }}
                        onDropPet={panel.placePet}
                    />
                </div>
                <div>
                    <h4>Their team</h4>
                    <ZoneGrid
                        label="Rival zone"
                        side={1}
                        members={opponent.roster.map((p) => ({ petId: p.petId, col: p.col, row: p.row, label: p.name, sub: `Rank ${p.rank}` }))}
                    />
                </div>
            </div>
            <p className={styles.muted}>
                Select a pet on your zone, then a tile, to move it; or drag it. Melee pets can only
                reach the enemy front line.
            </p>

            <div className={styles.list}>
                {panel.squad.map((m) => (
                    <div key={m.petId} className={styles.listItem}>
                        <span className={styles.grow}>{petName(m.petId)}</span>
                        <label>
                            Tactic{' '}
                            <select value={m.tactic} onChange={(e) => panel.setTactic(m.petId, e.target.value as Tactic)}>
                                {TACTIC_OPTIONS.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <NeonButton size="xs" tone="violet" onClick={() => panel.removePet(m.petId)}>
                            Remove
                        </NeonButton>
                    </div>
                ))}
            </div>

            {panel.squad.length < 3 && (
                <div className={styles.list}>
                    {panel.pets
                        .filter((p) => !inSquad.has(p.id))
                        .map((p) => (
                            <div key={p.id} className={styles.listItem}>
                                <span className={styles.grow}>
                                    {p.name} (Lv {p.level})
                                </span>
                                <NeonButton size="xs" tone="cyan" onClick={() => panel.addPet(p.id)}>
                                    Add
                                </NeonButton>
                            </div>
                        ))}
                </div>
            )}

            {panel.squad.length === 3 && (
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
