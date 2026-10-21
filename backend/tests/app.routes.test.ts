import { describe, expect, it, vi } from 'vitest';

import { asyncRoute } from '../src/middleware/asyncRoute';
import * as rateLimits from '../src/middleware/rateLimit';

/**
 * Express 4 does not await route handlers, so a raw `async` handler that rejects is an
 * unhandled rejection, which used to exit the process: one `GET /api/receipts?after=abc`
 * took the whole server down. Every async handler must go through `asyncRoute`, which
 * returns a plain function. This walks the app's routes and names any that do not.
 *
 * The rate limiters are exempt: express-rate-limit's middleware is async, but it catches
 * its own errors and passes them to `next`.
 */
const SELF_CATCHING = new Set<unknown>(Object.values(rateLimits));

interface Layer {
    name: string;
    handle: { stack?: Layer[] } & ((...args: unknown[]) => unknown);
    route?: { path: string; stack: Layer[] };
}

function rawAsyncHandlers(stack: Layer[], found: string[] = []): string[] {
    for (const layer of stack) {
        if (layer.route) {
            for (const handler of layer.route.stack) {
                if (handler.handle.constructor.name === 'AsyncFunction' && !SELF_CATCHING.has(handler.handle)) {
                    found.push(`${layer.route.path} -> ${handler.name}`);
                }
            }
        } else if (layer.name === 'router' && layer.handle.stack) {
            rawAsyncHandlers(layer.handle.stack, found);
        }
    }
    return found;
}

describe('app routes', () => {
    it('wraps every async handler in asyncRoute', async () => {
        const { default: app } = await import('../src/app');
        const stack = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
        expect(rawAsyncHandlers(stack)).toEqual([]);
    }, 30_000);
});

describe('asyncRoute', () => {
    it('passes a rejection to next instead of leaving it unhandled', async () => {
        const error = new Error('boom');
        const next = vi.fn();
        asyncRoute(async () => {
            throw error;
        })({} as never, {} as never, next);
        await vi.waitFor(() => expect(next).toHaveBeenCalledWith(error));
    });
});
