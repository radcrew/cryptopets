import type { IncomingMessage, ServerResponse } from 'node:http';

import { waitUntil } from '@vercel/functions';

import { env } from '@config/env';
import { prisma } from '@config/prisma';
import { isTerminal } from '@features/battle/ledger';
import { drainBattleWorker } from '@features/battle/worker';
import { BattleState } from '@generated/prisma/enums';

import app from '../app';
import { isAuthorizedCron, runCronJob } from './cron';
import { ensureBattleRuntime } from './runtime';

/**
 * The Vercel function: the Express app, plus the background work `server.ts` would start.
 *
 * A serverless instance has no timers, so battle work is driven by requests instead. After
 * a battle is accepted, and after each read of an unfinished battle's state (which a
 * client polls while it waits), the worker drains the queue. A battle's next step is seconds away, so
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

/**
 * Whether the request that just finished can have left work for the worker.
 *
 * The state read needs no login, so without this anyone could make the backend query the
 * queue, and keep a function running while it waits, by requesting made-up battle ids. A
 * failed request costs nothing more. A successful state read costs one primary-key lookup,
 * and drains only for a battle the worker still has steps for: from `published` on, the
 * batch anchor takes over, and a terminal battle has nothing left at all.
 */
export async function hasWorkerSteps(
    method: string | undefined,
    path: string,
    statusCode: number,
): Promise<boolean> {
    if (statusCode < 200 || statusCode >= 300) return false;
    // A successful accept has just queued the battle's first step.
    if (method === 'POST') return true;

    let battleId: string;
    try {
        battleId = decodeURIComponent(path.slice('/api/battle/'.length));
    } catch {
        return false;
    }
    const battle = await prisma.battleLedger.findUnique({ where: { battleId }, select: { state: true } });
    return battle !== null && !isTerminal(battle.state) && battle.state !== BattleState.published;
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
        waitUntil(
            afterResponse(res)
                .then(() => hasWorkerSteps(req.method, path, res.statusCode))
                .then((pending) => (pending ? drainOnce() : undefined))
                .catch((error: Error) => console.error(`[battle-worker] drain check failed: ${error.message}`)),
        );
    }
    app(req, res);
}
