import React from 'react';
import clsx from 'clsx';
import { useLocation } from 'react-router-dom';

import Ambient from '@components/layout/ambient';
import Dock from '@components/layout/dock';
import Hud from '@components/layout/hud';
import SceneBackdrop, { sceneFor } from '@components/layout/scene-backdrop';
import NetworkGate from '@components/wallet/network-gate';
import { PartyProvider } from '@contexts/party';
import { DASHBOARD_HOME } from '@constants/interactionRoutes';
import styles from './index.module.css';

type AppShellProps = {
    children: React.ReactNode;
};

/**
 * The game frame: the current place drawn full screen, the HUD floating over its top and the
 * dock over its bottom, with routed pages on the stage between them.
 *
 * The Shore is the home screen and fills the whole stage edge to edge. Every other page sits
 * on its own scene (the arena, the nest, the Hall of Champions, the market, or the Shore at
 * night), dimmed a little under the page's panels.
 */
const AppShell: React.FC<AppShellProps> = ({ children }) => {
    const { pathname } = useLocation();
    const home = pathname === DASHBOARD_HOME;

    return (
        <PartyProvider>
            <div className={styles.shell}>
                <SceneBackdrop scene={sceneFor(pathname)} dim={!home} />
                <Ambient />
                <main className={clsx(styles.stage, home && styles.full)}>
                    <NetworkGate />
                    {children}
                </main>
                <Hud />
                <Dock />
            </div>
        </PartyProvider>
    );
};

export default AppShell;
