import express, { Router } from 'express';
import { asyncRoute } from '@middleware/asyncRoute';
import { verifyToken } from '@middleware/auth';
import { chatReadRateLimit, chatSendRateLimit } from '@middleware/rateLimit';
import { getMessages, getThreads, postMessage, postReaction, postRead } from '@features/chat';

const router: Router = express.Router();

// Rate limits run after verifyToken so the budget is per wallet, not per IP. Sending is
// held to a much tighter budget than reading: a read is one indexed query, while a send
// is the one endpoint in this feature that creates content someone else has to receive.
router.get('/threads', verifyToken, chatReadRateLimit, asyncRoute(getThreads));
router.get('/threads/:id/messages', verifyToken, chatReadRateLimit, asyncRoute(getMessages));
router.post('/threads/:id/messages', verifyToken, chatSendRateLimit, asyncRoute(postMessage));
// Rate-limited as a read: it is one small write per thread open, not per message, and it
// rides the same polling cadence the read endpoint already allows for.
router.post('/threads/:id/read', verifyToken, chatReadRateLimit, asyncRoute(postRead));
// Held to the send budget, not the read one: a reaction writes a row other people see,
// which is the same thing a message does, only smaller.
router.post(
    '/threads/:id/messages/:messageId/reaction',
    verifyToken,
    chatSendRateLimit,
    asyncRoute(postReaction)
);

export default router;
