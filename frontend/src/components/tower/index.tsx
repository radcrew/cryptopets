import React from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

import DashboardPanel from '@components/common/dashboard-panel';
import ComingSoon from '@components/game/coming-soon';
import { DASHBOARD_HOME } from '@constants/interactionRoutes';
import styles from './index.module.css';

/** The floors drawn in the preview, top first: the next floor to climb is the bottom one. */
const FLOORS = [6, 5, 4, 3, 2, 1];

/**
 * The Tower, a planned mode: fifty floors of house wardens to climb with one pet, a chest
 * every fifth floor, and a season board of the highest climbers.
 *
 * A preview only. Nothing here reads or writes game state; the floors, warden and rewards
 * are sample content inside a Coming soon frame, so the shape of the mode can be seen before
 * it exists.
 */
const Tower: React.FC = () => {
    const navigate = useNavigate();

    return (
        <DashboardPanel
            title="The Tower"
            description="Fifty floors. One pet. How high can you climb?"
            back={() => navigate(DASHBOARD_HOME)}
        >
            <ComingSoon note="Climb fifty floors of wardens with one pet, a chest every fifth floor, and a season board of the highest climbers.">
                <div className={styles.layout}>
                    <div className={styles.side}>
                        <div className={styles.card}>
                            <span className={styles.ring}>0%</span>
                            <div>
                                <div className={styles.big}>
                                    0<small> / 50</small>
                                </div>
                                <span className={styles.muted}>best floor this season</span>
                            </div>
                        </div>
                        <div className={styles.card}>
                            <p className={styles.muted}>
                                Your next milestone chest is on floor <b>5</b>.
                            </p>
                        </div>
                        <button type="button" className={styles.climb}>
                            Climb to floor 1
                        </button>
                    </div>

                    <div className={styles.column}>
                        <div className={styles.summit}>
                            <span className={styles.crystal} />
                            <b>Floor 50 · The Summit</b>
                            <small>Nobody has reached it yet</small>
                        </div>
                        <div className={styles.gap}>44 floors above</div>
                        {FLOORS.map((floor, i) => {
                            const step = { '--i': FLOORS.length - 1 - i } as React.CSSProperties;
                            const next = floor === 1;
                            return (
                                <React.Fragment key={floor}>
                                    <div className={styles.crenel} style={step} />
                                    <div className={clsx(styles.floor, next && styles.next)} style={step}>
                                        <span className={styles.number}>{floor}</span>
                                        <span className={styles.warden}>{next ? '🛡️' : '?'}</span>
                                        <span className={styles.info}>
                                            <b>{next ? 'Warden 1' : 'Locked'}</b>
                                            <small>{next ? 'Next · Lv 1 · a Tank' : `Clear floor ${floor - 1} first`}</small>
                                        </span>
                                        <span className={styles.reward}>{floor % 5 === 0 ? '🎁 Chest' : '+XP'}</span>
                                    </div>
                                </React.Fragment>
                            );
                        })}
                        <div className={styles.base}>The gate</div>
                    </div>

                    <div className={styles.side}>
                        <div className={styles.card}>
                            <h3 className={styles.heading}>Highest climbers</h3>
                            <p className={styles.muted}>The season board fills as players climb.</p>
                        </div>
                    </div>
                </div>
            </ComingSoon>
        </DashboardPanel>
    );
};

export default Tower;
