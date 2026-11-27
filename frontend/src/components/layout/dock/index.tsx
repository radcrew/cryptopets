import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBattleConfig } from '@shared/core';

import {
    BATTLE_PATH,
    BREED_PATH,
    DASHBOARD_HOME,
    INVENTORY_PATH,
    LEADERBOARD_PATH,
    PETS_PATH,
    TEAM_BATTLE_PATH,
} from '@constants/interactionRoutes';
import { NAV_ITEMS } from '@components/layout/nav-items';
import { BagIcon, DockDefs, MoreIcon, NestIcon, PawIcon, SwordsIcon, TrophyIcon } from './icons';
import styles from './index.module.css';

type DockKey = {
    id: 'pets' | 'nest' | 'battle' | 'bag' | 'ranks';
    label: string;
    path: string;
    Icon: React.FC;
    /** Other paths that light this key, such as team battles under Battle. */
    alsoOn?: string[];
};

/** The five places a player goes most, as keys; the rest sit one tap away under More. */
const KEYS: readonly DockKey[] = [
    { id: 'pets', label: 'Pets', path: PETS_PATH, Icon: PawIcon },
    { id: 'nest', label: 'Nest', path: BREED_PATH, Icon: NestIcon },
    { id: 'battle', label: 'Battle', path: BATTLE_PATH, Icon: SwordsIcon, alsoOn: [TEAM_BATTLE_PATH] },
    { id: 'bag', label: 'Bag', path: INVENTORY_PATH, Icon: BagIcon },
    { id: 'ranks', label: 'Ranks', path: LEADERBOARD_PATH, Icon: TrophyIcon },
];

const isOn = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/**
 * The game's dock: chunky keys along the bottom of every scene, with the battle key in the
 * middle, and a More sheet that lists every page so nothing the dock lacks a key for is lost.
 */
const Dock: React.FC = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { data: battleConfig } = useBattleConfig();
    const teamBattles = Boolean(battleConfig?.team?.enabled);
    const [sheetOpen, setSheetOpen] = useState(false);
    const root = useRef<HTMLElement>(null);

    // The sheet is a way somewhere: arriving closes it.
    useEffect(() => setSheetOpen(false), [pathname]);

    useEffect(() => {
        if (!sheetOpen) return undefined;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheetOpen(false);
        const onPointer = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) setSheetOpen(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('pointerdown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('pointerdown', onPointer);
        };
    }, [sheetOpen]);

    const places = NAV_ITEMS.filter((item) => teamBattles || !item.requiresTeamBattles);

    return (
        <nav className={styles.dock} aria-label="Primary" ref={root}>
            <DockDefs />
            {sheetOpen && (
                <div className={styles.sheet} role="dialog" aria-label="All places">
                    <button
                        type="button"
                        className={clsx(styles.place, styles.cyan, pathname === DASHBOARD_HOME && styles.here)}
                        onClick={() => navigate(DASHBOARD_HOME)}
                        aria-current={pathname === DASHBOARD_HOME ? 'page' : undefined}
                    >
                        <span className={styles.placeIcon} aria-hidden>
                            🏝️
                        </span>
                        <span>The Shore</span>
                    </button>
                    {places.map((item) => {
                        const here = item.path != null && isOn(pathname, item.path);
                        return (
                            <button
                                key={item.id}
                                type="button"
                                className={clsx(styles.place, styles[item.tone], here && styles.here)}
                                onClick={() => item.path && navigate(item.path)}
                                disabled={item.deferred}
                                aria-current={here ? 'page' : undefined}
                                title={item.deferred ? `${item.label}: coming soon` : item.label}
                            >
                                <span className={styles.placeIcon} aria-hidden>
                                    <img src={item.iconSrc} alt="" width={26} height={26} />
                                </span>
                                <span>{item.label}</span>
                                {item.deferred && <span className={styles.soon}>Soon</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className={styles.keys}>
                {KEYS.map(({ id, label, path, Icon, alsoOn }) => {
                    const here = isOn(pathname, path) || Boolean(alsoOn?.some((p) => isOn(pathname, p)));
                    return (
                        <button
                            key={id}
                            type="button"
                            className={clsx(styles.key, styles[id], here && styles.here)}
                            onClick={() => navigate(path)}
                            aria-current={here ? 'page' : undefined}
                        >
                            <Icon />
                            <span className={styles.label}>{label}</span>
                        </button>
                    );
                })}
                <button
                    type="button"
                    className={clsx(styles.key, styles.more, sheetOpen && styles.here)}
                    onClick={() => setSheetOpen((o) => !o)}
                    aria-expanded={sheetOpen}
                >
                    <MoreIcon />
                    <span className={styles.label}>More</span>
                </button>
            </div>
        </nav>
    );
};

export default Dock;
