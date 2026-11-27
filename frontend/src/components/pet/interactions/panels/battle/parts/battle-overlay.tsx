import React from 'react';
import clsx from 'clsx';
import {
    extract,
    getLifePercent,
    getPetSkill,
    getRarityColor,
    getRarityName,
    type Attrs,
    type BattleOutcome,
    type DialogueTurn,
    type OpponentPet,
    type Pet,
} from '@shared/core';
import BattleResultArt from '../battle-result-art';
import BattleDialogue from '../battle-dialogue';
import type { MechanicalLogLine } from '../types';
import styles from '../index.module.css';
import vsClashImage from '@assets/images/background/vs.png';
import PetArt from '@components/pet/pet-art';
import LedgerStone, { type LedgerRecord } from '@components/game/ledger-stone';
import PulseMoment from '@components/game/pulse-moment';
import ResultStamp from '@components/game/result-stamp';
import StrikePop, { type StrikeCue } from '@components/game/strike-pop';
import RoundKey from '@components/ui/round-key';

export type BattleOverlayProps = {
    open: boolean;
    showResult: boolean;
    battleOutcome: BattleOutcome;
    fighter?: Pet | null;
    opponent?: OpponentPet;
    // Result phase
    resultTurns: DialogueTurn[];
    dialogueLoading: boolean;
    resultAttackerName: string;
    resultDefenderName: string;
    onResultComplete: () => void;
    resultDialogueDone: boolean;
    onDone: () => void;
    // Pre-result phase
    preResultTitle: string;
    preResultStatus: string | null;
    tauntsLoading: boolean;
    tauntsTurns: DialogueTurn[];
    /** Fires once the pre-fight taunts finish typing (gates the wallet prompt). */
    onTauntsComplete: () => void;
    /** Minimizes the overlay without touching the in-flight battle (wallet tx,
     *  taunts, live-replay animation all keep running); the overlay auto-reopens
     *  once the result is ready. Only shown before a result is available — the
     *  result screen has its own "Leave" action instead. */
    onBack: () => void;
    fighterName: string;
    opponentName: string;
    // Live-replay animation — null falls
    // back to the static getLifePercent bars below (Solana, or an EVM deployment
    // with no GameConfig wired up). Presentation only; never the source of the
    // result banner, which always comes from battleOutcome (on-chain).
    liveHp1Percent?: number | null;
    liveHp2Percent?: number | null;
    liveFlourish?: string | null;
    /** Round-by-round mechanical log (the strike log, formatted) for the bottom
     *  log panel. Null — not just empty — when there's
     *  no live-replay feature this deployment (Solana, or an EVM deployment with no
     *  GameConfig wired up), same fallback rule as liveHp1Percent/liveHp2Percent. */
    liveLog?: MechanicalLogLine[] | null;
    /** Whether there's a live-replay log to watch again (same fallback rule as
     *  liveHp1Percent/liveHp2Percent — false on Solana or an EVM deployment with no
     *  GameConfig wired up). Gates the "Watch Again" action on the result screen. */
    canReplay: boolean;
    /** Restarts the fight animation from the first strike, then returns to the result
     *  screen automatically once it finishes again. */
    onWatchReplay: () => void;
    /** Waiting on the committed drand round: the Pulse takes the centre of the arena. */
    awaitingPulse?: boolean;
    /** The strike playing now, popped over whichever pet took it. Same fallback rule as liveLog. */
    liveStrike?: (StrikeCue & { victim: 'fighter' | 'enemy' }) | null;
    /** The verified receipt's checks, shown as the Ledger Stone on the result screen. */
    ledger?: LedgerRecord | null;
};

/** Pet banter panel — the fighters' conversation, shown in the right-hand rail. */
const DialogueRail: React.FC<{
    turns: DialogueTurn[];
    isLoading: boolean;
    attackerName: string;
    defenderName: string;
    onComplete?: () => void;
    waiting: string;
    title: string;
}> = ({ turns, isLoading, attackerName, defenderName, onComplete, waiting, title }) => (
    <aside className={styles.sceneDialogueRail} aria-label="Pet banter">
        <div className={styles.log}>
            <div className={styles.logTitle}>💬 {title}</div>
            <div className={styles.logBody}>
                {isLoading || turns.length > 0 ? (
                    <BattleDialogue
                        turns={turns}
                        isLoading={isLoading}
                        attackerName={attackerName}
                        defenderName={defenderName}
                        onComplete={onComplete}
                    />
                ) : (
                    <p className={styles.logWaiting}>{waiting}</p>
                )}
            </div>
        </div>
    </aside>
);

