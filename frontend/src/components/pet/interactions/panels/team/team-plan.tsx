import React, { useEffect, useState } from 'react';

import NeonButton from '@components/ui/neon-button';
import { type PlanRosterEntry, type Tactic, useDefensePlan, usePetList } from '@shared/core';

import { type ArtPet, teamPetArt } from './art';
import { ZoneGrid } from './team-board';
import TeamPetDetails, { type PetSelection } from './team-pet-details';
import TeamPetGrid from './team-pet-grid';
import styles from './index.module.css';

const ROSTER_SIZE = 5;
const TILE_ORDER: readonly [number, number][] = [
    [2, 1], [2, 0], [2, 2], [1, 1], [1, 0], [1, 2], [0, 1], [0, 0], [0, 2],
];

/** A roster pet in the editor. Rank is its position in the list, so it is not stored. */
type Draft = Omit<PlanRosterEntry, 'rank'>;

/**
 * The defence plan editor: five pets, ranked by order, each with a home tile and a tactic.
 *
 * A form over one action, so it keeps its own state rather than having a controller hook,
 * like the other single-action panels. Saving signs the plan and replaces the previous one;
 * the three defenders of any battle are drawn from these five, higher ranks more often.
 */
const TeamPlan: React.FC = () => {
    const { pets } = usePetList();
    const { plan, save, revoke, isPending, error } = useDefensePlan();
    const [roster, setRoster] = useState<Draft[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    // Starts from the saved plan, so editing one is a change rather than a rebuild.
    useEffect(() => {
        if (plan) {
            setRoster(
                [...plan.roster]
                    .sort((a, b) => a.rank - b.rank)
                    .map(({ petId, col, row, tactic }) => ({ petId, col, row, tactic })),
            );
        }
    }, [plan]);

    const name = (petId: string) => pets.find((p) => p.id === petId)?.name ?? `Pet ${petId}`;
    const art = (petId: string): ArtPet => pets.find((p) => p.id === petId) ?? teamPetArt(petId, 0n, name(petId));
    const rosterIds = roster.map((d) => d.petId);

    const add = (petId: string) =>
        setRoster((current) => {
            if (current.length >= ROSTER_SIZE) return current;
            const free = TILE_ORDER.find(([col, row]) => !current.some((d) => d.col === col && d.row === row));
            return free ? [...current, { petId, col: free[0], row: free[1], tactic: 'focus' }] : current;
        });
    const remove = (petId: string) => setRoster((current) => current.filter((d) => d.petId !== petId));
    /** Gives a pet another rank by swapping places with the pet that holds it. */
    const setRank = (petId: string, rank: number) =>
        setRoster((current) => {
            const from = current.findIndex((d) => d.petId === petId);
            const to = rank - 1;
            if (from < 0 || to < 0 || to >= current.length || from === to) return current;
            const next = [...current];
            [next[from], next[to]] = [next[to]!, next[from]!];
            return next;
        });
    const place = (petId: string, col: number, row: number) =>
        setRoster((current) => {
            const moving = current.find((d) => d.petId === petId);
            if (!moving) return current;
            return current.map((d) => {
                if (d.petId === petId) return { ...d, col, row };
                if (d.col === col && d.row === row) return { ...d, col: moving.col, row: moving.row };
                return d;
            });
        });
    const setTactic = (petId: string, tactic: Tactic) =>
        setRoster((current) => current.map((d) => (d.petId === petId ? { ...d, tactic } : d)));

    const selectedIndex = roster.findIndex((d) => d.petId === selected);
    const selection = ((): PetSelection | null => {
        const draft = roster[selectedIndex];
        const pet = pets.find((p) => p.id === selected);
        if (!draft || !pet) return null;
        return {
            petId: pet.id,
            side: 0,
            pet: { art: pet, name: pet.name, level: pet.level, rarity: pet.rarity, dna: pet.dna, speciesId: pet.speciesId, readyAt: pet.readyAt },
            col: draft.col,
            row: draft.row,
            tactic: draft.tactic,
        };
    })();

    const handleSave = async () => {
        setMessage(null);
        const hash = await save({ roster: roster.map((d, i) => ({ ...d, rank: i + 1 })) });
        if (hash) setMessage('Your team is saved. Other players can now challenge it.');
    };
    const handleWithdraw = async () => {
        setMessage(null);
        if (await revoke()) setMessage('Your team is withdrawn from challenges.');
    };

    return (
        <div className={styles.panel}>
            {plan?.isStale && (
                <p className={styles.stale} role="status">
                    The battle rules changed since you saved this team, so it cannot be challenged. Save it again.
                </p>
            )}
            {plan && !plan.isStale && (
                <p className={styles.active} role="status">
                    Your team is open to challenges.
                </p>
            )}
            {!plan && <p className={styles.muted}>You have no team saved, so nobody can challenge you in team battles.</p>}

            <div className={styles.boardRow}>
                <div className={styles.zoneColumn}>
                    <ZoneGrid
                        label="Your defence zone"
                        side={0}
                        members={roster.map((d, i) => ({ petId: d.petId, col: d.col, row: d.row, art: art(d.petId), label: name(d.petId), sub: `Rank ${i + 1}` }))}
                        selectedPetId={selection ? selected : null}
                        onPetClick={(petId) => setSelected((current) => (current === petId ? null : petId))}
                        onEmptyClick={selection ? (col, row) => place(selection.petId, col, row) : undefined}
                        onDropPet={place}
                    />
                </div>
                <TeamPetDetails
                    selection={selection}
                    onTacticChange={selection ? (tactic) => setTactic(selection.petId, tactic) : undefined}
                    rank={
                        selection
                            ? { current: selectedIndex + 1, count: roster.length, onPick: (rank) => setRank(selection.petId, rank) }
                            : undefined
                    }
                />
            </div>
            <p className={styles.muted}>
                Tap a pet below to add or remove it. Tap a pet on the zone to see its details and set its
                tactic and rank. To move it, tap an empty tile, or drag it onto another pet to swap them.
            </p>

            <h4>
                Choose your team ({roster.length}/{ROSTER_SIZE})
            </h4>
            <TeamPetGrid
                label="Your pets"
                pets={pets}
                selected={rosterIds}
                max={ROSTER_SIZE}
                onToggle={(petId) => (rosterIds.includes(petId) ? remove(petId) : add(petId))}
            />
            {pets.length < ROSTER_SIZE && <p className={styles.muted}>A team needs five pets.</p>}

            {error && <p className={styles.error}>{error.message}</p>}
            {message && <p role="status">{message}</p>}
            <div className={styles.row}>
                <NeonButton tone="emerald" disabled={isPending || roster.length !== ROSTER_SIZE} onClick={() => void handleSave()}>
                    {isPending ? 'Signing…' : 'Save team'}
                </NeonButton>
                <NeonButton tone="magenta" disabled={isPending || !plan} onClick={() => void handleWithdraw()}>
                    Withdraw
                </NeonButton>
            </div>
        </div>
    );
};

export default TeamPlan;
