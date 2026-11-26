import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import InfoTooltip from '@components/ui/info-tooltip';
import NeonButton from '@components/ui/neon-button';
import { SQUAD_SIZE } from '@hooks/team/useTeamBattlePanel';
import { type PlanRosterEntry, type Tactic, useDefensePlan, usePetList } from '@shared/core';

import { type ArtPet, teamPetArt } from './art';
import { tacticShort } from './tactics';
import { ZoneGrid } from './team-board';
import TeamFormationCheck from './team-formation-check';
import TeamPetDetails, { type PetSelection } from './team-pet-details';
import TeamPetGrid from './team-pet-grid';
import TeamPlanRules, {
    DEFAULT_PLAN_RULES,
    type PlanRules,
    planRulesError,
    rulesFromPlan,
} from './team-plan-rules';
import styles from './index.module.css';

const TILE_ORDER: readonly [number, number][] = [
    [2, 1],
    [2, 0],
    [2, 2],
    [1, 1],
    [1, 0],
    [1, 2],
    [0, 1],
    [0, 0],
    [0, 2],
];

/**
 * The defence plan editor: the three pets that defend, each with a home tile and a tactic.
 *
 * A form over one action, so it keeps its own state rather than having a controller hook,
 * like the other single-action panels. Saving signs the plan and replaces the previous one.
 */
const TeamPlan: React.FC = () => {
    const { pets, isLoading } = usePetList();
    const petsLoading = isLoading && pets.length === 0;
    const { plan, save, revoke, isPending, error } = useDefensePlan();
    const [roster, setRoster] = useState<PlanRosterEntry[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [rules, setRules] = useState<PlanRules>(DEFAULT_PLAN_RULES);
    const rulesError = planRulesError(rules);

    // Starts from the saved plan, so editing one is a change rather than a rebuild.
    useEffect(() => {
        if (plan) {
            setRoster(
                plan.roster.map(({ petId, col, row, tactic }) => ({ petId, col, row, tactic })),
            );
            setRules(rulesFromPlan(plan));
        }
    }, [plan]);

    const name = (petId: string) => pets.find((p) => p.id === petId)?.name ?? `Pet ${petId}`;
    const art = (petId: string): ArtPet =>
        pets.find((p) => p.id === petId) ?? teamPetArt(petId, 0n, name(petId));
    const rosterIds = roster.map((d) => d.petId);

    const add = (petId: string) =>
        setRoster((current) => {
            if (current.length >= SQUAD_SIZE) return current;
            const free = TILE_ORDER.find(
                ([col, row]) => !current.some((d) => d.col === col && d.row === row),
            );
            return free
                ? [...current, { petId, col: free[0], row: free[1], tactic: 'focus' }]
                : current;
        });
    const remove = (petId: string) =>
        setRoster((current) => current.filter((d) => d.petId !== petId));
    const place = (petId: string, col: number, row: number) =>
        setRoster((current) => {
            const moving = current.find((d) => d.petId === petId);
            if (!moving) return current;
            return current.map((d) => {
                if (d.petId === petId) return { ...d, col, row };
                if (d.col === col && d.row === row)
                    return { ...d, col: moving.col, row: moving.row };
                return d;
            });
        });
    const setTactic = (petId: string, tactic: Tactic) =>
        setRoster((current) => current.map((d) => (d.petId === petId ? { ...d, tactic } : d)));

    const selection = ((): PetSelection | null => {
        const draft = roster.find((d) => d.petId === selected);
        const pet = pets.find((p) => p.id === selected);
        if (!draft || !pet) return null;
        return {
            petId: pet.id,
            side: 0,
            pet: {
                art: pet,
                name: pet.name,
                level: pet.level,
                rarity: pet.rarity,
                dna: pet.dna,
                speciesId: pet.speciesId,
                readyAt: pet.readyAt,
            },
            col: draft.col,
            row: draft.row,
            tactic: draft.tactic,
        };
    })();

    const handleSave = async () => {
        setMessage(null);
        if (await save({ roster, ...rules }))
            setMessage('Your team is saved. Other players can now challenge it.');
    };
    const handleWithdraw = async () => {
        setMessage(null);
        if (await revoke()) setMessage('Your team is withdrawn from challenges.');
    };

    return (
        <div className={styles.planLayout}>
            {plan?.isStale && (
                <p className={clsx(styles.stale, styles.planBanner)} role="status">
                    The battle rules changed since you saved this team, so it cannot be challenged.
                    Save it again.
                </p>
            )}
            <div className={clsx(styles.panel, styles.arena)}>
                <div className={styles.boardRow}>
                    <div className={styles.zoneColumn}>
                        <h4 className={styles.columnHeading}>Defence zone</h4>
                        <ZoneGrid
                            label="Your defence zone"
                            side={0}
                            members={roster.map((d) => ({
                                petId: d.petId,
                                col: d.col,
                                row: d.row,
                                art: art(d.petId),
                                label: name(d.petId),
                                sub: tacticShort(d.tactic),
                            }))}
                            selectedPetId={selection ? selected : null}
                            onPetClick={(petId) =>
                                setSelected((current) => (current === petId ? null : petId))
                            }
                            onEmptyClick={
                                selection
                                    ? (col, row) => place(selection.petId, col, row)
                                    : undefined
                            }
                            onDropPet={place}
                        />
                    </div>
                    <div className={styles.detailsColumn}>
                        <h4 className={styles.columnHeading}>Pet details</h4>
                        <TeamPetDetails
                            selection={selection}
                            onTacticChange={
                                selection
                                    ? (tactic) => setTactic(selection.petId, tactic)
                                    : undefined
                            }
                        />
                    </div>
                </div>

                <div className={styles.sectionHead}>
                    <h4 className={styles.columnHeading}>
                        Choose your team ({roster.length}/{SQUAD_SIZE})
                        <InfoTooltip subject="Building your team">
                            These three pets defend whenever someone challenges you. Tap a pet to
                            add or remove it. Tap a pet on the zone to see its details and set its
                            tactic. To move it, tap an empty tile, or drag it onto another pet to
                            swap them.
                        </InfoTooltip>
                    </h4>
                    <div className={styles.row}>
                        <NeonButton
                            size="sm"
                            tone="emerald"
                            disabled={
                                isPending || roster.length !== SQUAD_SIZE || rulesError !== null
                            }
                            onClick={() => void handleSave()}
                        >
                            {isPending ? 'Signing…' : 'Save team'}
                        </NeonButton>
                        <NeonButton
                            size="sm"
                            tone="magenta"
                            disabled={isPending || !plan}
                            onClick={() => void handleWithdraw()}
                        >
                            Withdraw
                        </NeonButton>
                    </div>
                </div>
                <TeamPetGrid
                    loading={petsLoading}
                    label="Your pets"
                    pets={pets}
                    selected={rosterIds}
                    max={SQUAD_SIZE}
                    onToggle={(petId) => (rosterIds.includes(petId) ? remove(petId) : add(petId))}
                />
                {!petsLoading && pets.length < SQUAD_SIZE && (
                    <p className={styles.muted}>A team needs three pets.</p>
                )}
                {error && <p className={styles.error}>{error.message}</p>}
                {message && <p role="status">{message}</p>}
            </div>
            <div className={styles.planSide}>
                <TeamPlanRules rules={rules} onChange={setRules} plan={plan} disabled={isPending} />
                <TeamFormationCheck roster={roster} pets={pets} />
            </div>
        </div>
    );
};

export default TeamPlan;