/** Mechanical (round-by-round) battle log — hits, crits, and damage, shown as a
 *  persistent strip along the bottom of the scene by default (even before there's
 *  anything to show, e.g. no live-replay feature this deployment, or entropy
 *  hasn't revealed yet) — a waiting placeholder fills it until entries land. */
const MechanicalLog: React.FC<{ lines: MechanicalLogLine[] | null | undefined }> = ({ lines }) => {
    const entries = lines ?? [];
    return (
        <div className={styles.sceneMechLog}>
            <div className={styles.mechLogTitle}>⚔ Battle Log</div>
            <div className={styles.mechLogBody}>
                {entries.length === 0 ? (
                    <p className={styles.mechLogWaiting}>The first blow hasn&rsquo;t landed yet…</p>
                ) : (
                    entries.map((line, i) => (
                        <p
                            key={i}
                            className={clsx(styles.mechLogEntry, line.isFighter ? styles.isFighter : styles.isEnemy)}
                        >
                            {line.text}
                        </p>
                    ))
                )}
            </div>
        </div>
    );
};

/** Flavor icon per passive skill archetype (getPetSkill's name), shown on its pill. */
const SKILL_EMOJI: Record<string, string> = {
    Tank: '🐘',
    Shell: '🐢',
    Swift: '⚡',
    Cunning: '🎯',
    Fury: '🔥',
    Sage: '🔮',
    Rebirth: '🌀',
    Bloodlust: '🩸',
};

/**
 * One fighter's HUD plate: name/level, a glowing HP gauge, rarity/skill-archetype
 * ("personality" — same terminology as the pet-gallery card)/record pills, and the
 * DNA-derived combat stats (plan §3.1 — pure function of dna/rarity/level, same
 * values the combat engine simulates from; no chain read needed). `pet` accepts an
 * OpponentPet too since it structurally extends Pet.
 */
const FighterPlate: React.FC<{
    side: 'isFighter' | 'isEnemy';
    name: string;
    hp: number;
    pet?: Pet | null;
    attrs: Attrs | null;
}> = ({ side, name, hp, pet, attrs }) => {
    const skill = pet ? getPetSkill(pet.speciesId) : null;
    return (
        <div className={clsx(styles.plate, styles[side])}>
            <div className={styles.plateHead}>
                {pet ? (
                    <span
                        className={styles.plateGem}
                        style={{ background: getRarityColor(pet.rarity), color: getRarityColor(pet.rarity) }}
                        title={getRarityName(pet.rarity)}
                        aria-hidden
                    />
                ) : null}
                <span className={styles.plateName}>{name}</span>
                {pet ? <span className={styles.plateLevel}>Lv.{pet.level}</span> : null}
            </div>

            <div className={styles.plateHpRow}>
                <span className={styles.plateHpVal}>{hp} HP</span>
            </div>
            <div className={styles.plateGaugeTrack}>
                <div className={styles.plateGaugeFill} style={{ width: `${hp}%` }} />
            </div>

            {pet ? (
                <div className={styles.plateMeta}>
                    <span className={styles.pill} style={{ color: getRarityColor(pet.rarity) }}>
                        {getRarityName(pet.rarity)}
                    </span>
                    {skill ? (
                        <span className={styles.pill} title={skill.description}>
                            {SKILL_EMOJI[skill.name] ?? '✨'} {skill.name}
                        </span>
                    ) : null}
                    <span className={clsx(styles.pill, styles.pillGhost)}>
                        {pet.winCount}W-{pet.lossCount}L
                    </span>
                </div>
            ) : null}

            {attrs ? (
                <div className={styles.plateStats}>
                    <span className={styles.statChip} title="Attack">⚔️ {attrs.atk.toString()}</span>
                    <span className={styles.statChip} title="Defense">🛡️ {attrs.def.toString()}</span>
                    <span className={styles.statChip} title="Intelligence">🧠 {attrs.int.toString()}</span>
                    <span className={styles.statChip} title="Magic Defense">🔮 {attrs.mdef.toString()}</span>
                </div>
            ) : null}
        </div>
    );
};

