import { useEffect, useState } from 'react';
import { latestRoundAt, QUICKNET, roundTime } from '@cryptopets/protocol';

export type PulseRound = {
    /** The latest drand quicknet round by the local clock. */
    round: number;
    /** When the next round is due, in epoch milliseconds. */
    nextBeatAt: number;
};

const readPulse = (): PulseRound => {
    const round = latestRoundAt(QUICKNET, Math.floor(Date.now() / 1000));
    return { round, nextBeatAt: roundTime(QUICKNET, round + 1) * 1000 };
};

/**
 * "The Pulse": the drand quicknet round that battles are seeded from, ticking with the
 * network's 3-second beat so a client can show it.
 *
 * Presentation only. It reads the local clock and fetches nothing, so it says which round
 * is due, not that a beacon for it exists or verifies; battles never read it. Platform-neutral
 * on purpose, so the mobile app can show the same beat.
 */
export const usePulseRound = (): PulseRound => {
    const [pulse, setPulse] = useState(readPulse);

    useEffect(() => {
        // Scheduled for the beat itself rather than polled, plus a small margin so the read
        // lands after the boundary even with timer jitter.
        const timer = setTimeout(() => setPulse(readPulse()), Math.max(0, pulse.nextBeatAt - Date.now()) + 20);
        return () => clearTimeout(timer);
    }, [pulse]);

    return pulse;
};
