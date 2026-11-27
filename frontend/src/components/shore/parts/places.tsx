import React from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

import {
    BATTLE_PATH,
    BREED_PATH,
    INVENTORY_PATH,
    LEADERBOARD_PATH,
    TEAM_BATTLE_PATH,
    TRAIN_PATH,
} from '@constants/interactionRoutes';
import { ArenaArt, BagArt, HallArt, NestArt, TeamCampArt, TrainingArt } from './place-art';
import styles from './places.module.css';

type Place = {
    id: 'hall' | 'arena' | 'team' | 'nest' | 'training' | 'bag';
    label: string;
    /** What the place opens, for screen readers; the drawn art carries no text. */
    opens: string;
    path: string;
    Art: React.FC;
    /** Shown only while the backend accepts team battles, as in the sidebar. */
    requiresTeamBattles?: boolean;
};

/** Each place is a door to a page that already exists; nothing here is a new feature. */
const PLACES: readonly Place[] = [
    { id: 'hall', label: 'Hall of Champions', opens: 'the leaderboard', path: LEADERBOARD_PATH, Art: HallArt },
    { id: 'nest', label: 'Nest', opens: 'the Breeding Lab', path: BREED_PATH, Art: NestArt },
    { id: 'training', label: 'Training', opens: 'the Training Ground', path: TRAIN_PATH, Art: TrainingArt },
    { id: 'bag', label: 'Bag', opens: 'your inventory', path: INVENTORY_PATH, Art: BagArt },
    {
        id: 'team',
        label: 'Team 3v3',
        opens: 'team battles',
        path: TEAM_BATTLE_PATH,
        Art: TeamCampArt,
        requiresTeamBattles: true,
    },
    { id: 'arena', label: 'Arena', opens: 'the Battle Arena', path: BATTLE_PATH, Art: ArenaArt },
];

const Places: React.FC<{ teamBattles: boolean }> = ({ teamBattles }) => {
    const navigate = useNavigate();

    return (
        <>
            {PLACES.filter((place) => teamBattles || !place.requiresTeamBattles).map(
                ({ id, label, opens, path, Art }) => (
                    <button
                        key={id}
                        type="button"
                        className={clsx(styles.place, styles[id])}
                        onClick={() => navigate(path)}
                        aria-label={`${label}: open ${opens}`}
                    >
                        <span className={styles.art}>
                            <Art />
                        </span>
                        <span className={styles.tag}>{label}</span>
                    </button>
                ),
            )}
        </>
    );
};

export default Places;
