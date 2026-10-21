import express, { Router } from 'express';
import { asyncRoute } from '@middleware/asyncRoute';
import { verifyToken } from '@middleware/auth';
import { getProfile, getUsers } from '@features/protected';

const router: Router = express.Router();

router.use(verifyToken);
router.get('/profile', asyncRoute(getProfile));
router.get('/users', asyncRoute(getUsers));

export default router;
