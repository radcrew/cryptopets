/**
 * Constants shared across the battle ledger: outbox topics and limits, and the reasons
 * `openBattle` refuses.
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
    petLocked: 'pet-locked',
    /** A pet's progress changed after its snapshot was taken. */
    petProgressChanged: 'pet-progress-changed',
    /** The originating intent already produced a battle. */
    intentAlreadyConsumed: 'intent-already-consumed',
} as const;
