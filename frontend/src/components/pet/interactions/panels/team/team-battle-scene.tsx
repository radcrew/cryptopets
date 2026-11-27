import clsx from 'clsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import PetArt from '@components/pet/pet-art';
import PulseMoment from '@components/game/pulse-moment';
import ResultStamp from '@components/game/result-stamp';
import StrikePop from '@components/game/strike-pop';
import { strikeLabel } from '@components/game/strike-pop/label';
import NeonButton from '@components/ui/neon-button';
import { describeStrike, type TeamBattleResult } from '@shared/core';

import BattleResultArt from '../battle/battle-result-art';
import duel from '../battle/index.module.css';
import { teamPetArt } from './art';
import { BattleBoard, type BoardFighter } from './team-board';
import styles from './index.module.css';
import RoundKey from '@components/ui/round-key';

export type ScenePhase = 'submitting' | 'running' | 'result' | 'failed';

export interface TeamBattleSceneProps {
    phase: ScenePhase;
    /** What is happening while there is no result yet, or why the battle failed. */
    status: string | null;
    /** Both teams as they line up, drawn on the map until the verified result replaces them. */
    lineup: BoardFighter[];
    result: TeamBattleResult | null;
    /** Display name for a fighter, by side (0 attackers) and slot. */
    name: (side: 0 | 1, slot: number) => string;
    /** Whose team is being challenged, for the result line. */
    rivalLabel: string;
    /** Back to the arena for another challenge. */
    onDone: () => void;
    /** Closes the scene while the battle keeps running. */
    onHide?: () => void;
    /** Milliseconds per strike. */
    stepMs?: number;
    /** Waiting on the committed drand round, so the Pulse is shown beating. */
    awaitingPulse?: boolean;
}

const SIDE_NAMES = ['Your squad', 'Rival team'] as const;

/**
 * The team battle, full screen like the duel's: both teams on the 6×3 map with their HP, the
 * strikes played back one by one with a running battle log, then the verified result.
 *
 * Until the result arrives only your squad is on the map. The defenders' half stays unknown, as
 * it does on the challenge screen, and the verified result is what reveals them.
 *
 * Everything drawn after the fight comes from the verified receipt and its combat log
 * (`useTeamBattleResult`); this component computes nothing about the fight itself. It borrows
 * the duel scene's styles so the two battles share one look.
 */
