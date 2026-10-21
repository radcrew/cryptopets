import { prisma } from '@config/prisma';

/**
 * Single-use nonce store for wallet auth challenges.
 *
 * `GET /nonce` issues a nonce; `POST /verify` consumes it. A nonce is only
 * accepted once and only within its TTL, so a captured signature cannot be
 * replayed — the message it signs embeds a nonce that no longer exists.
 *
 * In the database, not in memory: on a serverless host the two requests rarely
 * reach the same process, so a nonce held by one instance would be unknown to
 * the instance that verifies it.
 */

const NONCE_TTL_MS = 5 * 60 * 1000;

/** Record a freshly issued nonce so `consumeNonce` can accept it later. */
export async function storeNonce(nonce: string): Promise<void> {
    const now = Date.now();
    // Lazy eviction on each issue so abandoned nonces don't accumulate.
    await prisma.authNonce.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
    await prisma.authNonce.create({ data: { nonce, expiresAt: new Date(now + NONCE_TTL_MS) } });
}

/**
 * Single-use take: true only if the nonce was issued by us and is still fresh.
 * The delete is the claim: of two concurrent attempts, only one deletes the row,
 * so a nonce can never be presented twice. An expired row is left for the sweep
 * in `storeNonce`; it can no longer be used either way.
 */
export async function consumeNonce(nonce: string): Promise<boolean> {
    const { count } = await prisma.authNonce.deleteMany({
        where: { nonce, expiresAt: { gt: new Date() } },
    });
    return count === 1;
}
