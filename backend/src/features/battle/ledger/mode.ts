import type { NextFunction, Request, Response } from 'express';

import { env } from '@config/env';

/**
 * Gates the backend-authoritative battle mode (§L Phase 3).
 *
 * Only the *write* paths are gated. Reads — battle state, commitments, receipts, combat
 * logs, signing keys, rulesets, and the public corpus — stay open regardless, and that
 * asymmetry is deliberate: a deployment that runs backend battles for a while and then
 * switches the mode off has still issued signed receipts, and §H's claim is that anyone can
 * check them. Retracting the evidence along with the feature would turn every past receipt
 * into an assertion nobody can verify, which is the exact failure this design exists to
 * avoid. Turning the mode off stops new battles; it does not un-publish old ones.
 *
 * 503 rather than 404: the routes exist and the client did nothing wrong, the server is
 * simply not accepting battles. A client can tell the difference and say so.
 */
export function backendBattleModeEnabled(): boolean {
    return env.battle.enabled;
}

/** Team battles need both switches: they run on the backend battle pipeline. */
export function teamBattlesEnabled(): boolean {
    return env.battle.enabled && env.battle.teamEnabled;
}

/** Gates the team write routes, as `requireBackendBattleMode` gates the duel ones. */
export function requireTeamBattles(_req: Request, res: Response, next: NextFunction): void {
    if (!teamBattlesEnabled()) {
        res.status(503).json({
            error: 'team-battles-disabled',
            detail: 'this deployment is not currently accepting team battles',
        });
        return;
    }
    next();
}

export function requireBackendBattleMode(_req: Request, res: Response, next: NextFunction): void {
    if (!backendBattleModeEnabled()) {
        res.status(503).json({
            error: 'backend-battle-mode-disabled',
            detail: 'this deployment is not currently accepting backend-authoritative battles',
        });
        return;
    }
    next();
}
