import { assertProtocolDomain, type ProtocolDomain } from '../domain/deployment';
import { type Hex, hexToBytes } from '../encoding/bytes';
import { latestRoundAt, resolveDrandChain, roundTime } from '../randomness/drand';
import { type AnyBattleSnapshot, assertAnyBattleSnapshot } from '../snapshot/team';

/**
 * Our signed statement, made before the dice land, of which future beacon round a
 * battle will use.
 *
 * This is the load-bearing object in the whole design. Public randomness alone
 * buys nothing: an operator who watches the beacon, dislikes the result, and then
 * claims the battle was always bound to a later round produces a perfectly
 * self-consistent lie. The fix is that the operator names the round in writing,
 * signs it, and hands it to the player *before that round exists*. A reroll then
 * requires a second signature over the same `battleId`, which either player's
 * stored copy turns into proof.
 *
 * Persisting the round in our own database is not a commitment, because the
 * database is ours. Neither is Merkle anchoring, which happens after computation.
 * Only delivery before reveal counts (§E).
 */
export interface BattleCommitment {
    domain: ProtocolDomain;
    /** Ledger id of the battle this commits to. */
    battleId: string;
    /** The wallet-signed intent that authorized it. */
    intentHash: Hex;
    /**
     * The defender's consent this battle relied on: a defence authorization's hash for a
     * duel, a defence plan's for a team battle. One field for both, because the layout only
     * carries the hash, and each kind's hash names what it is.
     */
    defenseAuthorizationHash: Hex;
    /** Every pet, frozen: a duel's two or a team battle's eight. `snapshotHash` is derived
     *  from this rather than supplied. */
    snapshot: AnyBattleSnapshot;
    rulesetVersion: number;
    rulesetHash: Hex;
    /** Which drand chain. Must be one this build pins. */
    drandChainHash: Hex;
    /** The committed round. Must not have published at `acceptedAt`. */
    drandRound: number;
    /** Unix seconds the battle was accepted and this commitment signed. */
    acceptedAt: number;
    /** Previous commitment under the same signing key, or null for the first. */
    previousCommitmentHash: Hex | null;
    /** Which signing key produced the signature over this commitment's digest. */
    signingKeyId: string;
}

/**
 * How far ahead a commitment may name its round.
 *
 * `COMMITMENT_OFFSET_ROUNDS` is what we use; this is the ceiling a *verifier*
 * enforces, with slack for clock skew between the backend and the beacon. It has
 * an upper bound at all because an unbounded one lets the operator name a round
 * hours away and sit on the battle, which is a stall rather than a reroll but is
 * still a decision nobody agreed to.
 */
export const MAX_COMMITMENT_OFFSET_ROUNDS = 10;

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** Validates an untrusted commitment, returning a normalized copy. */
export function assertBattleCommitment(commitment: BattleCommitment): BattleCommitment {
    const domain = assertProtocolDomain(commitment.domain);
    assertId(commitment.battleId, 'battleId');
    assertId(commitment.signingKeyId, 'signingKeyId');
    assertHash(commitment.intentHash, 'intentHash');
    assertHash(commitment.defenseAuthorizationHash, 'defenseAuthorizationHash');
    assertHash(commitment.rulesetHash, 'rulesetHash');
    if (commitment.previousCommitmentHash !== null) {
        assertHash(commitment.previousCommitmentHash, 'previousCommitmentHash');
    }

    const snapshot = assertAnyBattleSnapshot(commitment.snapshot);

    if (!Number.isSafeInteger(commitment.rulesetVersion) || commitment.rulesetVersion < 1) {
        throw new Error(`rulesetVersion must be a positive integer, got ${commitment.rulesetVersion}`);
    }
    if (!Number.isSafeInteger(commitment.acceptedAt) || commitment.acceptedAt < 1) {
        throw new Error(`acceptedAt must be a positive unix-seconds integer, got ${commitment.acceptedAt}`);
    }
    if (snapshot.takenAt > commitment.acceptedAt) {
        throw new Error(
            `snapshot was taken at ${snapshot.takenAt}, after acceptance at ${commitment.acceptedAt}; the photo must precede the commitment`,
        );
    }

    // Resolving the chain rather than trusting a supplied key is the difference
    // between verifying a beacon and being told about one.
    const chain = resolveDrandChain(commitment.drandChainHash);
    if (!Number.isSafeInteger(commitment.drandRound) || commitment.drandRound < 1) {
        throw new Error(`drandRound must be a positive integer, got ${commitment.drandRound}`);
    }
    assertRoundIsStillFuture(chain.chainHash, commitment);

    return {
        domain,
        battleId: commitment.battleId,
        intentHash: commitment.intentHash,
        defenseAuthorizationHash: commitment.defenseAuthorizationHash,
        snapshot,
        rulesetVersion: commitment.rulesetVersion,
        rulesetHash: commitment.rulesetHash,
        drandChainHash: chain.chainHash,
        drandRound: commitment.drandRound,
        acceptedAt: commitment.acceptedAt,
        previousCommitmentHash: commitment.previousCommitmentHash,
        signingKeyId: commitment.signingKeyId,
    };
}

/**
 * The property the design rests on, checked rather than assumed: at acceptance the
 * committed round had not published yet, and it is not so far ahead that naming it
 * is a way of stalling.
 *
 * A verifier can run this from the commitment alone, which is the point. It turns
 * "we promise we committed before the reveal" into arithmetic anyone can redo.
 */
function assertRoundIsStillFuture(chainHash: Hex, commitment: BattleCommitment): void {
    const chain = resolveDrandChain(chainHash);
    const publishedAt = roundTime(chain, commitment.drandRound);
    if (publishedAt <= commitment.acceptedAt) {
        throw new Error(
            `drand round ${commitment.drandRound} published at ${publishedAt}, at or before acceptance at ${commitment.acceptedAt}; committing to a known value is the reroll attack`,
        );
    }
    const ceiling = latestRoundAt(chain, commitment.acceptedAt) + MAX_COMMITMENT_OFFSET_ROUNDS;
    if (commitment.drandRound > ceiling) {
        throw new Error(
            `drand round ${commitment.drandRound} is more than ${MAX_COMMITMENT_OFFSET_ROUNDS} rounds past acceptance (ceiling ${ceiling})`,
        );
    }
}

function assertId(value: string, field: string): void {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
        throw new Error(`${field} is not a valid id: ${JSON.stringify(value)}`);
    }
}

function assertHash(value: Hex, field: string): void {
    if (hexToBytes(value).length !== 32) {
        throw new Error(`${field} must be a 32-byte hash`);
    }
}
