/**
 * Domain tags. Every canonical encoding in this protocol starts with exactly one
 * of these, so a digest can only ever be read as the kind of object it was
 * written as.
 *
 * Without a tag, two different objects that happen to encode to the same bytes
 * share a hash, and a signature over one becomes a signature over the other. A
 * receipt whose fields line up with a commitment's is the cheap version of that
 * attack; the tag makes it structurally impossible rather than unlikely.
 *
 * Rules:
 *
 * - Tags are frozen. Changing a tag's text changes every digest under it, which
 *   invalidates historical signatures. Add a new `_V2` tag instead.
 * - Tags are unique across the protocol. `tests/encoding/domain.test.ts`
 *   enforces this, because a duplicate silently reintroduces the confusion the
 *   tags exist to prevent.
 * - A tag is claimed by the object that uses it. Entries for objects that do not
 *   exist yet are declared here anyway, so the uniqueness check covers the whole
 *   protocol rather than only the parts already built.
 */
export const DOMAIN_TAGS = {
    /** Battle seed derivation (architecture §E). Fixed by that specification. */
    SEED: 'CRYPTOPETS_BATTLE_V1',
    /** Wallet-signed battle intent (§D). */
    INTENT: 'CRYPTOPETS_INTENT_V1',
    /** Standing defence authorization (§D). */
    DEFENSE_AUTHORIZATION: 'CRYPTOPETS_DEFENSE_AUTH_V1',
    /** A team battle's defence plan: roster, ranks, tiles, tactics, and consent (§F). */
    DEFENSE_PLAN: 'CRYPTOPETS_DEFENSE_PLAN_V1',
    /** Wallet-signed delegation of battle-intent signing to a client-held key (§D). */
    SESSION_DELEGATION: 'CRYPTOPETS_SESSION_V1',
    /** Frozen pet snapshot pair (§C, §F). */
    SNAPSHOT: 'CRYPTOPETS_SNAPSHOT_V1',
    /** Ruleset identity: combat rules plus balance configuration (§F). */
    RULESET: 'CRYPTOPETS_RULESET_V1',
    /** Pre-reveal randomness commitment (§E). */
    COMMITMENT: 'CRYPTOPETS_COMMITMENT_V1',
    /** Signed battle receipt (§G). */
    RECEIPT: 'CRYPTOPETS_RECEIPT_V1',
    /** Per-strike combat log (§G `combatLogHash`). */
    COMBAT_LOG: 'CRYPTOPETS_COMBAT_LOG_V1',
    /** Merkle leaf over a receipt (§I). */
    MERKLE_LEAF: 'CRYPTOPETS_MERKLE_LEAF_V1',
    /** Merkle internal node (§I). Distinct from the leaf tag, so a leaf digest can
     *  never be presented as an internal node in a proof. */
    MERKLE_NODE: 'CRYPTOPETS_MERKLE_NODE_V1',
    /** Merkle leaf over a season reward entitlement (§I). Its own tag rather than an
     *  extension of `MERKLE_LEAF`, so a receipt leaf can never be presented as a claim
     *  on a reward, or the reverse. */
    MERKLE_REWARD_LEAF: 'CRYPTOPETS_MERKLE_REWARD_LEAF_V1',
    /** Drawing a team battle's three defenders from a five-pet roster (§F, team battles). Its
     *  own tag so a draw roll can never coincide with a combat roll from the same seed. */
    SQUAD_DRAW: 'CRYPTOPETS_SQUAD_DRAW_V1',
} as const;

/** One of the protocol's domain tags. */
export type DomainTag = (typeof DOMAIN_TAGS)[keyof typeof DOMAIN_TAGS];
