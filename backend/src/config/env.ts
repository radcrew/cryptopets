import 'dotenv/config';

/**
 * Centralized, validated environment access. Importing this module loads `.env`
 * (via `dotenv/config`) as a side effect, so it must be the first thing any
 * entrypoint pulls in. Every other module reads config from `env` rather than
 * touching `process.env` directly — one source of truth.
 */

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set. Copy env.example to .env and configure it.`);
    }
    return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const parsedPort = Number(process.env.PORT);
export const env = {
    nodeEnv,
    isProduction,
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3001,

    /**
     * JWT signing secret. Required in production (anyone knowing the secret can
     * mint valid tokens); falls back to a dev-only value otherwise.
     */
    jwtSecret: isProduction ? requireEnv('JWT_SECRET') : process.env.JWT_SECRET || 'dev-only-secret',

    /** PostgreSQL connection string (required — Prisma cannot run without it). */
    databaseUrl: requireEnv('DATABASE_URL'),

    /** Comma-separated allowed CORS origins; unset = allow all (local dev). */
    corsOrigin: process.env.CORS_ORIGIN,

    /**
     * AI battle dialogue (see AI_BATTLE_DIALOGUE.md), via the Hugging Face
     * OpenAI-compatible chat router (Vercel AI SDK). Optional: when `apiToken`
     * is unset the feature degrades to templated fallback lines, so the app runs
     * fine without a token in local dev.
     */
    hf: {
        apiToken: process.env.HF_API_TOKEN?.trim() || undefined,
        /** Any chat-completion model on HF inference. Verify availability/tier. */
        model: process.env.HF_MODEL?.trim() || 'meta-llama/Llama-3.1-8B-Instruct',
        /** Base URL for the OpenAI-compatible inference endpoint (no /chat/completions suffix). */
        baseUrl: process.env.HF_API_URL?.trim().replace(/\/chat\/completions$/, '') || 'https://router.huggingface.co/v1',
        /**
         * Output token cap for each request. Some providers count this cap, not the tokens
         * actually produced, against a per-minute limit, and reject a request whose cap is
         * over it: Groq's free tier allows 1000 output tokens a minute for some models.
         */
        maxOutputTokens: Number(process.env.HF_MAX_OUTPUT_TOKENS?.trim()) || 1024,
    },

    /**
     * Optional Redis for the battle-dialogue pregen store. Unset = in-process Map
     * (fine single-instance). Set it to survive restarts / scale to multiple
     * instances — also run `pnpm add ioredis`, which is imported only when set.
     */
    redis: {
        url: process.env.REDIS_URL?.trim() || undefined,
    },

    /**
     * indexer-go gRPC link (pet-state reads and win estimates). Optional: unset = those
     * fall back to Postgres and to "odds unavailable" respectively.
     *
     * No longer carries battles. `StreamLiveBattles` pushed chain-truth settle events,
     * which stopped existing with on-chain battles (§L Phase 6); the backend's own signed
     * receipt is the record now, and the RPC is gone from the proto contract.
     */
    indexerGrpc: {
        /** e.g. localhost:50051. */
        addr: process.env.INDEXER_GRPC_ADDR?.trim() || undefined,
        /** Path to the shared proto contract (auto-resolved from repo root or backend cwd). */
        protoPath: process.env.INDEXER_PROTO_PATH?.trim() || undefined,
    },

    /**
     * Where roster reads are answered: 'grpc' = indexer-go's RAM cache with automatic
     * Prisma fallback; 'postgres' (default) = Prisma only. The instant kill switch for the
     * milestone 8 read path — flip back without redeploying indexer-go.
     *
     * No longer covers matchmaking. `findReadyOpponents` filters and bands on merged
     * backend progression, which the cache has no view of, so it always reads Postgres
     * regardless of this setting. Pet-detail reads still honour it.
     */
    rosterReadSource:
        process.env.ROSTER_READ_SOURCE?.trim().toLowerCase() === 'grpc' ? 'grpc' : 'postgres',

    /**
     * Settle keeper: settles GameLogic breed/mint requests from this wallet once Pyth Entropy
     * reveals, so the player doesn't send the settle transaction themselves. Off unless
     * KEEPER_ENABLED=true; the four fields below are required once it is (checked at
     * startSettleKeeper() time so a misconfigured keeper logs and no-ops rather than
     * crashing the whole server on boot).
     */
    settleKeeper: {
        enabled: process.env.KEEPER_ENABLED?.trim().toLowerCase() === 'true',
        rpcUrl: process.env.KEEPER_RPC_URL?.trim() || undefined,
        privateKey: (process.env.KEEPER_PRIVATE_KEY?.trim()
            ? (process.env.KEEPER_PRIVATE_KEY.trim().startsWith('0x')
                ? process.env.KEEPER_PRIVATE_KEY.trim()
                : `0x${process.env.KEEPER_PRIVATE_KEY.trim()}`)
            : undefined) as `0x${string}` | undefined,
        chainId: process.env.KEEPER_CHAIN_ID ? Number(process.env.KEEPER_CHAIN_ID) : undefined,
        gameLogicAddress: process.env.KEEPER_GAME_LOGIC_ADDRESS?.trim() as `0x${string}` | undefined,
        backfillBlocks: BigInt(process.env.KEEPER_BACKFILL_BLOCKS?.trim() || '5000'),
        /** Local dev only: also acts as the Entropy provider (MockEntropy.mockReveal),
         *  replacing the old removed vrf-fulfill-watcher.ts for the entropy flow. Refuse
         *  to enable unless the keeper is also targeting a low chain id typical of a
         *  local Hardhat node, so this can't accidentally get flipped on against a real
         *  network. */
        mockReveal:
            process.env.KEEPER_MOCK_REVEAL?.trim().toLowerCase() === 'true' &&
            Number(process.env.KEEPER_CHAIN_ID) === 31337,
    },

    /**
     * Inventory (roadmap §4): the wallet that mints claimed items and burns spent
     * consumables through ItemCore.
     *
     * Off unless ITEM_CORE_ENABLED=true, and every field below is required once it is.
     * With it off, the read surface still works — a bag renders from what the indexer
     * saw — and only the two writes that need a transaction refuse. That is the useful
     * degradation: a missing key should not hide a player's items.
     *
     * The wallet must be an authorized caller on ItemCore (`authorizeCaller`), which is a
     * real trust grant: an authorized caller can burn any wallet's items without that
     * wallet's approval. It is what lets a consumable settle in one call after the player
     * has already authenticated, and it is the reason this key belongs nowhere near a
     * shared environment.
     */
    inventory: {
        enabled: process.env.ITEM_CORE_ENABLED?.trim().toLowerCase() === 'true',
        rpcUrl: process.env.ITEM_CORE_RPC_URL?.trim() || undefined,
        privateKey: (process.env.ITEM_CORE_PRIVATE_KEY?.trim()
            ? (process.env.ITEM_CORE_PRIVATE_KEY.trim().startsWith('0x')
                ? process.env.ITEM_CORE_PRIVATE_KEY.trim()
                : `0x${process.env.ITEM_CORE_PRIVATE_KEY.trim()}`)
            : undefined) as `0x${string}` | undefined,
        chainId: process.env.ITEM_CORE_CHAIN_ID ? Number(process.env.ITEM_CORE_CHAIN_ID) : undefined,
        address: process.env.ITEM_CORE_ADDRESS?.trim() as `0x${string}` | undefined,
        /**
         * Whether a settled battle pays item drops.
         *
         * Separate from ITEM_CORE_ENABLED and off by default. Recording a drop needs no
         * transaction, only claiming one does, so the two are genuinely independent — and
         * an existing deployment should not start handing out items because a key was
         * added for something else.
         */
        dropsEnabled: process.env.ITEM_DROPS_ENABLED?.trim().toLowerCase() === 'true',
        /**
         * Wallets allowed to grant items, comma-separated. Empty by default, so the admin
         * route is closed until someone is named rather than open until someone is
         * excluded. Normalized here so a checksummed address in the env still matches the
         * lowercased one the JWT carries.
         */
        adminWallets: new Set(
            (process.env.ITEM_ADMIN_WALLETS ?? '')
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean)
                .map((entry) => (/^0x[0-9a-fA-F]{40}$/.test(entry) ? entry.toLowerCase() : entry)),
        ),
    },

    /**
     * Backend-authoritative battles (docs/battle-protocol.md).
     *
     * Every wallet-signed object binds `chainId` and `deploymentId`, and that binding only
     * stops a replay if this server refuses payloads naming a different one. Both values are
     * configured rather than inferred: a deployment id has no on-chain source, and reading it
     * from the database would make it whatever the data happened to say.
     *
     * `BATTLE_DEPLOYMENT_ID` must differ between environments, or a staging signature is a
     * valid production signature. The default is deliberately a local-only value, so a
     * production deployment that forgets to set it rejects everything rather than silently
     * sharing staging's identity.
     */
    battle: {
        /**
         * Backend-authoritative battle mode (§L Phase 3).
         *
         * Off by default, and deliberately a separate switch from the on-chain path rather
         * than a replacement for it: Phase 3 runs both side by side, and the on-chain flow
         * has to keep working untouched whether this is on or not. With it off the write
         * routes refuse, the worker does not start, and no signer is required — a
         * deployment that never turns this on should not need a signing key at all.
         *
         * "Rewardless" is not a setting. Receipts carry no transferable reward at any
         * setting; that arrives with the batch registry in Group I.
         */
        enabled: process.env.BATTLE_BACKEND_MODE_ENABLED?.trim().toLowerCase() === 'true',
        deploymentId: process.env.BATTLE_DEPLOYMENT_ID?.trim() || 'local-dev',
        /** Comma-separated protocol chain ids, e.g. `eip155:84532,solana:devnet`. */
        chainIds: (process.env.BATTLE_CHAIN_IDS?.trim() || 'eip155:31337,solana:localnet')
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
        /**
         * drand quicknet endpoints, tried in order.
         *
         * Several by default because a battle waiting on a committed round cannot be moved to
         * a different round if one endpoint is down (§E): the only options are to keep trying
         * or to forfeit, so redundancy here directly reduces forfeits. Every response is BLS
         * verified against the pinned key regardless of which endpoint answered, so an
         * untrustworthy mirror cannot do worse than fail.
         */
        drandUrls: (
            process.env.BATTLE_DRAND_URLS?.trim() ||
            'https://api.drand.sh,https://api2.drand.sh,https://api3.drand.sh'
        )
            .split(',')
            .map((url) => url.trim().replace(/\/$/, ''))
            .filter((url) => url.length > 0),
        drandTimeoutMs: Number(process.env.BATTLE_DRAND_TIMEOUT_MS?.trim() || '4000'),
        /**
         * How long a battle waits on its committed round before forfeiting (§E). Measured from
         * when the round was *due* to publish, not from acceptance, since a couple of rounds'
         * offset is expected delay, not an outage. Long enough that ordinary drand jitter never
         * forfeits a battle; short enough that a genuine outage does not leave pets locked
         * indefinitely. Default: 300s (100 quicknet rounds).
         */
        forfeitAfterSeconds: Number(process.env.BATTLE_FORFEIT_AFTER_SECONDS?.trim() || '300'),
        /** How often the compute worker polls the outbox for due messages, in ms. */
        workerPollIntervalMs: Number(process.env.BATTLE_WORKER_POLL_INTERVAL_MS?.trim() || '2000'),
        /** Messages claimed per poll, per topic. */
        workerBatchSize: Number(process.env.BATTLE_WORKER_BATCH_SIZE?.trim() || '10'),
        /**
         * Post-battle cooldown, applied to both pets after a signed receipt
         * (§C's `pet_battle_progress`, distinct from the indexed `pet_roster.ready_at`,
         * which breeding still writes).
         *
         * 900s carries over from the retired on-chain `GameConfig.battleCooldown`, which
         * no longer exists (§L Phase 6) — it is kept as a sane starting value rather than
         * an arbitrary one, and is now free to change independently.
         */
        cooldownSeconds: Number(process.env.BATTLE_COOLDOWN_SECONDS?.trim() || '900'),
        /**
         * Smallest run of published receipts worth anchoring (§I).
         *
         * A batch costs one transaction regardless of how many receipts it covers, so tiny
         * batches spend gas to amortise nothing. The default is deliberately low for a
         * quiet deployment rather than tuned: the right cadence depends on real battle
         * volume and gas price, which §L Phase 4 says to set from what the rewardless
         * launch actually shows, not from a guess made here.
         */
        batchMinSize: Number(process.env.BATTLE_BATCH_MIN_SIZE?.trim() || '1'),
        /** Most receipts in one batch. Bounds proof length and the anchoring transaction. */
        batchMaxSize: Number(process.env.BATTLE_BATCH_MAX_SIZE?.trim() || '1000'),
        /**
         * Anchoring batch roots in `BattleBatchRegistry` (§I).
         *
         * All four are required together; with any missing, batches are still built and
         * their receipts are still signed and public, they are simply not anchored. That
         * degradation is the right one: anchoring proves publication, not honesty, so
         * losing it costs immutability rather than correctness.
         */
        anchorRpcUrl: process.env.BATTLE_ANCHOR_RPC_URL?.trim() || undefined,
        anchorPrivateKey: (process.env.BATTLE_ANCHOR_PRIVATE_KEY?.trim()
            ? (process.env.BATTLE_ANCHOR_PRIVATE_KEY.trim().startsWith('0x')
                ? process.env.BATTLE_ANCHOR_PRIVATE_KEY.trim()
                : `0x${process.env.BATTLE_ANCHOR_PRIVATE_KEY.trim()}`)
            : undefined) as `0x${string}` | undefined,
        anchorRegistryAddress: process.env.BATTLE_ANCHOR_REGISTRY_ADDRESS?.trim() || undefined,
        anchorChainId: process.env.BATTLE_ANCHOR_CHAIN_ID ? Number(process.env.BATTLE_ANCHOR_CHAIN_ID) : undefined,
        /** How often to build and anchor. Latency only — both halves are idempotent. */
        anchorIntervalMs: Number(process.env.BATTLE_ANCHOR_INTERVAL_MS?.trim() || '60000'),
    },

    /**
     * The battle signer (§G). Separate from `battle` because these are credentials, and keeping
     * them in their own block makes it obvious which config is sensitive.
     *
     * Production must use a KMS: `BATTLE_SIGNER_PRIVATE_KEY` is refused when NODE_ENV is
     * production, so a deployment cannot quietly fall back to an in-process key.
     *
     * `requiredAttesters` is what makes §F's circuit breaker unbypassable: a receipt cannot be
     * signed unless every listed implementation has attested to that exact receipt hash.
     *
     * `go-verifier` is in the default, so the independent Go recomputation is a *precondition*
     * for a signature rather than a step that happened earlier in the pipeline. Those are not
     * the same guarantee: the pipeline already refuses to advance a battle whose verification
     * did not match, but that is one code path away from being edited, while this refuses at
     * the signer — the one place a receipt can actually be produced.
     *
     * It costs nothing on the happy path. `verify.worker` writes `verificationDetail` in the
     * same transition that moves a battle to `verified`, and `sign.worker` only runs from
     * `verified`, so every battle reaching the signer already carries the attestation. A
     * deployment running without indexer-go never reaches `verified` at all, and would have
     * stalled before signing with or without this.
     */
    battleSigner: {
        keyId: process.env.BATTLE_SIGNER_KEY_ID?.trim() || 'battle-signer-dev',
        /** Dev and test only. Ignored (and refused) in production. */
        privateKey: process.env.BATTLE_SIGNER_PRIVATE_KEY?.trim() || undefined,
        /** `aws-kms` today. Unset locally; required in production. */
        kmsProvider: process.env.BATTLE_SIGNER_KMS_PROVIDER?.trim() || undefined,
        /**
         * The provider's identifier for the key: an ARN or `alias/...` on AWS.
         *
         * Separate from `keyId` on purpose. `keyId` is stamped into every receipt and
         * published in the registry, so it has to stay stable; an ARN carries the account
         * id and changes if the key is re-imported or moved. Defaults to `keyId` for a
         * deployment that genuinely uses one name for both.
         */
        kmsKeyId: process.env.BATTLE_SIGNER_KMS_KEY_ID?.trim() || undefined,
        /** Omitted when the runtime already supplies one (ECS task role, Lambda, EC2). */
        kmsRegion: process.env.BATTLE_SIGNER_KMS_REGION?.trim() || undefined,
        requiredAttesters: (process.env.BATTLE_SIGNER_REQUIRED_ATTESTERS?.trim() || 'typescript-engine,go-verifier')
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name.length > 0),
        /**
         * Per-domain key overrides (§G: "separate keys for EVM and Solana reward domains").
         *
         * One key signing both chains means compromising it compromises both (threat T4), so
         * a deployment serving two families needs two keys. The signer refuses to start
         * rather than share one, and these are how each is named.
         *
         * Left unset by a single-chain deployment, which is every deployment today: with only
         * one domain there is nothing to separate, so the shared values above are used and
         * the sharing is not a compromise of anything.
         */
        domains: {
            evm: {
                keyId: process.env.BATTLE_SIGNER_EVM_KEY_ID?.trim() || undefined,
                privateKey: process.env.BATTLE_SIGNER_EVM_PRIVATE_KEY?.trim() || undefined,
                kmsKeyId: process.env.BATTLE_SIGNER_EVM_KMS_KEY_ID?.trim() || undefined,
            },
            solana: {
                keyId: process.env.BATTLE_SIGNER_SOLANA_KEY_ID?.trim() || undefined,
                privateKey: process.env.BATTLE_SIGNER_SOLANA_PRIVATE_KEY?.trim() || undefined,
                kmsKeyId: process.env.BATTLE_SIGNER_SOLANA_KMS_KEY_ID?.trim() || undefined,
            },
        },
    },
} as const;
