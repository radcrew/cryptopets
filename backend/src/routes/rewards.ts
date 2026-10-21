import express, { Router } from 'express';

import { getSeason, getSeasonClaim } from '@features/battle/rewards';
import { asyncRoute } from '@middleware/asyncRoute';

/**
 * Reward seasons and claim proofs (§I).
 *
 * No `verifyToken` anywhere here, matching the receipt corpus. A claim proof only ever pays
 * the wallet bound inside its leaf, so publishing one lets a third party sponsor someone's
 * gas rather than take their reward — and the season metadata is what makes the arithmetic
 * checkable by anyone at all.
 *
 * Deliberately read-only. Building a season and opening it on chain are operator actions
 * with real money attached; they belong behind an owner key and a deliberate command, not
 * an HTTP route that could be reached by anything holding a token.
 */
const router: Router = express.Router();

router.get('/seasons/:seasonId', asyncRoute(getSeason));
router.get('/seasons/:seasonId/claim/:wallet', asyncRoute(getSeasonClaim));

export default router;
