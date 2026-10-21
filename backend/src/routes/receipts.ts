import express, { Router } from 'express';

import { getReceiptInclusionProof } from '@features/battle/batcher';
import { getReceiptsByPet, getReceiptsBySequence, getReceiptsByWallet } from '@features/battle/ledger';
import { asyncRoute } from '@middleware/asyncRoute';

/**
 * The public receipt corpus (§H item 3): paginated export by pet, by wallet, and
 * by signing-key sequence range. Deliberately no `verifyToken` anywhere in this
 * file — public replay needs no special access, and gating this behind a JWT
 * would make it a corpus only account holders could use to check our work.
 */
const router: Router = express.Router();

router.get('/by-pet/:chainId/:petId', asyncRoute(getReceiptsByPet));
router.get('/by-wallet/:wallet', asyncRoute(getReceiptsByWallet));
// Declared before `/`, and specific enough not to collide with it: the Merkle proof that
// one receipt is in its anchored batch (§I).
router.get('/:receiptHash/inclusion-proof', asyncRoute(getReceiptInclusionProof));
router.get('/', asyncRoute(getReceiptsBySequence));

export default router;
