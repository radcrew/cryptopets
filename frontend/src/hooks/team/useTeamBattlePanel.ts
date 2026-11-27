import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    firstFreeTile,
    getPetSkill,
    type Pet,
    previewSquadTurnOrder,
    SQUAD_SIZE,
    type Tactic,
    type TeamOpponent,
    useAuth,
    useBackendBattle,
    usePetCooldowns,
    usePetList,
    useSubmitTeamChallenge,
    useTeamBattleResult,
    useTeamOpponents,
} from '@shared/core';

/**
 * The team challenge flow (docs/plan-team-battles-3v3.md, Phase 5): pick a defender's plan,
 * build and place a squad of three, sign, then follow the battle to its verified result.
 *
 * A controller hook rather than component state because the flow has real intermediate states a
 * player sits in, like the duel's `useBattlePanel`: the squad being built, the signature, the
 * battle running through the backend pipeline, and the result. The phase is derived from what
 * exists (an opponent, a battle id, the battle's state) rather than stored, so it cannot drift
 * from the data. The screen's own interaction state lives here too (the pet picked up to move,
 * and whether the battle scene is put away), so the view holds none.
 */
export type TeamPhase = 'choose-opponent' | 'build-squad' | 'submitting' | 'running' | 'result' | 'failed';

export interface SquadMember {
    petId: string;
    col: number;
    row: number;
    tactic: Tactic;
}

const SIGNED_STATES = new Set(['signed', 'published', 'batched']);
const FAILED_STATES = new Set(['rejected', 'forfeited', 'verification_failed', 'signing_failed', 'expired']);

/**
 * How often an unfinished battle is re-read. Team battles have no battle room to push their
 * changes, so polling is the only signal, and at the default five seconds it added up to that
 * long to every battle after its receipt was already signed.
 */
const BATTLE_POLL_MS = 1000;

