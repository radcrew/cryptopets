import { useCallback, useMemo, useState } from 'react';

import {
    getPetSkill,
    type Pet,
    previewSquadTurnOrder,
    type Tactic,
    type TeamOpponent,
    useBackendBattle,
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
 * from the data.
 */
export type TeamPhase = 'choose-opponent' | 'build-squad' | 'submitting' | 'running' | 'result' | 'failed';

export interface SquadMember {
    petId: string;
    col: number;
    row: number;
    tactic: Tactic;
}

export const SQUAD_SIZE = 3;

/** Front line first, middle row first, so a pet added without a choice lands where it fights. */
const TILE_ORDER: readonly [number, number][] = [
    [2, 1], [2, 0], [2, 2], [1, 1], [1, 0], [1, 2], [0, 1], [0, 0], [0, 2],
];

const SIGNED_STATES = new Set(['signed', 'published', 'batched']);
const FAILED_STATES = new Set(['rejected', 'forfeited', 'verification_failed', 'signing_failed', 'expired']);

export function useTeamBattlePanel() {
    const opponents = useTeamOpponents();
    const { pets, isLoading: petsLoading } = usePetList();
    const challenge = useSubmitTeamChallenge();

    const [opponent, setOpponent] = useState<TeamOpponent | null>(null);
    const [squad, setSquad] = useState<SquadMember[]>([]);
    const [battleId, setBattleId] = useState<string | null>(null);

    const battle = useBackendBattle(battleId);
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

    const petsById = useMemo(() => new Map(pets.map((pet) => [pet.id, pet])), [pets]);

    const addPet = useCallback((petId: string) => {
        setSquad((current) => {
            if (current.length >= SQUAD_SIZE || current.some((m) => m.petId === petId)) return current;
            const free = TILE_ORDER.find(([col, row]) => !current.some((m) => m.col === col && m.row === row));
            if (!free) return current;
            return [...current, { petId, col: free[0], row: free[1], tactic: 'focus' }];
        });
    }, []);

    const removePet = useCallback((petId: string) => {
        setSquad((current) => current.filter((m) => m.petId !== petId));
    }, []);

    /** Moves a squad pet to a tile, swapping with whoever stands there. */
    const placePet = useCallback((petId: string, col: number, row: number) => {
        setSquad((current) => {
            const moving = current.find((m) => m.petId === petId);
            if (!moving) return current;
            return current.map((m) => {
                if (m.petId === petId) return { ...m, col, row };
                if (m.col === col && m.row === row) return { ...m, col: moving.col, row: moving.row };
                return m;
            });
        });
    }, []);

    const setTactic = useCallback((petId: string, tactic: Tactic) => {
        setSquad((current) => current.map((m) => (m.petId === petId ? { ...m, tactic } : m)));
    }, []);

    const chooseOpponent = useCallback((next: TeamOpponent | null) => {
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
    const squadLevel =
        squad.length > 0 ? Math.max(...squad.map((m) => petsById.get(m.petId)?.level ?? 1)) : null;
    const inBand = (o: TeamOpponent) =>
        squadLevel === null || (squadLevel >= o.minLevel && squadLevel <= o.maxLevel);
    const levelInBand = !opponent || inBand(opponent);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const squadReady = squad.every((m) => (petsById.get(m.petId)?.readyAt ?? 0) <= nowSeconds);
    const canStart =
        Boolean(opponent?.ready) && squad.length === SQUAD_SIZE && squadReady && levelInBand && !challenge.isPending;

    const start = useCallback(async () => {
        if (!opponent || squad.length !== SQUAD_SIZE) return;
        const accepted = await challenge.submit({
            attackers: squad,
            defenderOwner: opponent.defenderOwner,
            defensePlanHash: opponent.planHash,
        });
        if (accepted) setBattleId(accepted.battleId);
    }, [challenge, opponent, squad]);

    /** Back to the opponent list, keeping the squad for the next challenge. */
    const reset = useCallback(() => {
        setOpponent(null);
        setBattleId(null);
    }, []);

    /** Clears the rival and the squad, for starting over. */
    const cancel = useCallback(() => {
        reset();
        setSquad([]);
    }, [reset]);

    /** A ready team the squad's level qualifies for, other than the current one where possible. */
    const chooseRandomOpponent = () => {
        const fits = (opponents.data ?? []).filter((o) => o.ready && inBand(o));
        const others = fits.filter((o) => o.planHash !== opponent?.planHash);
        const pool = others.length > 0 ? others : fits;
        if (pool.length > 0) chooseOpponent(pool[Math.floor(Math.random() * pool.length)]!);
    };

    return {
        phase,
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
        setTactic,
        turnOrder,
        squadLevel,
        levelInBand,
        squadReady,
        canStart,
        start,
        reset,
        cancel,
        error: challenge.error ?? (result.error as Error | null) ?? null,
        battleId,
        battleState: state ?? null,
        failureReason: battle.data?.failureReason ?? null,
        result: result.data ?? null,
    };
}
