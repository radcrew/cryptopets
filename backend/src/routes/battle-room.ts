import express, { Router } from 'express';
import { asyncRoute } from '@middleware/asyncRoute';
import { verifyToken } from '@middleware/auth';
import { battleRoomRateLimit } from '@middleware/rateLimit';
import { createBattleRoom } from '@features/battle/room';

const router: Router = express.Router();

// Rate limit runs after verifyToken so the budget is per wallet, not per IP.
router.post('/', verifyToken, battleRoomRateLimit, asyncRoute(createBattleRoom));

export default router;