export function useTeamBattlePanel() {
    const queryClient = useQueryClient();
    const { isAuthenticated } = useAuth();
    const opponents = useTeamOpponents();
    const { pets, isLoading: petsLoading } = usePetList();
    const challenge = useSubmitTeamChallenge();
    // Ticks once a second while any pet rests, so readiness below never goes stale on screen.
    usePetCooldowns(pets);

    const [opponent, setOpponent] = useState<TeamOpponent | null>(null);
    const [squad, setSquad] = useState<SquadMember[]>([]);
    const [battleId, setBattleId] = useState<string | null>(null);
    const [moving, setMoving] = useState<string | null>(null);
    const [hiddenBattle, setHiddenBattle] = useState<string | null>(null);

    const battle = useBackendBattle(battleId, { pollIntervalMs: BATTLE_POLL_MS });
    const state = battle.data?.state;
    const signed = state !== undefined && SIGNED_STATES.has(state);
    const result = useTeamBattleResult(battleId, signed);

    const phase: TeamPhase = !opponent
        ? 'choose-opponent'
        : challenge.isPending
          ? 'submitting'
          : !battleId
            ? 'build-squad'
            : state !== undefined && FAILED_STATES.has(state)
              ? 'failed'
              : signed && result.data
                ? 'result'
                : // A signed battle whose result will not check out is a failure to show, not a
                  // battle still running: the playback would not be the fight that was signed.
                  signed && result.isError
                  ? 'failed'
                  : 'running';

    /**
     * A battle is being signed or fought. Nothing that changes the squad or the rival is allowed
     * meanwhile: the scene can be put away, and starting, cancelling or choosing another team
     * from under it used to drop the running battle, its result never shown.
     */
    const inFlight = phase === 'submitting' || phase === 'running';
    const inFlightRef = useRef(inFlight);
    inFlightRef.current = inFlight;

    // Once a battle ends, everything it changed is re-read: the six pets' cooldowns and levels
    // (backend progression), and the defender's readiness in the team list. Without this the
    // screen offered a next battle the backend would refuse as resting.
    const refreshedFor = useRef<string | null>(null);
    useEffect(() => {
        if (!battleId || (phase !== 'result' && phase !== 'failed') || refreshedFor.current === battleId) return;
        refreshedFor.current = battleId;
        void queryClient.invalidateQueries({ queryKey: ['battleProgress'] });
        void queryClient.invalidateQueries({ queryKey: ['battle', 'team-opponents'] });
    }, [battleId, phase, queryClient]);

    const petsById = useMemo(() => new Map(pets.map((pet) => [pet.id, pet])), [pets]);

    const addPet = useCallback((petId: string) => {
        if (inFlightRef.current) return;
        setSquad((current) => {
            if (current.length >= SQUAD_SIZE || current.some((m) => m.petId === petId)) return current;
            const free = firstFreeTile(current);
            if (!free) return current;
            return [...current, { petId, col: free[0], row: free[1], tactic: 'focus' }];
        });
    }, []);

    const removePet = useCallback((petId: string) => {
        if (inFlightRef.current) return;
        setSquad((current) => current.filter((m) => m.petId !== petId));
        setMoving((current) => (current === petId ? null : current));
    }, []);

    /** Moves a squad pet to a tile, swapping with whoever stands there. */
    const placePet = useCallback((petId: string, col: number, row: number) => {
        if (inFlightRef.current) return;
        setSquad((current) => {
            const mover = current.find((m) => m.petId === petId);
            if (!mover) return current;
            return current.map((m) => {
                if (m.petId === petId) return { ...m, col, row };
                if (m.col === col && m.row === row) return { ...m, col: mover.col, row: mover.row };
                return m;
            });
        });
    }, []);

    /** Picks a squad pet up to move it, or puts it back down. */
    const selectPet = useCallback((petId: string) => {
        setMoving((current) => (current === petId ? null : petId));
    }, []);

    /** Moves the picked-up pet to an empty tile. */
    const placeMoving = useCallback(
        (col: number, row: number) => {
            if (moving) placePet(moving, col, row);
        },
        [moving, placePet],
    );

    const setTactic = useCallback((petId: string, tactic: Tactic) => {
        if (inFlightRef.current) return;
        setSquad((current) => current.map((m) => (m.petId === petId ? { ...m, tactic } : m)));
    }, []);

    const chooseOpponent = useCallback((next: TeamOpponent | null) => {
        if (inFlightRef.current) return;
        setOpponent(next);
        setBattleId(null);
    }, []);

    /** Slot indices of the squad in the order it will act among itself. */
    const turnOrder = useMemo(
        () =>
            previewSquadTurnOrder(
                squad.map((m) => {
                    const pet = petsById.get(m.petId) as Pet | undefined;
                    return {
                        dna: pet?.dna ?? 0n,
                        rarity: pet?.rarity ?? 1,
                        level: pet?.level ?? 1,
                        skill: getPetSkill(pet?.speciesId)?.index ?? 99,
                    };
                }),
            ),
        [petsById, squad],
    );

    // The backend counts a squad as its highest-level pet against the defender's level band.
    const squadLevel = squad.length > 0 ? Math.max(...squad.map((m) => petsById.get(m.petId)?.level ?? 1)) : null;
    const inBand = (o: TeamOpponent) => squadLevel === null || (squadLevel >= o.minLevel && squadLevel <= o.maxLevel);
    const levelInBand = !opponent || inBand(opponent);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const squadReady = squad.every((m) => (petsById.get(m.petId)?.readyAt ?? 0) <= nowSeconds);
    const canStart =
        Boolean(opponent?.ready) && squad.length === SQUAD_SIZE && squadReady && levelInBand && !inFlight;

    const start = useCallback(async () => {
        if (inFlightRef.current || !opponent || squad.length !== SQUAD_SIZE) return;
        // A new battle replaces whatever the screen still held from the last one, and opens
        // the scene even if the last one's was put away.
        setMoving(null);
        setBattleId(null);
        setHiddenBattle(null);
        const accepted = await challenge.submit({
            attackers: squad,
            defenderOwner: opponent.defenderOwner,
            defensePlanHash: opponent.planHash,
        });
        if (accepted) setBattleId(accepted.battleId);
    }, [challenge, opponent, squad]);

    /** Back to the opponent list, keeping the squad for the next challenge. */
    const reset = useCallback(() => {
        if (inFlightRef.current) return;
        setOpponent(null);
        setBattleId(null);
    }, []);

    /** Clears the rival and the squad, for starting over. */
    const cancel = useCallback(() => {
        if (inFlightRef.current) return;
        reset();
        setSquad([]);
        setMoving(null);
    }, [reset]);

    /** A ready team the squad's level qualifies for, other than the current one where possible. */
    const chooseRandomOpponent = () => {
        const fits = (opponents.data ?? []).filter((o) => o.ready && inBand(o));
        const others = fits.filter((o) => o.planHash !== opponent?.planHash);
        const pool = others.length > 0 ? others : fits;
        if (pool.length > 0) chooseOpponent(pool[Math.floor(Math.random() * pool.length)]!);
    };

    // The battle scene, from signing to the result. A running battle can be put away and brought
    // back; a new battle always opens it again.
    const inBattle = inFlight || phase === 'result' || phase === 'failed';
    const sceneOpen = inBattle && (battleId === null || hiddenBattle !== battleId);
    const hideScene = useCallback(() => setHiddenBattle(battleId), [battleId]);
    const showScene = useCallback(() => setHiddenBattle(null), []);

    return {
        phase,
        signedIn: isAuthenticated,
        opponents: opponents.data ?? [],
        opponentsLoading: opponents.isLoading,
        opponentsFetching: opponents.isFetching,
        refreshOpponents: () => void opponents.refetch(),
        opponent,
        chooseOpponent,
        chooseRandomOpponent,
        pets,
        petsLoading: petsLoading && pets.length === 0,
        squad,
        addPet,
        removePet,
        placePet,
        moving,
        selectPet,
        placeMoving,
        setTactic,
        turnOrder,
        squadLevel,
        levelInBand,
        squadReady,
        canStart,
        inFlight,
        start,
        reset,
        cancel,
        inBattle,
        sceneOpen,
        hideScene,
        showScene,
        error: challenge.error ?? (result.error as Error | null) ?? null,
        battleId,
        battleState: state ?? null,
        failureReason: battle.data?.failureReason ?? null,
        result: result.data ?? null,
    };
}
