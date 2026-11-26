import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
    describeMechanicalLogEntry,
    getReadyPetsUnified,
    isBattleRejection,
    isConsentFailure,
    opponentKey,
    pickRandomOpponent,
    describeBattleStage,
    sortOpponentsByMatch,
    toDialoguePet,
    useChainCapabilities,
    useBattleOutcome,
    useBattlePets,
    useBattleTaunts,
    useCreateBattleRoom,
    useLiveBattleAnimation,
    useOpponents,
    usePetList,
    useWinEstimate,
    type BattlePersonas,
    type TxLifecycle,
    type BattleResolvedResult,
    type SimOutcome,
} from '@shared/core';
import { BATTLE_ROOM_WS_URL } from '../../config';
import { BATTLE_PATH, DASHBOARD_HOME } from '@constants/interactionRoutes';
import { formatTxHashHint } from '@hooks/usePetError';
import { usePetErrorToast } from '@hooks/usePetErrorToast';
import { useResultDialogue } from './useResultDialogue';
import {
    BATTLE_FAIL_MESSAGE,
    MISMATCH_NOTICE_MESSAGE,
    VALIDATION_MESSAGE,
} from '@components/pet/interactions/panels/battle/battle-utils';
import type { BattleOverlayProps } from '@components/pet/interactions/panels/battle/parts/battle-overlay';
import type { BattleSetupProps } from '@components/pet/interactions/panels/battle/parts/battle-setup';
import type { MechanicalLogLine } from '@components/pet/interactions/panels/battle/types';

interface UseBattlePanelArgs {
    isStandaloneView: boolean;
}

/** How long the mismatch interstitial stays up before revealing the (corrected)
 *  result card — see MISMATCH_NOTICE_MESSAGE / the reconciliation rule below. */
const MISMATCH_NOTICE_DURATION_MS = 2_000;

export interface UseBattlePanel {
    overlay: BattleOverlayProps;
    setup: BattleSetupProps;
    hashHint: string | null;
    /** Battle tx lifecycle, rendered by the phase-driven <TransactionStatus/>. */
    receipt: TxLifecycle;
}

/**
 * Headless controller for the battle panel. Owns all state, refs, queries,
 * handlers, and effects, and returns a view-model wired to the presentational
 * components. The panel component is then a pure view over this hook.
 *
 * Selection and validation are deliberately kept together here rather than
 * split into more hooks: they're tightly coupled (both random-match and
 * battle-start touch validation), so a single controller is the honest seam.
 * The two genuinely isolated concerns — outcome detection and dialogue — live
 * in their own hooks (`useBattleOutcome`, `useResultDialogue`) and are
 * composed below.
 *
 * No rematch action: publishing a receipt puts both participants on a cooldown
 * (`BATTLE_COOLDOWN_SECONDS`, 900s by default) regardless of outcome, so the exact
 * pairing that just fought can never legally re-battle immediately after a result —
 * a same-opponent "Rematch" button would always be rejected. Players re-battle by
 * picking a fresh opponent from the setup screen instead.
 */