/**
 * Full-scene battle overlay laid out like the redesign mock: an in-scene arena
 * (HP bars + facing-off avatars) with the fighters' banter in a right-hand rail
 * and the mechanical round-by-round log along the bottom. Stays open continuously
 * across the phases: taunts → battling (pre-result) → result reactions + actions.
 */
const BattleOverlay: React.FC<BattleOverlayProps> = ({
    open,
    showResult,
    battleOutcome,
    fighter,
    opponent,
    resultTurns,
    dialogueLoading,
    resultAttackerName,
    resultDefenderName,
    onResultComplete,
    resultDialogueDone,
    onDone,
    onBack,
    preResultTitle,
    preResultStatus,
    tauntsLoading,
    tauntsTurns,
    onTauntsComplete,
    fighterName,
    opponentName,
    liveHp1Percent,
    liveHp2Percent,
    liveFlourish,
    liveLog,
    canReplay,
    onWatchReplay,
    awaitingPulse = false,
    liveStrike = null,
    ledger = null,
}) => {
    if (!open) return null;

    const isVictory = battleOutcome?.result === 'victory';
    const isDefeat = battleOutcome?.result === 'defeat';

    const fighterHp = liveHp1Percent ?? (fighter ? getLifePercent(fighter) : 100);
    const enemyHp = liveHp2Percent ?? (opponent ? getLifePercent(opponent) : 100);
    const fighterAvatar = fighter ? <PetArt pet={fighter} /> : '❓';
    const enemyAvatar = opponent ? <PetArt pet={opponent} /> : '❓';
    const fighterAttrs = fighter ? extract(fighter.dna, fighter.rarity, fighter.level) : null;
    const enemyAttrs = opponent ? extract(opponent.dna, opponent.rarity, opponent.level) : null;
    // The decorative attack flashes are ambient filler for "a fight is happening" — they
    // shouldn't loop during the taunts/awaiting-randomness lead-up, only once the battle
    // log has an actual strike to react to.
    const battleStarted = Boolean(liveLog && liveLog.length > 0);

    // ── Fighting scene (taunts / battle underway) ──────────────────────────────
    if (!showResult) {
        return (
            <div className={styles.scene} role="status" aria-live="polite">
                <RoundKey icon="back" className={styles.sceneBack} onClick={onBack} aria-label="Back" />
                <div className={styles.sceneLayout}>
                    <div className={styles.sceneMain}>
                        <div className={styles.sceneArenaPanel}>
                            <div className={styles.sceneBanner}>⚔ {preResultTitle} ⚔</div>

                            <div className={styles.hud}>
                                <FighterPlate side="isFighter" name={fighterName} hp={fighterHp} pet={fighter} attrs={fighterAttrs} />
                                <div className={styles.hudDivider} aria-hidden>
                                    <span className={styles.hudVsBadge}>VS</span>
                                </div>
                                <FighterPlate side="isEnemy" name={opponentName} hp={enemyHp} pet={opponent} attrs={enemyAttrs} />
                            </div>

                            <div className={styles.sceneArena}>
                                <div className={styles.sceneFighter}>
                                    <span
                                        className={clsx(styles.sceneHit, styles.sceneHitIn, battleStarted && styles.isActive)}
                                        aria-hidden
                                    >
                                        ⚡
                                    </span>
                                    <span className={clsx(styles.sceneAvatar, styles.isFighter)} aria-hidden>
                                        {fighterAvatar}
                                    </span>
                                    {liveStrike?.victim === 'fighter' && <StrikePop key={liveStrike.id} cue={liveStrike} />}
                                    <span className={clsx(styles.sceneLabel, styles.isFighter)}>{fighterName}</span>
                                </div>
                                {awaitingPulse ? (
                                    <PulseMoment />
                                ) : (
                                    <img className={styles.sceneClash} src={vsClashImage} alt="" aria-hidden />
                                )}
                                <div className={styles.sceneFighter}>
                                    <span
                                        className={clsx(styles.sceneHit, styles.sceneHitOut, battleStarted && styles.isActive)}
                                        aria-hidden
                                    >
                                        💥
                                    </span>
                                    <span className={clsx(styles.sceneAvatar, styles.isEnemy)} aria-hidden>
                                        {enemyAvatar}
                                    </span>
                                    {liveStrike?.victim === 'enemy' && <StrikePop key={liveStrike.id} cue={liveStrike} />}
                                    <span className={clsx(styles.sceneLabel, styles.isEnemy)}>{opponentName}</span>
                                </div>
                            </div>

                            {liveFlourish ? <p className={styles.sceneFlourish}>{liveFlourish}</p> : null}
                            {preResultStatus ? (
                                <p className={styles.sceneStatus}>{preResultStatus}</p>
                            ) : null}
                        </div>

                        <MechanicalLog lines={liveLog} />
                    </div>

                    <DialogueRail
                        turns={tauntsTurns}
                        isLoading={tauntsLoading}
                        attackerName={fighterName}
                        defenderName={opponentName}
                        onComplete={onTauntsComplete}
                        waiting="Waiting for the first taunt…"
                        title="Banter"
                    />
                </div>
            </div>
        );
    }

    // ── Result scene ───────────────────────────────────────────────────────────
    const bannerClass = clsx(
        styles.sceneResult,
        battleOutcome === null && styles.isPending,
        isDefeat && styles.isDefeat,
    );

    return (
        <div className={clsx(styles.scene, styles.isResult)} role="status" aria-live="polite">
            <div className={styles.sceneLayout}>
                <div className={styles.sceneMain}>
                    <div className={styles.sceneResultContent}>
                        <div className={bannerClass}>
                            <div className={styles.sceneArt} aria-hidden>
                                <BattleResultArt outcome={battleOutcome} />
                            </div>
                            {battleOutcome === null ? (
                                <div className={styles.sceneResultTitle}>Resolving…</div>
                            ) : (
                                <ResultStamp won={isVictory} className={styles.sceneResultTitle}>
                                    {isVictory ? 'VICTORY!' : 'DEFEATED'}
                                </ResultStamp>
                            )}
                            <div className={styles.sceneResultSub}>
                                {battleOutcome === null
                                    ? 'Checking battle outcome…'
                                    : isVictory
                                    ? battleOutcome.leveledUp
                                        ? 'Your pet won and leveled up!'
                                        : 'Your pet won the battle!'
                                    : 'Your pet was defeated. Train harder and try again!'}
                            </div>
                            {opponent && battleOutcome !== null ? (
                                <div className={styles.sceneResultVs}>
                                    {isVictory
                                        ? `vs ${opponent.name} (Lv.${opponent.level})`
                                        : `Lost to ${opponent.name} (Lv.${opponent.level})`}
                                </div>
                            ) : null}
                        </div>

                        {battleOutcome !== null && (
                            <div className={styles.sceneActions}>
                                {canReplay ? (
                                    <button type="button" className={styles.resultReplay} onClick={onWatchReplay}>
                                        🔁 Watch Again
                                    </button>
                                ) : null}
                                {ledger ? (
                                    <LedgerStone
                                        record={ledger}
                                        caption={`${fighterName} vs ${opponentName} · ${isVictory ? 'won' : 'lost'} in ${ledger.rounds} ${ledger.rounds === 1 ? 'round' : 'rounds'}`}
                                        triggerClassName={styles.resultStone}
                                    />
                                ) : null}
                                <button
                                    type="button"
                                    className={styles.resultDone}
                                    onClick={onDone}
                                    disabled={!resultDialogueDone}
                                >
                                    🏠 Leave
                                </button>
                            </div>
                        )}
                    </div>

                    <MechanicalLog lines={liveLog} />
                </div>

                {battleOutcome !== null ? (
                    <DialogueRail
                        turns={resultTurns}
                        isLoading={dialogueLoading}
                        attackerName={resultAttackerName}
                        defenderName={resultDefenderName}
                        onComplete={onResultComplete}
                        waiting="The dust settles…"
                        title="Battle Dialogue"
                    />
                ) : null}
            </div>
        </div>
    );
};

export default BattleOverlay;