const TeamBattleScene: React.FC<TeamBattleSceneProps> = ({
    phase,
    status,
    lineup,
    result,
    name,
    rivalLabel,
    onDone,
    onHide,
    stepMs = 650,
    awaitingPulse = false,
}) => {
    const frames = useMemo(() => result?.playback.frames ?? [], [result]);
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);
    const finished = result !== null && index >= frames.length;
    const dialog = useDialogFocus(
        phase === 'running' ? onHide : finished || phase === 'failed' ? onDone : undefined,
        finished,
    );

    useEffect(() => {
        if (!result || !playing || finished) return undefined;
        const timer = setTimeout(() => setIndex((i) => i + 1), stepMs);
        return () => clearTimeout(timer);
    }, [finished, index, playing, result, stepMs]);

    const shown = Math.min(index, frames.length);
    const frame = shown > 0 ? frames[shown - 1] : undefined;
    const fighters = useMemo<BoardFighter[]>(() => {
        if (!result) return lineup;
        return result.playback.fighters.flat().map((f) => ({
            side: f.side,
            slot: f.slot,
            x: f.x,
            row: f.row,
            art: teamPetArt(f.petId, f.dna, name(f.side, f.slot)),
            name: name(f.side, f.slot),
            startHp: f.startHp,
            hp: frame ? frame.hp[f.side][f.slot] ?? f.startHp : f.startHp,
        }));
    }, [frame, lineup, name, result]);
    const log = frames.slice(0, shown).map((f) => ({
        side: f.strike.side,
        round: f.strike.round,
        text: describeStrike(f.strike, name),
    }));
    const strike = frame?.strike;
    const enemy = strike ? (strike.side === 0 ? 1 : 0) : 0;
    // Keyed on the frame's own strike, so a re-render never replays the pop or its sound.
    const cue = useMemo(
        () =>
            strike
                ? {
                      id: shown,
                      damage: strike.damage.toString(),
                      crit: strike.crit,
                      magic: strike.isMagic,
                      label: strikeLabel(strike),
                  }
                : null,
        [strike, shown],
    );

    // The newest strike stays in view as the log grows.
    const logRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = logRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [shown]);

    const battleLog = (
        <div className={duel.sceneMechLog}>
            <div className={duel.mechLogTitle}>⚔ Battle Log</div>
            <div className={duel.mechLogBody} ref={logRef} aria-live="polite">
                {log.length === 0 ? (
                    <p className={duel.mechLogWaiting}>The first blow hasn&rsquo;t landed yet…</p>
                ) : (
                    log.map((line, i) => (
                        <React.Fragment key={i}>
                            {line.round !== log[i - 1]?.round && (
                                <p className={styles.logRound}>Round {line.round + 1}</p>
                            )}
                            <p
                                className={clsx(
                                    duel.mechLogEntry,
                                    line.side === 0 ? duel.isFighter : duel.isEnemy,
                                )}
                            >
                                {line.text}
                            </p>
                        </React.Fragment>
                    ))
                )}
            </div>
        </div>
    );

    if (finished && result) {
        const { summary, receipt, playback } = result;
        const won = summary.attackerWon;
        // The six progressions run attackers then defenders, by slot.
        const leveledUp = receipt.progression.slice(0, 3).some((p) => p?.leveledUp);
        const rounds = `${summary.rounds} round${summary.rounds === 1 ? '' : 's'}`;
        return (
            <div
                ref={dialog.ref}
                className={clsx(duel.scene, duel.isResult, styles.sceneDialog)}
                role="dialog"
                aria-modal="true"
                aria-label="Team battle"
                tabIndex={-1}
            >
                <div className={duel.sceneLayout}>
                    <div className={duel.sceneMain}>
                        <div className={duel.sceneResultContent}>
                            <div className={clsx(duel.sceneResult, !won && duel.isDefeat)}>
                                <div className={duel.sceneArt} aria-hidden>
                                    <BattleResultArt
                                        outcome={{ result: won ? 'victory' : 'defeat', leveledUp }}
                                    />
                                </div>
                                <ResultStamp
                                    won={won}
                                    as="h3"
                                    className={clsx(duel.sceneResultTitle, styles.sceneTitle)}
                                >
                                    {won ? 'VICTORY!' : 'DEFEATED'}
                                </ResultStamp>
                                <div className={duel.sceneResultSub}>
                                    {won
                                        ? leveledUp
                                            ? `Your squad won in ${rounds}, and a pet leveled up!`
                                            : `Your squad won in ${rounds}.`
                                        : `Your squad fell in ${rounds}. Rearrange it and try again!`}
                                </div>
                                <div className={duel.sceneResultVs}>vs {rivalLabel}</div>
                            </div>

                            <table className={clsx(styles.table, styles.sceneTable)}>
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
                                        const isMvp =
                                            summary.mvp?.side === f.side &&
                                            summary.mvp.slot === f.slot;
                                        const xp =
                                            receipt.progression[f.side === 0 ? f.slot : 3 + f.slot]
                                                ?.xpAwarded ?? 0;
                                        return (
                                            <tr
                                                key={`${f.side}-${f.slot}`}
                                                className={
                                                    f.side === 1 ? styles.sceneRowRival : undefined
                                                }
                                            >
                                                <td>
                                                    <span className={styles.miniArt} aria-hidden>
                                                        <PetArt
                                                            pet={teamPetArt(
                                                                f.petId,
                                                                f.dna,
                                                                name(f.side, f.slot),
                                                            )}
                                                        />
                                                    </span>{' '}
                                                    {name(f.side, f.slot)}
                                                    {isMvp && ' ⭐ MVP'}
                                                </td>
                                                <td className={styles.num}>
                                                    {summary.damage[f.side][f.slot] ?? 0}
                                                </td>
                                                <td className={styles.num}>
                                                    {summary.knockouts[f.side][f.slot] ?? 0}
                                                </td>
                                                <td className={styles.num}>+{xp}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            <div className={duel.sceneActions}>
                                <button
                                    type="button"
                                    className={duel.resultReplay}
                                    onClick={() => {
                                        setIndex(0);
                                        setPlaying(true);
                                    }}
                                >
                                    🔁 Watch Again
                                </button>
                                <button type="button" className={duel.resultDone} onClick={onDone}>
                                    ⚔ New Challenge
                                </button>
                            </div>
                        </div>
                        {battleLog}
                    </div>
                </div>
            </div>
        );
    }

    // Each side's HP as one gauge, the way the duel's HUD plates read.
    const sideHp = ([0, 1] as const).map((side) => {
        const own = fighters.filter((f) => f.side === side);
        const hp = own.reduce((sum, f) => sum + Math.max(0, f.hp), 0);
        const start = own.reduce((sum, f) => sum + f.startHp, 0);
        return { hp, start, pct: start > 0 ? Math.round((hp / start) * 100) : 100 };
    });

    return (
        <div
            ref={dialog.ref}
            className={clsx(duel.scene, styles.sceneDialog)}
            role="dialog"
            aria-modal="true"
            aria-label="Team battle"
            tabIndex={-1}
        >
            {onHide && phase === 'running' && (
                <RoundKey icon="back" className={duel.sceneBack} onClick={onHide} aria-label="Back" />
            )}
            <div className={duel.sceneLayout}>
                <div className={duel.sceneMain}>
                    <div className={duel.sceneArenaPanel}>
                        <div className={duel.sceneBanner}>⚔ Team Battle ⚔</div>

                        <div className={styles.sceneHud}>
                            {([0, 1] as const).map((side) => (
                                <div
                                    key={side}
                                    className={clsx(
                                        styles.scenePlate,
                                        side === 1 && styles.scenePlateRival,
                                    )}
                                >
                                    <span className={styles.scenePlateName}>
                                        {side === 0 ? SIDE_NAMES[0] : rivalLabel}
                                    </span>
                                    <span className={styles.scenePlateHp}>
                                        {result
                                            ? `${sideHp[side]!.hp} / ${sideHp[side]!.start} HP`
                                            : side === 0
                                              ? 'Full health'
                                              : 'Hidden'}
                                    </span>
                                    <span className={styles.scenePlateTrack}>
                                        <span
                                            className={styles.scenePlateFill}
                                            style={{ width: `${sideHp[side]!.pct}%` }}
                                        />
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className={styles.sceneBoard}>
                            <BattleBoard
                                fighters={fighters}
                                actor={strike ? { side: strike.side, slot: strike.actor } : null}
                                victim={strike ? { side: enemy, slot: strike.victim } : null}
                                concealedSide={result ? undefined : 1}
                                victimPop={cue && <StrikePop key={cue.id} cue={cue} />}
                            />
                        </div>

                        {result ? (
                            <div className={styles.sceneControls}>
                                <NeonButton
                                    size="sm"
                                    tone="cyan"
                                    onClick={() => setPlaying((p) => !p)}
                                >
                                    {playing ? 'Pause' : 'Play'}
                                </NeonButton>
                                <NeonButton
                                    size="sm"
                                    tone="violet"
                                    onClick={() => setIndex(frames.length)}
                                >
                                    Skip to result
                                </NeonButton>
                            </div>
                        ) : (
                            <div className={styles.sceneControls}>
                                {awaitingPulse && <PulseMoment />}
                                {status && (
                                    <p
                                        className={clsx(
                                            duel.sceneStatus,
                                            phase === 'failed' && styles.sceneFailed,
                                        )}
                                        role="status"
                                    >
                                        {status}
                                    </p>
                                )}
                                {phase === 'failed' && (
                                    <NeonButton size="sm" tone="azure" onClick={onDone}>
                                        Back to the arena
                                    </NeonButton>
                                )}
                            </div>
                        )}
                    </div>
                    {battleLog}
                </div>
            </div>
        </div>
    );
};

const FOCUSABLE = 'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What a modal dialog owes the keyboard: focus moves into the scene when it opens and again when
 * the result replaces the fight (the focused button may have gone), Tab and Shift+Tab stay inside
 * it, Escape does what closing means in that phase, and focus goes back where it was afterwards.
 * The key listener is attached here rather than as a prop, since the dialog element itself is
 * not an interactive control.
 */
function useDialogFocus(onEscape: (() => void) | undefined, finished: boolean) {
    const ref = useRef<HTMLDivElement>(null);
    const escapeRef = useRef(onEscape);
    escapeRef.current = onEscape;

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return () => previous?.focus();
    }, []);

    // The fight and the result render different roots, so both the focus and the listener move
    // with `finished`.
    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        root.focus();
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && escapeRef.current) {
                e.preventDefault();
                escapeRef.current();
                return;
            }
            if (e.key !== 'Tab') return;
            const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) {
                e.preventDefault();
                return;
            }
            const active = document.activeElement;
            if (e.shiftKey && (active === first || active === root)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        };
        root.addEventListener('keydown', onKeyDown);
        return () => root.removeEventListener('keydown', onKeyDown);
    }, [finished]);

    return { ref };
}

export default TeamBattleScene;
