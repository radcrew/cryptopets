import type { Request, Response } from 'express';

import type { AuthenticatedRequest } from '@middleware/auth';

import { GrantSchema, UseItemSchema } from './inventory.schema';
import { claimEntitlement, grantItem, useItem, type WriteFailure } from './inventory.write';

/**
 * HTTP surface for the inventory writes (roadmap §4).
 *
 * Every route is JWT-gated at the router, and the acting wallet is always the session,
 * never a request field. The one exception is the admin grant's recipient, which is an
 * argument because granting to yourself is not what that route is for.
 *
 * Reads are not here. They are GraphQL fields, matching how this repo serves data reads,
 * while REST carries the actions.
 */

/** Every named failure the write layer can return, mapped once. */
const FAILURES: Record<WriteFailure, { status: number; error: string }> = {
    'writes-disabled': { status: 503, error: 'Item writes are not configured on this deployment' },
    'unknown-item': { status: 404, error: 'No such item' },
    'not-consumable': { status: 400, error: 'That item is not something a pet can use' },
    'not-held': { status: 400, error: 'You do not hold that item' },
    'not-pet-owner': { status: 403, error: 'That pet is not yours' },
    'unknown-pet': { status: 404, error: 'No such pet' },
    'unsupported-chain': { status: 400, error: 'This deployment does not serve that chain' },
    'no-progress-row': { status: 409, error: 'That pet has no progression record yet' },
    // 404, not 403: an entitlement belonging to someone else is indistinguishable from one
    // that does not exist, so an id cannot be probed by watching the status change.
    'unknown-entitlement': { status: 404, error: 'No such entitlement' },
    'already-claimed': { status: 409, error: 'That entitlement has already been claimed' },
    'not-admin': { status: 403, error: 'Not permitted' },
    'pet-in-battle': { status: 409, error: 'That pet is in a battle right now. Use the item once the battle ends.' },
};

function isFailure(value: unknown): value is WriteFailure {
    return typeof value === 'string' && value in FAILURES;
}

function respond(res: Response, failure: WriteFailure): void {
    const { status, error } = FAILURES[failure];
    res.status(status).json({ error });
}

function callerOf(req: Request): string | undefined {
    return (req as AuthenticatedRequest).user?.address;
}

/** POST /api/inventory/use — spend one consumable on one of the caller's pets. */
export async function postUseItem(req: Request, res: Response): Promise<void> {
    const caller = callerOf(req);
    if (!caller) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }

    const body = UseItemSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'Invalid request' });
        return;
    }

    try {
        const result = await useItem(body.data.chain, caller, body.data.petId, body.data.itemType);
        if (isFailure(result)) {
            respond(res, result);
            return;
        }
        res.json(result);
    } catch (err) {
        // The burn may already have landed here; the write layer logs that case with
        // everything needed to make it right, so this only has to avoid claiming success.
        console.error('[inventory] failed to use item:', err);
        res.status(500).json({ error: 'Failed to use item' });
    }
}

/** POST /api/inventory/entitlements/:id/claim — mint an item the caller has earned. */
export async function postClaim(req: Request, res: Response): Promise<void> {
    const caller = callerOf(req);
    if (!caller) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }

    const entitlementId = req.params.id ?? '';
    if (!entitlementId) {
        res.status(400).json({ error: 'Invalid entitlement' });
        return;
    }

    try {
        const result = await claimEntitlement(caller, entitlementId);
        if (isFailure(result)) {
            respond(res, result);
            return;
        }
        res.json(result);
    } catch (err) {
        console.error('[inventory] failed to claim entitlement:', err);
        res.status(500).json({ error: 'Failed to claim entitlement' });
    }
}

/** POST /api/inventory/admin/grant — create an entitlement for any wallet. */
export async function postGrant(req: Request, res: Response): Promise<void> {
    const caller = callerOf(req);
    if (!caller) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }

    const body = GrantSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'Invalid request' });
        return;
    }

    try {
        const result = await grantItem(
            caller,
            body.data.chain,
            body.data.owner,
            body.data.itemType,
            body.data.quantity,
        );
        if (isFailure(result)) {
            respond(res, result);
            return;
        }
        res.status(201).json(result);
    } catch (err) {
        console.error('[inventory] failed to grant item:', err);
        res.status(500).json({ error: 'Failed to grant item' });
    }
}
