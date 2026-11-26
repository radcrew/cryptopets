import React, { useEffect, useMemo, useState } from 'react';

import PetArt from '@components/pet/pet-art';
import NeonButton from '@components/ui/neon-button';
import { describeStrike, type TeamBattleResult } from '@shared/core';

import { teamPetArt } from './art';
import { BattleBoard } from './team-board';
import styles from './index.module.css';

export interface TeamPlaybackProps {
    result: TeamBattleResult;
    /** Display name for a fighter, by side (0 attackers) and slot. */
    name: (side: 0 | 1, slot: number) => string;
    onDone: () => void;
    /** Milliseconds per strike. */
    stepMs?: number;
}

/**
 * Plays a finished team battle back strike by strike on the 6×3 map, then shows the result.
 * Everything drawn comes from the verified receipt and its combat log
 * (`useTeamBattleResult`): this component computes nothing about the fight itself.
 */
const TeamPlayback: React.FC<TeamPlaybackProps> = ({ result, name, onDone, stepMs = 650 }) => {
    const { playback, summary, receipt } = result;
    const frames = playback.frames;
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);
    const finished = index >= frames.length;

    useEffect(() => {
        if (!playing || finished) return undefined;
        const timer = setTimeout(() => setIndex((i) => i + 1), stepMs);
        return () => clearTimeout(timer);
    }, [finished, index, playing, stepMs]);

    const shown = Math.min(index, frames.length);
    const frame = shown > 0 ? frames[shown - 1] : undefined;
    const fighters = useMemo(
        () =>
            playback.fighters.flat().map((f) => ({
                side: f.side,
                slot: f.slot,
                x: f.x,
                row: f.row,
                art: teamPetArt(f.petId, f.dna, name(f.side, f.slot)),
                name: name(f.side, f.slot),
                startHp: f.startHp,
                hp: frame ? (frame.hp[f.side][f.slot] ?? f.startHp) : f.startHp,
            })),
        [frame, name, playback.fighters],
    );
    const captions = frames.slice(Math.max(0, shown - 4), shown).map((f) => describeStrike(f.strike, name));
    const strike = frame?.strike;
    const enemy = strike ? (strike.side === 0 ? 1 : 0) : 0;

    return (
        <div className={styles.panel}>
            <BattleBoard
                fighters={fighters}
                actor={strike ? { side: strike.side, slot: strike.actor } : null}
                victim={strike ? { side: enemy, slot: strike.victim } : null}
            />
            <div className={styles.captions} aria-live="polite">
                {strike && <strong>Round {strike.round + 1}</strong>}
                {captions.map((line, i) => (
                    <span key={`${shown}-${i}`}>{line}</span>
                ))}
            </div>
            <div className={styles.row}>
                {!finished && (
                    <NeonButton size="sm" tone="cyan" onClick={() => setPlaying((p) => !p)}>
                        {playing ? 'Pause' : 'Play'}
                    </NeonButton>
                )}
                {!finished && (
                    <NeonButton size="sm" tone="violet" onClick={() => setIndex(frames.length)}>
                        Skip to result
                    </NeonButton>
                )}
                <NeonButton
                    size="sm"
                    tone="azure"
                    onClick={() => {
                        setIndex(0);
                        setPlaying(true);
                    }}
                >
                    Replay
                </NeonButton>
            </div>

            {finished && (
                <div className={styles.panel} aria-label="Battle result">
                    <h4 className={summary.attackerWon ? styles.victory : styles.defeat}>
                        {summary.attackerWon ? 'Victory' : 'Defeat'} in {summary.rounds} round{summary.rounds === 1 ? '' : 's'}
                    </h4>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Pet</th>
                                <th className={styles.num}>Damage</th>
                                <th className={styles.num}>Knockouts</th>
                                <th className={styles.num}>XP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {playback.fighters.flat().map((f) => {
                                const isMvp = summary.mvp?.side === f.side && summary.mvp.slot === f.slot;
                                // The six progressions run attackers then defenders, by slot.
                                const xp = receipt.progression[f.side === 0 ? f.slot : 3 + f.slot]?.xpAwarded ?? 0;
                                return (
                                    <tr key={`${f.side}-${f.slot}`}>
                                        <td>
                                            <span className={styles.miniArt} aria-hidden>
                                                <PetArt pet={teamPetArt(f.petId, f.dna, name(f.side, f.slot))} />
                                            </span>{' '}
                                            {name(f.side, f.slot)}
                                            {isMvp && ' ⭐ MVP'}
                                        </td>
                                        <td className={styles.num}>{summary.damage[f.side][f.slot] ?? 0}</td>
                                        <td className={styles.num}>{summary.knockouts[f.side][f.slot] ?? 0}</td>
                                        <td className={styles.num}>+{xp}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className={styles.row}>
                        <NeonButton tone="emerald" onClick={onDone}>
                            New challenge
                        </NeonButton>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TeamPlayback;