export const useBattlePanel = ({ isStandaloneView }: UseBattlePanelArgs): UseBattlePanel => {
    const navigate = useNavigate();
    const location = useLocation();
    // The room this battle is being watched through (§J). The URL is the source of
    // truth rather than a second piece of state: it is what handleBattle sets when
    // the room is minted, what a spectator opens, and what survives a reload — all
    // three have to agree, and duplicating it in state is how they stop agreeing.
    const { roomId = null } = useParams<{ roomId?: string }>();
    const capabilities = useChainCapabilities();
    const { pets, isLoading: petsLoading, refetch } = usePetList();
    // Pre-select the pet the player clicked "Battle" on from its gallery card
    // (navigate(BATTLE_PATH, { state: { petId } })) — falls back to unselected
    // for the generic nav entry, which carries no state. Only read once, on
    // mount; readyPets/selectedFighter below pick it up reactively once pets load.
    const [selectedPet1, setSelectedPet1] = useState(
        () => (location.state as { petId?: string } | null)?.petId ?? '',
    );
    const [selectedOpponent, setSelectedOpponent] = useState('');
    const [showResult, setShowResult] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    // The battle overlay stays open continuously: taunts → battling → result.
    const [overlayOpen, setOverlayOpen] = useState(false);
    // The battle's tx hash, retained in our own state. EVM clears battle.hash
    // (resetWrite) on receipt completion, so we capture it during confirming to
    // keep a stable battleId for the result dialogue after the battle settles.
    const [settledBattleId, setSettledBattleId] = useState<string | null>(null);
    // The authoritative BattleResolved (or Solana confirm) has arrived — result
    // display still waits on the live animation finishing (see the gating effect
    // below), unless a mismatch was found, in which case it waits on the notice.
    const [hasResolvedEvent, setHasResolvedEvent] = useState(false);
    // Client-side live-replay disagreed with the on-chain result (should be
    // ~never). Shows a brief honest notice instead of silently correcting or
    // showing the wrong winner.
    const [mismatchNotice, setMismatchNotice] = useState(false);

    // Personas captured at battle start. The backend pre-generates the result
    // dialogue when the taunts are requested (keyed by matchup), so nothing
    // hash-triggered is needed here — these are reused for the settle read.
    const battlePersonasRef = useRef<BattlePersonas | null>(null);
    // Set when Start Battle is pressed: the wallet prompt is held until the
    // pre-fight taunts finish playing (so it doesn't pop while they're typing).
    const pendingBattleStartRef = useRef(false);
    // Latest live-replay outcome, read by handleSuccess (defined before `battle`
    // exists) for the mismatch check. Assigned during render each time `battle`
    // updates, keeping the callback identity stable across renders.
    const liveReplayRef = useRef<SimOutcome | null>(null);

    const activeChainKind = capabilities.activeKind;
    const {
        opponents,
        isLoading: opponentsLoading,
        emptyReason: opponentsEmptyReason,
        refetch: refetchOpponents,
    } = useOpponents({ chain: activeChainKind });

    // Victory/defeat and level-up, both read straight off the verified receipt.
    const outcome = useBattleOutcome();

    const handleSuccess = useCallback(
        (result: BattleResolvedResult) => {
            setValidationError(null);
            // The verified receipt is authoritative — petId1 is the player's pet, so
            // firstWins is the player's verdict on either chain.
            outcome.applyResolvedOutcome(result.firstWins, result.attackerLeveledUp);
            const local = liveReplayRef.current?.result;
            if (local && local.firstWins !== result.firstWins) {
                console.error('[battle] live-replay mismatch — the signed receipt is authoritative', {
                    receipt: result,
                    local,
                });
                setMismatchNotice(true);
            }
            // Result display gates on the live animation finishing too (or the
            // mismatch notice, if one fired) — see the effect below.
            setHasResolvedEvent(true);
            void refetch();
            void refetchOpponents();
        },
        [outcome, refetch, refetchOpponents],
    );

    // The room is passed here, not just put in the URL: `accept` records it on the
    // ledger row, which is what makes the backend notify that room on every state
    // change. Without it the socket has nothing to join and this client falls back
    // to polling, while spectators holding the link are never told anything at all.
    const battle = useBattlePets({
        onSuccess: handleSuccess,
        roomId,
        roomSocketUrl: BATTLE_ROOM_WS_URL,
    });
    liveReplayRef.current = battle.liveReplay;

    // Deliberately not gated on overlayOpen: the animation must keep progressing
    // in the background while the overlay is minimized (handleBack below), so
    // showResult can still become true and auto-reopen the overlay once the
    // battle actually resolves, instead of stalling until the player returns.
    const animation = useLiveBattleAnimation(
        battle.liveReplay?.log ?? null,
        battle.liveReplay?.startHp1 ?? null,
        battle.liveReplay?.startHp2 ?? null,
        !showResult,
    );

    // Reveal the result card once the authoritative event has arrived AND either
    // the live animation has finished or a mismatch cut it short (interstitial
    // instead). Never earlier — the verdict is never shown from the local sim.
    //
    // Revealing also raises the overlay, in the same commit. If the player minimized
    // it (handleBack) while the fight was in flight, the result still has to come
    // back to them: a minimized battle resolving silently in the background is the
    // thing this pairing exists to prevent. It used to be a second effect watching
    // `showResult`, which made the reveal a two-pass sequence whose order nothing in
    // the code stated, and left one render where the result was showing behind a
    // closed overlay. Both now happen together or not at all.
    useEffect(() => {
        if (!hasResolvedEvent) return;
        const reveal = () => {
            setShowResult(true);
            setOverlayOpen(true);
        };
        if (mismatchNotice) {
            const timer = setTimeout(() => {
                setMismatchNotice(false);
                reveal();
            }, MISMATCH_NOTICE_DURATION_MS);
            return () => clearTimeout(timer);
        }
        if (animation.done) reveal();
    }, [hasResolvedEvent, mismatchNotice, animation.done]);
    // AI pre-fight taunts — generated on Start Battle, in parallel with the wallet.
    // Requesting taunts also kicks off result pregen on the backend.
    const taunts = useBattleTaunts();
    const { reset: resetTaunts } = taunts;
    // Shareable room URL — minted alongside the taunts on Start Battle (see
    // handleBattle below), before the wallet has even signed, since no
    // on-chain identifier (tx hash / requestId) exists yet at that point.
    const { createRoom, isLoading: roomLoading } = useCreateBattleRoom();

    const readyPets = useMemo(() => getReadyPetsUnified(pets), [pets]);
    const selectedFighter = useMemo(
        () => readyPets.find(({ id }) => id === selectedPet1)?.pet ?? null,
        [readyPets, selectedPet1],
    );
    const opponent = useMemo(
        () => opponents.find((o) => opponentKey(o.owner, o.id) === selectedOpponent),
        [opponents, selectedOpponent],
    );
    const fighterLevel = selectedFighter?.level ?? null;

    const sortedOpponents = useMemo(
        () => sortOpponentsByMatch(opponents, fighterLevel),
        [opponents, fighterLevel],
    );

    const winEstimate = useWinEstimate(activeChainKind, selectedPet1 || null, opponent?.id ?? null);

    // Settled-battle dialogue read + result-action gating.
    const dialogue = useResultDialogue({
        activeChainKind,
        settledBattleId,
        selectedFighter,
        opponent,
        personasRef: battlePersonasRef,
        battleOutcome: outcome.battleOutcome,
        showResult,
    });

    // Receipt errors are folded into `battle.error` by the chain adapter.
    //
    // A server refusal goes in through the validation slot rather than the mutation one:
    // `usePetError` returns a validation message verbatim, while a mutation error is run
    // through the chain adapter's parser, which rewrites anything it does not recognise
    // into a generic "Transaction failed" and loses the reason the server gave.
    const rejectionMessage = isBattleRejection(battle.error) ? battle.error.message : null;
    usePetErrorToast(battle.error, null, validationError ?? rejectionMessage, BATTLE_FAIL_MESSAGE);

    const canRandomMatch = Boolean(selectedFighter) && opponents.length > 0 && !opponentsLoading;
    // Chain-blind: a battle is seeded from a committed drand round on either chain, so
    // there is no per-chain VRF provider to name here any more.
    const subtitle = 'Pick your fighter and an opponent';
    const pendingLabel = 'Starting Battle...';
    // The battle id, shown so a player can look their receipt up later. Falls back to the
    // retained id: `battle.hash` clears once the battle settles, the hint should not.
    const hashHint = formatTxHashHint(battle.hash ?? settledBattleId ?? undefined);

    const startBattle = useCallback(() => {
        if (!selectedPet1 || !opponent) {
            setValidationError(VALIDATION_MESSAGE);
            return false;
        }

        setValidationError(null);
        void battle.mutate({
            petId1: selectedPet1,
            petId2: opponent.id,
            defenderOwner: opponent.owner,
        });
        return true;
    }, [battle, opponent, selectedPet1]);

    // Start Battle: generate AI pre-fight taunts, then hold the wallet prompt until
    // they finish playing (handleTauntsComplete / the empty-taunts fallback effect
    // fire startBattle). The overlay shows a loader until the taunts arrive, then
    // types them out. The backend pregen still kicks off at taunt-request time, so
    // the deferred wallet doesn't cost the result read any latency.
    const handleBattle = () => {
        battle.clearErrors();
        taunts.reset();
        pendingBattleStartRef.current = false;
        setShowResult(false);
        setHasResolvedEvent(false);
        setMismatchNotice(false);
        outcome.resetOutcome();
        dialogue.resetResultDialogue();
        setSettledBattleId(null);

        if (!selectedPet1 || !opponent || !selectedFighter || !activeChainKind) {
            setValidationError(VALIDATION_MESSAGE);
            return;
        }
        setValidationError(null);

        // Mint the shareable room URL first — the Start Battle button shows a
        // loading state (roomLoading, from useCreateBattleRoom) until this
        // resolves, then the overlay opens and taunts/wallet proceed. Best-effort:
        // a failure still lets the battle proceed, just without a room URL for
        // this attempt (see useCreateBattleRoom's header comment).
        void createRoom({
            chain: activeChainKind,
            attackerPetId: selectedFighter.id,
            defenderPetId: opponent.id,
        }).then((mintedRoomId) => {
            // Navigate either way. On failure that clears a previous battle's room from
            // the URL, which would otherwise be handed to this battle's accept call and
            // push its updates to a room full of the wrong spectators.
            navigate(mintedRoomId ? `${BATTLE_PATH}/${mintedRoomId}` : BATTLE_PATH, { replace: true });

            setOverlayOpen(true);
            const personas = {
                attacker: toDialoguePet(selectedFighter),
                defender: toDialoguePet(opponent),
            };
            battlePersonasRef.current = personas;
            pendingBattleStartRef.current = true;
            taunts.generate({ chain: activeChainKind, ...personas });
        });
    };

    // The taunts finished typing — now prompt the wallet for the held battle.
    const handleTauntsComplete = useCallback(() => {
        if (!pendingBattleStartRef.current) return;
        pendingBattleStartRef.current = false;
        startBattle();
    }, [startBattle]);

    // Fallback: if the taunts errored / produced nothing, don't strand the battle —
    // start it once generation settles empty (onComplete never fires with no turns).
    useEffect(() => {
        if (!pendingBattleStartRef.current) return;
        if (!taunts.isLoading && taunts.turns.length === 0) {
            pendingBattleStartRef.current = false;
            startBattle();
        }
    }, [taunts.isLoading, taunts.turns.length, startBattle]);

    // Minimizes the overlay ("back") without touching any in-flight battle
    // state — the wallet tx, taunts, and live-replay animation all keep
    // running; the auto-reopen effect above brings the overlay back once
    // the result is ready, so a minimized battle can't resolve unseen.
    const handleBack = () => {
        setOverlayOpen(false);
    };

    const handleCancel = () => {
        setShowResult(false);
        setHasResolvedEvent(false);
        setMismatchNotice(false);
        setOverlayOpen(false);
        pendingBattleStartRef.current = false;
        taunts.reset();
        setValidationError(null);
        navigate(DASHBOARD_HOME);
    };

    const handleDone = () => {
        setShowResult(false);
        setHasResolvedEvent(false);
        setMismatchNotice(false);
        setOverlayOpen(false);
        taunts.reset();
        setValidationError(null);
        outcome.resetOutcome();
        setSelectedPet1('');
        setSelectedOpponent('');
        navigate(DASHBOARD_HOME);
    };

    const handleRefreshOpponents = () => {
        void refetchOpponents();
    };

    // Re-plays the just-finished fight from the first strike. Reuses the same
    // showResult/animation.done gate that reveals the result card in the first place:
    // flipping showResult back to false resumes the animation (active = !showResult),
    // and the effect above flips it back to true on its own once animation.done is true
    // again — no separate "replaying" state needed.
    const handleWatchReplay = useCallback(() => {
        animation.replay();
        setShowResult(false);
    }, [animation]);

    const handleSelectOpponent = useCallback((key: string) => {
        setSelectedOpponent(key);
    }, []);

    const handleRandomMatch = () => {
        if (!selectedFighter) {
            setValidationError('Choose your fighter before using random match');
            return;
        }

        const pick = pickRandomOpponent(opponents, selectedFighter.level);
        if (!pick) return;

        setValidationError(null);
        handleSelectOpponent(opponentKey(pick.owner, pick.id));
    };

    // Everything a failed battle triggers, in one effect and one commit. This was two
    // effects reading the same `battle.error`, so which of them ran first was decided
    // by where they happened to sit in the file. They are ordered here because the
    // order matters: tear down the in-flight UI, then act on what the failure says
    // about the opponent.
    //
    // `taunts.reset` rather than `taunts`: depending on the object re-ran the whole
    // body on any taunt-state change while an error was still set.
    useEffect(() => {
        if (!battle.error) return;

        // Stranding the player on the taunt/underway screen is the failure mode here
        // (e.g. wallet rejected). The error toast still shows. Skipped once the result
        // is up: a late failure must not yank away a card the player is reading.
        if (!showResult) {
            setOverlayOpen(false);
            pendingBattleStartRef.current = false;
            resetTaunts();
        }

        // A consent failure means this opponent's owner has no standing authorization
        // covering the fight (§D) — they never granted one, revoked it, or scoped it to
        // other pets. Matchmaking already excludes all three server-side, so this is the
        // narrow race where the grant died between the list being built and the battle
        // being accepted. Re-reading the list drops the opponent, and clearing the
        // selection stops the player re-picking the one choice that cannot succeed.
        //
        // Deliberately not every rejection: a level-band or daily-cap refusal is about
        // this attacker or today, not the opponent's willingness, and dropping them from
        // the list over it would be wrong.
        if (isConsentFailure(battle.error)) {
            setSelectedOpponent('');
            void refetchOpponents();
        }
    }, [battle.error, showResult, resetTaunts, refetchOpponents]);

    // Once the tx hash exists, retain it as the stable battleId for the result
    // read. EVM clears battle.hash on receipt completion, so capture it here.
    // Result dialogue was already pre-generated at taunt time (matchup-keyed), so
    // there's nothing to trigger off the hash beyond keeping the id.
    useEffect(() => {
        const hash = battle.hash;
        if (!hash || !activeChainKind) return;
        setSettledBattleId(hash);
    }, [battle.hash, activeChainKind]);


    // Pre-result phase (overlay stays open through taunts → battling).
    const isBattling = battle.isPending || battle.isConfirming;
    const preResultTitle = isBattling ? 'The battle is underway…' : 'Face-off!';
    // EVM v2 battle is async: request → VRF → settle. Label each phase so the
    // long VRF wait doesn't keep showing "Awaiting your wallet". The live-replay
    // states take priority once entropy has revealed (see the gating effect
    // above): the result card itself never appears until hasResolvedEvent AND
    // (animation.done OR the mismatch notice has run its course).
    const preResultStatus = mismatchNotice
        ? MISMATCH_NOTICE_MESSAGE
        // A battle that ended badly said nothing at all: the overlay simply stopped
        // changing. The server records why it stopped, so show that rather than leave
        // the player watching a screen that will never move again.
        : battle.failureReason
        ? `${describeBattleStage(battle.state)} (${battle.failureReason})`
        // A failed poll or a receipt that would not verify used to leave the overlay
        // spinning with the reason sitting unread in `error`.
        : battle.error
        ? `Could not follow this battle: ${battle.error.message}`
        : hasResolvedEvent && !animation.done
        ? 'Result in — playing out the fight…'
        : !hasResolvedEvent && animation.done && battle.liveReplay
        ? 'Finalizing…'
        : battle.phase === 'awaiting-vrf' || battle.phase === 'resolving'
        // The battle's own state rather than one word for six of them. A battle stalled
        // waiting on the independent verifier looked identical to one about to finish.
        ? describeBattleStage(battle.state)
        : battle.isConfirming
        ? 'Verifying the receipt…'
        : battle.isPending
        ? 'Awaiting your wallet…'
        : null;

    const battleButtonLabel = roomLoading
        ? 'Preparing…'
        : taunts.isLoading
        ? 'Facing off…'
        : battle.isPending
        ? pendingLabel
        : battle.isConfirming
        ? 'Confirming...'
        : 'Start Battle';
    const battleDisabled =
        roomLoading ||
        battle.isPending ||
        battle.isConfirming ||
        overlayOpen ||
        !selectedPet1 ||
        !selectedOpponent ||
        showResult;
    const randomMatchDisabled = !canRandomMatch || battle.isPending || showResult;

    const fighterDisplayName = selectedFighter?.name ?? 'Your pet';
    const opponentDisplayName = opponent?.name ?? 'Opponent';
    // Mechanical (round-by-round) log for the bottom log panel — null (not just empty)
    // when there's no live-replay feature this deployment (Solana, or an EVM deployment
    // with no GameConfig wired up), same fallback rule as liveHp1Percent/liveHp2Percent below.
    const liveLog: MechanicalLogLine[] | null = useMemo(
        () =>
            battle.liveReplay
                ? animation.history.map((entry) => ({
                      text: describeMechanicalLogEntry(entry, fighterDisplayName, opponentDisplayName),
                      isFighter: entry.attacker === 1,
                  }))
                : null,
        [battle.liveReplay, animation.history, fighterDisplayName, opponentDisplayName],
    );

    const overlay: BattleOverlayProps = {
        open: overlayOpen,
        showResult,
        battleOutcome: outcome.battleOutcome,
        fighter: selectedFighter,
        opponent,
        resultTurns: dialogue.resultTurns,
        dialogueLoading: dialogue.dialogueLoading,
        resultAttackerName: dialogue.attackerName,
        resultDefenderName: dialogue.defenderName,
        onResultComplete: dialogue.markResultDialogueDone,
        resultDialogueDone: dialogue.resultDialogueDone,
        onDone: handleDone,
        onBack: handleBack,
        preResultTitle,
        preResultStatus,
        tauntsLoading: taunts.isLoading,
        tauntsTurns: taunts.turns,
        onTauntsComplete: handleTauntsComplete,
        fighterName: fighterDisplayName,
        opponentName: opponentDisplayName,
        // Live-replay animation: only
        // populated once entropy has revealed and the sim inputs are known;
        // battle-overlay falls back to its existing static HP display otherwise
        // (Solana, or an EVM deployment with no GameConfig wired up).
        liveHp1Percent: battle.liveReplay ? animation.hp1Percent : null,
        liveHp2Percent: battle.liveReplay ? animation.hp2Percent : null,
        liveLog,
        liveFlourish: animation.flourish,
        // Nothing to replay without a live-replay log (Solana, or an EVM deployment with
        // no GameConfig wired up — see the liveLog comment above for the same fallback rule).
        canReplay: Boolean(battle.liveReplay?.log?.length),
        onWatchReplay: handleWatchReplay,
    };

    const setup: BattleSetupProps = {
        isStandaloneView,
        subtitle,
        selectedFighter,
        opponent,
        randomMatchDisabled,
        onRandomMatch: handleRandomMatch,
        readyPets,
        petsLoading: petsLoading && pets.length === 0,
        selectedPet1,
        onSelectFighter: setSelectedPet1,
        sortedOpponents,
        selectedOpponentKey: selectedOpponent,
        onSelectOpponent: handleSelectOpponent,
        opponentsLoading,
        opponentsEmptyReason,
        onRefreshOpponents: handleRefreshOpponents,
        onBattle: handleBattle,
        battleDisabled,
        battleButtonLabel,
        onCancel: handleCancel,
        winEstimate,
    };

    return {
        overlay,
        setup,
        hashHint,
        receipt: battle.lifecycle,
    };
};
