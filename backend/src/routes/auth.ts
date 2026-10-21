import express, { Router } from 'express';
import { asyncRoute } from '@middleware/asyncRoute';
import { authRateLimit } from '@middleware/rateLimit';
import { getNonce, verify } from '@features/auth';

const router: Router = express.Router();

router.use(authRateLimit);
router.get('/nonce', getNonce);
router.post('/verify', asyncRoute(verify));

export default router;
