/**
 * Constants shared across the battle ledger: outbox topics and limits, and the reasons
 * `openBattle`, accept and consent refuse.
 */

/** What the message tells a worker to do next. */
export const OUTBOX_TOPICS = {
    /** Wait for the committed drand round, then verify it and derive the seed. */
    awaitBeacon: 'await-beacon',
    /** Run the fight through the canonical engine. */
    compute: 'compute',
    /** Ask the independent Go verifier to recompute the result. */
    verify: 'verify',
    /** Sign the receipt with the KMS key. */
    sign: 'sign',
    /** Publish the receipt to the public corpus. */
    publish: 'publish',
} as const;

/**
 * Publishing is the last per-battle step. Batching and anchoring (§I) deliberately have no
 * topic here: they aggregate across every publishable receipt on their own timer
 * (`startBatchAnchor`), so there is no per-battle message to send. A `batch` topic was
 * declared here for a while and never enqueued or handled, which was worse than absent —
 * `claimOutbox` only claims topics `HANDLERS` lists, so anyone who took the declaration at
 * face value would have enqueued a message no worker could ever claim, stranding the battle
 * in a non-terminal state with both pets locked and nothing to dead-letter it.
 */

/** Retries before an outbox message is dead-lettered. */
export const MAX_OUTBOX_ATTEMPTS = 8;

/** Age after which a claimed outbox message's lock is taken over. See `claimOutbox`. */
export const STALE_LOCK_MS = 5 * 60 * 1000;

/** Why `openBattle` refused. Accept maps each one onto its own refusal reason. */
export const OPEN_BATTLE_REFUSALS = {
    /** A pet already has an open battle. */
    PET_LOCKED: 'pet-locked',
    /** A pet's progress changed after its snapshot was taken. */
    PET_PROGRESS_CHANGED: 'pet-progress-changed',
    /** The originating intent already produced a battle. */
    INTENT_ALREADY_CONSUMED: 'intent-already-consumed',
} as const;

/**
 * Why accept refused a battle, as the API reports it. `accept.controller.ts` maps each one to
 * an HTTP status, and clients map each one to player-facing text, so a value is part of the
 * API and must not change.
 *
 * Consent refusals are not listed here: the backend's own are in `CONSENT_REFUSALS`, and the
 * coverage ones are `CoverageFailure` in `@cryptopets/protocol`, which owns them.
 */
export const BATTLE_REFUSALS = {
    INTENT_NOT_FOUND: 'intent-not-found',
    INTENT_ALREADY_CONSUMED: 'intent-already-consumed',
    INTENT_EXPIRED: 'intent-expired',
    ATTACKER_PET_MISSING: 'attacker-pet-missing',
    DEFENDER_PET_MISSING: 'defender-pet-missing',
    ATTACKER_NOT_READY: 'attacker-not-ready',
    DEFENDER_NOT_READY: 'defender-not-ready',
    PET_LOCKED: 'pet-locked',
    DRAND_UNAVAILABLE: 'drand-unavailable',
    SIGNER_UNAVAILABLE: 'signer-unavailable',
    /**
     * The item catalog cannot price something this battle needs priced: a pet wears an
     * item with no catalog row, or an equipment row's modifier will not parse (roadmap §4).
     *
     * Its own reason rather than a 500, because it is an operational fault with an obvious
     * remedy (run the seeder) and no fault of the player's. Refusing is the conservative
     * end: the alternative is a fight under rules this deployment cannot state, recorded in
     * a signed receipt that contradicts chain state.
     */
    ITEM_CATALOG_STALE: 'item-catalog-stale',
    /**
     * The frozen gear disagrees with what the ruleset this battle names prices it at
     * (roadmap §4, threat T13). Reachable when the catalog changes between resolving the
     * snapshot and building the ruleset, and otherwise a bug.
     *
     * Refused rather than fought, because the verifier makes the same comparison on the
     * finished receipt: accepting would produce a battle guaranteed to fail verification.
     */
    EQUIPMENT_CATALOG_MISMATCH: 'equipment-catalog-mismatch',
} as const;

/** Consent refusals the backend decides itself, rather than the protocol's coverage rule. */
export const CONSENT_REFUSALS = {
    NO_AUTHORIZATION: 'no-authorization',
    DAILY_CAP_REACHED: 'daily-cap-reached',
    REVOKED: 'revoked',
} as const;
