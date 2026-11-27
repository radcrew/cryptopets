import React, { useEffect, useState } from 'react';
import { getXpNumbers, getXpPercent, usePetList, type Pet } from '@shared/core';

import styles from './index.module.css';

/**
 * The trained pet's XP bar, filling from where it stood before training to where the
 * refreshed pet list says it is now. Until that refresh lands it waits at the old value,
 * so it never shows XP the chain has not reported. Training can carry a pet over a level,
 * in which case the bar fills and says so.
 */
const XpGain: React.FC<{ before: Pet }> = ({ before }) => {
    const { pets } = usePetList();
    const now = pets.find((p) => p.id === before.id) ?? before;
    const leveled = now.level > before.level;
    const target = leveled ? 100 : getXpPercent(now);
    const [width, setWidth] = useState(() => getXpPercent(before));

    useEffect(() => {
        const timer = setTimeout(() => setWidth(target), 250);
        return () => clearTimeout(timer);
    }, [target]);

    const { xpCurrent, xpMax } = getXpNumbers(now);

    return (
        <div className={styles.xpGain}>
            <div className={styles.xpGainTrack}>
                <span className={styles.xpGainFill} style={{ width: `${width}%` }} />
            </div>
            <span className={styles.xpGainText}>
                {leveled
                    ? `Level up! Now level ${now.level}`
                    : now === before
                      ? 'Counting the XP…'
                      : `XP ${xpCurrent} / ${xpMax}`}
            </span>
        </div>
    );
};

export default XpGain;
