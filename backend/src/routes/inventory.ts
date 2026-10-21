import express, { Router } from 'express';

import { postClaim, postGrant, postUseItem } from '@features/inventory';
import { asyncRoute } from '@middleware/asyncRoute';
import { verifyToken } from '@middleware/auth';
import { inventoryWriteRateLimit } from '@middleware/rateLimit';

const router: Router = express.Router();

// Writes only. Inventory reads are GraphQL fields, matching how this repo serves data
// reads, so nothing here duplicates a query.
//
// Rate limits run after verifyToken so the budget is per wallet rather than per IP, as in
// the chat routes. There is no read/write split to make: every route below sends a
// transaction from the backend's own wallet, so they all belong to the tighter budget.
router.post('/use', verifyToken, inventoryWriteRateLimit, asyncRoute(postUseItem));
router.post('/entitlements/:id/claim', verifyToken, inventoryWriteRateLimit, asyncRoute(postClaim));

// Authorization is the allowlist inside the handler, not a separate middleware. Keeping it
// in the write layer means the rule holds for any future caller of grantItem, rather than
// only for requests that happen to arrive through this line.
router.post('/admin/grant', verifyToken, inventoryWriteRateLimit, asyncRoute(postGrant));

export default router;
