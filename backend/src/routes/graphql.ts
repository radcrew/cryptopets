import express, { Router } from 'express';
import { asyncRoute } from '@middleware/asyncRoute';
import { verifyToken } from '@middleware/auth';
import { graphqlHandler } from '@graphql';

const router: Router = express.Router();

router.post('/', verifyToken, asyncRoute(graphqlHandler));

export default router;
