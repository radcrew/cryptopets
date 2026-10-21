import type { IncomingMessage, ServerResponse } from 'node:http';

import { waitUntil } from '@vercel/functions';

import { env } from '@config/env';
import { drainBattleWorker } from '@features/battle/worker';

import app from '../app';
import { isAuthorizedCron, runCronJob } from './cron';
import { ensureBattleRuntime } from './runtime';

/**
 * The Vercel function: the Express app, plus the background work `server.ts` would start.
 *
 * A serverless instance has no timers, so battle work is driven by requests instead. After
 * a battle is accepted, and after each read of a battle's state (which a client polls
 * while it waits), the worker drains the queue. A battle's next step is seconds away, so
 * this moves a battle forward as fast as the long-running worker does, and faster than
 * its two-second timer.
 *
 * Bundled by scripts/bundle-vercel.cjs and loaded by api/index.js. Render still runs
 * server.ts, so nothing here changes the long-running deployment.
 */

/** Paths after which the battle queue may have new work. */
const ACCEPT_PATH = /^\/api\/battle\/intents\/[^/]+\/accept$/;
const STATE_PATH = /^\/api\/battle\/(?!config$|signing-keys$|rulesets$)[^/]+$/;

/** Leaves room under the function's 60 s maxDuration (backend/vercel.json). */
const DRAIN_BUDGET_MS = 45_000;

export function shouldDrainAfter(method: string | undefined, path: string): boolean {
    if (!env.battle.enabled) return false;
    return (method === 'POST' && ACCEPT_PATH.test(path)) || (method === 'GET' && STATE_PATH.test(path));
}

/** One drain per instance at a time: a second request would only wait on the same queue. */
let draining: Promise<unknown> | undefined;

function drainOnce(): Promise<unknown> {
    draining ??= drainBattleWorker(`vercel-${process.pid}`, { budgetMs: DRAIN_BUDGET_MS })
        .catch((error: Error) => console.error(`[battle-worker] drain failed: ${error.message}`))
        .finally(() => {
            draining = undefined;
        });
    return draining;
}

/** Resolves once the response is sent, so the request's own writes are committed first. */
function afterResponse(res: ServerResponse): Promise<void> {
    return new Promise((resolve) => {
        if (res.writableFinished) resolve();
        else res.once('finish', () => resolve());
    });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await ensureBattleRuntime();
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (path.startsWith('/api/cron/')) {
        if (!isAuthorizedCron(req.headers.authorization, process.env.CRON_SECRET)) {
            res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        const result = await runCronJob(path);
        res.writeHead(result ? 200 : 404, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result ?? { error: 'Not found' }));
        return;
    }

    if (shouldDrainAfter(req.method, path)) {
        waitUntil(afterResponse(res).then(drainOnce));
    }
    app(req, res);
}
