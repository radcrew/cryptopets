/**
 * Turns a battle submit/accept rejection into something a player can act on.
 *
 * The backend already answers with a precise reason (`no-authorization`,
 * `attacker-level-below-band`, …) and the right status code. Without this the whole
 * payload is buried inside an Axios error, every failure looks identical on screen,
 * and the only way to tell "this opponent has not allowed challenges" from "your pet
 * is on cooldown" is to read the server's database.
 *
 * Reasons come from `intent.controller.ts` and `accept.controller.ts`. An unmapped
 * code falls through to its own text rather than a generic message, so a reason added
 * server-side degrades to something still diagnosable instead of disappearing.
 */

/**
 * Exported so the backend can assert it covers every reason the two battle controllers can
 * actually return (`tests/features/battle/ledger/rejectionMessages.test.ts`). The reason
 * lists live there and are the authority; this is the text for them. Nine were missing
 * when that check was first written, and one was actively wrong.
 */
export const MESSAGES: Record<string, string> = {
    // Submitting the intent.
    'malformed-intent': 'That battle request was malformed. Try again.',
    'wrong-deployment': 'This app is pointed at a different deployment than the server. Reload the page.',
    'wallet-mismatch': 'The signing wallet does not match the one you are signed in with.',
    'wrong-signature-format': 'That signature format was not recognised.',
    'bad-signature': 'The signature could not be verified. Try again.',
    // The one refusal here a player clears themselves, in a single prompt: the battle
    // session lapsed or was revoked. Worth its own text rather than the fallback slug,
    // since "approve again" is the whole remedy and nothing else on this list is that
    // easy to fix.
    'session-not-authorized': 'Your battle session has expired. Approve battles again to continue.',
    'unknown-pet': 'One of those pets is not on record yet.',
    'not-pet-owner': 'You can only attack with a pet you own.',
    'self-battle': 'A pet cannot battle itself.',
    'same-owner': 'You cannot battle two of your own pets.',
    'nonce-already-used': 'That battle request was already used. Try again.',
    'duplicate-intent': 'That battle request was already submitted.',

    // Accepting it.
    'intent-not-found': 'That battle request is no longer on record. Try again.',
    'intent-already-consumed': 'That battle has already started.',
    'intent-expired': 'That battle request expired. Try again.',
    'attacker-pet-missing': 'Your pet is not on record yet. It may still be syncing from the chain.',
    'defender-pet-missing': 'That opponent is not on record yet.',
    'attacker-not-ready': 'Your pet is still on cooldown.',
    'defender-not-ready': 'That opponent is still on cooldown.',
    'pet-locked': 'One of these pets is already in a battle.',

    // Consent (§D). These describe the *defender's* authorization, not the request —
    // see the note on `expired` below.
    'not-yet-valid': 'This opponent is not accepting challenges yet.',
    // The authorization's own `expiresAt`, not the battle request's. This used to read
    // "That battle request expired. Try again.", which blamed the player for the
    // opponent's lapsed consent and sent them to retry a thing that cannot succeed until
    // the defender re-grants. The request expiring is `intent-expired`, above.
    expired: "This opponent's permission to be challenged has expired. They need to allow challenges again.",
    'no-authorization': "This opponent's owner has not allowed challenges yet.",
    'pet-not-covered': "That pet is not covered by its owner's challenge settings.",
    'attacker-level-below-band': 'Your pet is too low level for this opponent.',
    'attacker-level-above-band': 'Your pet is too high level for this opponent.',
    'ruleset-mismatch': "This opponent's consent was signed under older rules. They need to re-allow challenges.",
    revoked: 'This opponent has withdrawn consent to be challenged.',
    'daily-cap-reached': 'This opponent has hit their battle limit for today.',

    // Operational. The player did nothing wrong and retrying is the whole remedy, so say
    // that rather than leaving them to read `Battle refused: drand-unavailable`.
    'drand-unavailable': 'The randomness beacon is unreachable right now. Try again in a moment.',
    'signer-unavailable': 'The battle service is temporarily unavailable. Try again in a moment.',
    'item-catalog-stale': 'The item catalog on this deployment is out of date, so this battle cannot be priced. This one needs an operator.',
    'equipment-catalog-mismatch': 'The item catalog changed while this battle was being set up. Try again.',
};

/** Shape of the error body both battle controllers return. */
interface RejectionBody {
    error?: unknown;
    detail?: unknown;
}

function rejectionCode(err: unknown): string | null {
    if (typeof err !== 'object' || err === null) return null;
    const response = (err as { response?: { data?: RejectionBody } }).response;
    const code = response?.data?.error;
    return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * A refusal the server explained, as opposed to a chain or network failure.
 *
 * Tagged rather than a bare Error because the EVM adapter's `parseError` rewrites any
 * message it does not recognise into a generic "Transaction failed", which would throw
 * away the reason. UIs test for this and show `message` directly.
 */
export class BattleRejectionError extends Error {
    readonly isBattleRejection = true as const;
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'BattleRejectionError';
        this.code = code;
    }
}

/** Structural guard — survives duplicate module instances, unlike `instanceof`. */
export function isBattleRejection(err: unknown): err is BattleRejectionError {
    return (
        typeof err === 'object' &&
        err !== null &&
        (err as { isBattleRejection?: unknown }).isBattleRejection === true
    );
}

/**
 * Converts a failed battle request into an explained rejection, or `null` when the
 * failure is not a server refusal (a dropped connection, a wallet the user closed)
 * and the caller's own fallback is the better text.
 */
export function toBattleRejection(err: unknown): BattleRejectionError | null {
    const code = rejectionCode(err);
    if (!code) return null;
    return new BattleRejectionError(code, MESSAGES[code] ?? `Battle refused: ${code}`);
}

/**
 * True when the refusal means this opponent should not have been offered at all.
 *
 * This is deliberately the same set of conditions matchmaking's `hasConsent` predicate
 * filters on (`roster.repository.ts`): a live, unrevoked, in-window authorization under
 * the current ruleset hash, covering this pet. Callers use it to drop the opponent and
 * re-read the list, so any mismatch between the two sets is a bug in one direction or
 * the other — a code listed here that matchmaking does not filter drops opponents who
 * were fine, and one missing leaves the player re-picking the single choice that cannot
 * succeed. Three of these six were missing, which is how a lapsed authorization kept its
 * owner in the list.
 *
 * Level band and daily cap are excluded here because matchmaking excludes them too, and
 * for the same reason: they are about this attacker, or about today, not about whether
 * the opponent is challengeable at all.
 */
export function isConsentFailure(err: unknown): boolean {
    const code = isBattleRejection(err) ? err.code : rejectionCode(err);
    return (
        code === 'no-authorization' ||
        code === 'pet-not-covered' ||
        code === 'revoked' ||
        code === 'expired' ||
        code === 'not-yet-valid' ||
        code === 'ruleset-mismatch'
    );
}
