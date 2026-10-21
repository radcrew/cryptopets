import express, { Router } from 'express';

import {
    deleteDefenseAuthorizations,
    getDefenseAuthorizations,
    getBattleCombatLog,
    getBattleCommitment,
    getBattleConfigHandler,
    getBattleReceipt,
    getBattleStateHandler,
    getRulesetByHash,
    getRulesets,
    getSigningKeys,
    postAcceptBattle,
    postBattleIntent,
    deleteSessionDelegations,
    postDefenseAuthorization,
    postSessionDelegation,
    postVerifyReceipt,
    requireBackendBattleMode,
} from '@features/battle/ledger';
import { asyncRoute } from '@middleware/asyncRoute';
import { verifyToken } from '@middleware/auth';
import { battleRoomRateLimit } from '@middleware/rateLimit';

const router: Router = express.Router();

// The JWT identifies the caller; the wallet signature inside the body is what authorizes
// the battle (§D). Rate limiting runs after verifyToken so the budget is per wallet rather
// than per IP, which is what makes it a per-wallet submission limit (threat T5).
// Every write below is gated on backend battle mode (§L Phase 3). The reads further down
// deliberately are not: receipts already issued stay checkable after the mode is switched
// off, or turning the feature off would retract evidence §H promises stays public.
router.post('/intents', requireBackendBattleMode, verifyToken, battleRoomRateLimit, asyncRoute(postBattleIntent));

// The commit-before-reveal moment (§E): the round is chosen and the commitment signed here,
// synchronously, and handed back in this same response.
router.post('/intents/:intentHash/accept', requireBackendBattleMode, verifyToken, battleRoomRateLimit, asyncRoute(async (req, res) => {
    req.body = { ...req.body, intentHash: req.params.intentHash };
    return postAcceptBattle(req, res);
}));

// Standing defence consent. Submission is signed by the defender's wallet; revocation needs
// only the JWT, because refusing battles is never the dangerous direction.
router.post('/authorizations', requireBackendBattleMode, verifyToken, battleRoomRateLimit, asyncRoute(postDefenseAuthorization));
// Revocation is not gated: withdrawing consent must keep working even after the mode is
// switched off, since refusing battles is never the dangerous direction.
router.delete('/authorizations', verifyToken, asyncRoute(deleteDefenseAuthorizations));
// Reading is ungated for the same reason. A defender needs to see that their consent went
// stale precisely when something is off, and a mode flag should not be what hides it.
// Scoped to the authenticated wallet in the controller, never to a queried address.
router.get('/authorizations', verifyToken, asyncRoute(getDefenseAuthorizations));

// Delegated battle-intent signing (§D). The owner approves a client-held key once and that
// key signs intents, so the wallet prompt stops being per battle. Gated on backend mode
// like the other writes; revocation is not, for the same reason consent revocation is not:
// withdrawing authority must keep working whatever else is switched off.
router.post('/sessions', requireBackendBattleMode, verifyToken, battleRoomRateLimit, asyncRoute(postSessionDelegation));
router.delete('/sessions', verifyToken, asyncRoute(deleteSessionDelegations));

// Authoritative, re-fetchable reads (§J). No auth: every value here is either already
// public on chain or is itself a signed artifact anyone is meant to check, so gating
// these behind a JWT would stop a spectator with a room link from doing the one thing
// this design exists to let them do.
// Declared before `/:battleId`, or that route would happily match "config" as a battle id.
// Same reason the other fixed paths below sit above it.
router.get('/config', asyncRoute(getBattleConfigHandler));
router.get('/signing-keys', getSigningKeys);
router.get('/rulesets', asyncRoute(getRulesets));
router.get('/rulesets/:rulesetHash', asyncRoute(getRulesetByHash));
router.post('/verify-receipt', asyncRoute(postVerifyReceipt));
router.get('/:battleId', asyncRoute(getBattleStateHandler));
router.get('/:battleId/commitment', asyncRoute(getBattleCommitment));
router.get('/:battleId/receipt', asyncRoute(getBattleReceipt));
router.get('/:battleId/combat-log', asyncRoute(getBattleCombatLog));

export default router;
