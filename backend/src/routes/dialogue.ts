import express, { Router } from 'express';
import { asyncRoute } from '@middleware/asyncRoute';
import { verifyToken } from '@middleware/auth';
import { dialogueRateLimit } from '@middleware/rateLimit';
import { resolveBattleDialogue, streamBattleTaunts } from '@features/dialogue';

const router: Router = express.Router();

// Rate limit runs after verifyToken so the budget is per wallet, not per IP.
router.post('/taunts/stream', verifyToken, dialogueRateLimit, asyncRoute(streamBattleTaunts));
router.post('/result', verifyToken, dialogueRateLimit, asyncRoute(resolveBattleDialogue));

export default router;
