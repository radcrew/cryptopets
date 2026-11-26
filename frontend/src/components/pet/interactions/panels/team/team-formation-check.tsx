import clsx from 'clsx';
import React, { useMemo } from 'react';

import InfoTooltip from '@components/ui/info-tooltip';
import {
    analyzeFormation,
    type FormationPet,
    getPetSkill,
    type Pet,
    type PlanRosterEntry,
} from '@shared/core';

import styles from './index.module.css';

const ORDINALS = ['1st', '2nd', '3rd'] as const;

export interface TeamFormationCheckProps {
    roster: PlanRosterEntry[];
    pets: Pet[];
}

/**
 * How a defence team's placement works out, recomputed as pets are added and moved: the order
 * they act in among themselves, who holds the front line, and which neighbour rules reach a
 * teammate. The rules themselves live in `analyzeFormation`, in `@shared/core`.
 */
const TeamFormationCheck: React.FC<TeamFormationCheckProps> = ({ roster, pets }) => {
    const formation = useMemo<FormationPet[]>(
        () =>
            roster.flatMap((entry) => {
                const pet = pets.find((p) => p.id === entry.petId);
                if (!pet) return [];
                return [
                    {
                        name: pet.name,
                        col: entry.col,
                        row: entry.row,
                        skill: getPetSkill(pet.speciesId)?.index ?? -1,
                        dna: pet.dna,
                        rarity: pet.rarity,
                        level: pet.level,
                    },
                ];
            }),
        [pets, roster],
    );
    const report = useMemo(() => analyzeFormation(formation), [formation]);

    return (
        <section className={styles.sideCard} aria-label="Formation check">
            <h4 className={styles.columnHeading}>
                Formation check
                <InfoTooltip subject="Formation check">
                    How your placement works out in a fight. Your three act in the order shown:
                    Shell pets act last, and otherwise higher INT goes first. Pets help each other
                    only when their tiles touch along a side, never across a corner.
                </InfoTooltip>
            </h4>
            {formation.length === 0 ? (
                <p className={styles.fieldHint}>Add pets to see how they work together.</p>
            ) : (
                <>
                    <div className={styles.fieldRow}>
                        <span>Turn order</span>
                        <ol className={styles.chips} aria-label="Turn order">
                            {report.turnOrder.map((index, place) => (
                                <li key={index} className={styles.chip}>
                                    {ORDINALS[place]} {formation[index]?.name}
                                </li>
                            ))}
                        </ol>
                    </div>
                    <ul className={styles.notes} aria-label="Formation notes">
                        {report.notes.map((note) => (
                            <li
                                key={note.text}
                                className={clsx(
                                    styles.note,
                                    note.kind === 'good' && styles.noteGood,
                                    note.kind === 'warning' && styles.noteWarning,
                                    note.kind === 'info' && styles.noteInfo,
                                )}
                            >
                                {note.text}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
};

export default TeamFormationCheck;
