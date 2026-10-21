import { timingSafeEqual } from 'node:crypto';

import { env } from '@config/env';
import { createAnchorContext, runOnce } from '@features/battle/anchor';
import { drainBattleWorker } from '@features/battle/worker';

/**
 * Scheduled jobs for a serverless deployment, replacing the timers `server.ts` starts.
 * Vercel Cron calls these paths with `Authorization: Bearer $CRON_SECRET` (see
 * backend/vercel.json). They are backups: battles are driven by requests (see
 * handler.ts), so a battle never waits for a schedule.
 */
export const CRON_PATHS = {
    battleWorker: '/api/cron/battle-worker',
    battleAnchor: '/api/cron/battle-anchor',
} as const;

/** True only for a request carrying the configured secret. No secret refuses everything. */
export function isAuthorizedCron(authorization: string | undefined, secret: string | undefined): boolean {
    if (!secret) return false;
    const given = Buffer.from(authorization ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Runs one job. Returns null for a path that is not a job. */
export async function runCronJob(path: string): Promise<Record<string, unknown> | null> {
    if (path === CRON_PATHS.battleWorker) {
        if (!env.battle.enabled) return { skipped: 'battle mode off' };
        return drainBattleWorker(`vercel-cron-${process.pid}`, { budgetMs: 50_000 });
    }
    if (path === CRON_PATHS.battleAnchor) {
        const context = createAnchorContext();
        if (!context) return { skipped: 'anchoring not configured' };
        await runOnce(context);
        return { ran: true };
    }
    return null;
}
