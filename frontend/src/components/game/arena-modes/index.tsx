import React from 'react';
import clsx from 'clsx';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBattleConfig } from '@shared/core';

import { BATTLE_PATH, TEAM_BATTLE_PATH } from '@constants/interactionRoutes';
import styles from './index.module.css';

const MODES = [
    { path: BATTLE_PATH, label: 'Duel' },
    { path: TEAM_BATTLE_PATH, label: 'Team 3v3' },
] as const;

/**
 * The arena's mode switch: a duel or a team battle. Each mode is its own page, so this only
 * moves between them; it draws nothing while the backend does not accept team battles, when
 * there is only one mode to be in.
 */
const ArenaModes: React.FC = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { data: config } = useBattleConfig();

    if (!config?.team?.enabled) return null;

    return (
        <nav className={styles.modes} aria-label="Battle mode">
            {MODES.map(({ path, label }) => {
                const here = pathname === path || pathname.startsWith(`${path}/`);
                return (
                    <button
                        key={path}
                        type="button"
                        className={clsx(styles.mode, here && styles.here)}
                        onClick={() => navigate(path)}
                        aria-current={here ? 'page' : undefined}
                    >
                        {label}
                    </button>
                );
            })}
        </nav>
    );
};

export default ArenaModes;
