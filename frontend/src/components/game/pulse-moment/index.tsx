import React, { useEffect } from 'react';
import { usePulseRound } from '@shared/core';

import PulseOrb from '@components/game/pulse-orb';
import { useSound } from '@contexts/sound';
import styles from './index.module.css';

/**
 * What a fight shows while it waits for its committed drand round: the Pulse, beating.
 *
 * It names the live beat rather than the battle's own round, because the client is never told
 * which round was committed; the committed one is a beat or two ahead, so it is always close.
 * A heartbeat sounds on every beat, the one moment in a fight where silence would feel broken.
 */
const PulseMoment: React.FC = () => {
    const { round } = usePulseRound();
    const { play } = useSound();

    useEffect(() => {
        play('heartbeat');
    }, [round, play]);

    return (
        <div className={styles.moment}>
            <div className={styles.orb}>
                <PulseOrb />
            </div>
            <p className={styles.title}>The Pulse decides this fight</p>
            <p className={styles.sub}>Nobody can know the beat before it lands, not even us.</p>
        </div>
    );
};

export default PulseMoment;
