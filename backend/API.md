# API Documentation

## Base URL
```
http://localhost:3001
```

> **Note**: The backend runs on port 3001, not 3000. This is configured in the backend's `src/server.ts` file (TypeScript).

## 🚀 Quick Start

The backend is part of the automated development workflow. From the project root:

```bash
# Start everything (backend + frontend + contracts)
pnpm dev:full

# Or start backend only (TypeScript with hot reload)
pnpm dev:backend
```

> **Backend Features**: This backend is built with TypeScript, includes hot reload for development, and provides type-safe API routes.

## Endpoints

### Root
```http
GET /
```
Returns API information and available endpoints.

**Response:**
```json
{
  "message": "Web3 Authentication API",
  "version": "1.0.0",
  "endpoints": {
    "auth": "/api/auth",
    "protected": "/api/protected",
    "health": "/api/health"
  }
}
```

### Authentication

#### Get Nonce
```http
GET /api/auth/nonce
```
Gets a unique nonce for message signing.

**Response:**
```json
{
  "nonce": "abc123def456"
}
```

#### Verify Signature
```http
POST /api/auth/verify
```
Verifies signature and issues JWT token.

**Request Body:**
```json
{
  "address": "0x...",
  "signature": "0x...",
  "nonce": "abc123def456"
}
```

**Response:**
```json
{
  "success": true,
  "token": "jwt-token-here",
  "user": {
    "address": "0x...",
    "createdAt": "2025-01-27T...",
    "lastLogin": "2025-01-27T..."
  }
}
```

### Protected Routes

All protected routes require JWT token in Authorization header:
```
Authorization: Bearer <jwt-token>
```

#### Get User Profile
```http
GET /api/protected/profile
```

**Response:**
```json
{
  "success": true,
  "user": {
    "address": "0x...",
    "createdAt": "2025-01-27T...",
    "lastLogin": "2025-01-27T..."
  }
}
```

#### Get All Users
```http
GET /api/protected/users
```

**Response:**
```json
{
  "success": true,
  "users": [...],
  "total": 5
}
```

### Health Check

#### Server Status
```http
GET /api/health
```

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2025-01-27T...",
  "users": 3
}
```

## GraphQL — Game data (v2)

```http
POST /graphql
Authorization: Bearer <jwt-token>
```

Single JWT-protected endpoint. The authenticated wallet becomes the `caller`
context — matchmaking uses it to exclude the player's own pets. Body:
`{ "query": "...", "variables": { ... } }`.

Roster and battle data are **read** from what `indexer-go` writes (the backend no
longer decodes contract events). Roster reads are served from indexer-go's RAM
cache when `ROSTER_READ_SOURCE=grpc`, with automatic Postgres fallback; the
matchmaking response shape is identical on both paths.

### `opponents` — battle-ready matchmaking

```graphql
query($chain: String!, $minLevel: Int, $page: Int, $pageSize: Int) {
  opponents(chain: $chain, minLevel: $minLevel, page: $page, pageSize: $pageSize) {
    opponents {
      id chain owner name dna level rarity winCount lossCount readyAt
      # v2 pet fields:
      xp generation parent1Id parent2Id breedCount speciesId
      spouseId breedReadyAt trainReadyAt asset
    }
    total page pageSize
  }
}
```

v2 `OpponentPet` fields (all served from the v2 `pet_roster` columns):

| Field | Type | Notes |
| --- | --- | --- |
| `xp` | Int | XP toward the next level |
| `generation` | Int | 0 = minted (gen-0); else `max(parents)+1` |
| `parent1Id`, `parent2Id` | String | breeding lineage pet ids as decimal strings; `"0"` = none |
| `breedCount` | Int | times used as a breeding parent |
| `speciesId` | Int | resolved at mint from DNA + rarity; 0 until species pools land |
| `spouseId` | String | marriage spouse pet id as a decimal string; `"0"` = unmarried |
| `breedReadyAt`, `trainReadyAt` | Float | unix seconds next breed/train-ready (Float for 64-bit safety, like `readyAt`) |
| `asset` | String | Metaplex Core asset pubkey (Solana only); `""` on EVM |

### `pet` — single pet detail (nullable)

```graphql
query($chain: String!, $id: String!) {
  pet(chain: $chain, id: $id) {
    id chain owner name dna level rarity winCount lossCount readyAt
    xp generation parent1Id parent2Id breedCount speciesId
    spouseId breedReadyAt trainReadyAt asset
  }
}
```

Backed by indexer-go's `GetPetState` RPC. Returns the same `OpponentPet` shape
(all v2 fields) for a single pet, or `null` when no such pet exists. Reads the
indexer cache first when `ROSTER_READ_SOURCE=grpc`, with automatic Postgres
fallback — so it answers even when the indexer link is down.

### `winEstimate` — pre-fight odds (nullable)

```graphql
query($chain: String!, $a: String!, $b: String!) {
  winEstimate(chain: $chain, petId1: $a, petId2: $b) {
    winProbability  # pet1's win probability in [0,1]
    samples         # seeds the combat sim actually ran
  }
}
```

Runs indexer-go's round-based combat sim over the warm roster cache and returns
pet1's win probability. **Returns `null`** (not an error) when the estimate is
unavailable — indexer link off, breaker open, or the cache still cold — so the
matchup UI degrades to "odds unavailable". Intended for a single confirmed
matchup, not per opponents row. Optional `samples` arg overrides the server
default (clamped to 10,000).

### Leaderboards

```graphql
query($chain: String!, $page: Int, $pageSize: Int) {
  leaderboard(chain: $chain, page: $page, pageSize: $pageSize) {
    entries { rank id chain owner name dna level rarity winCount lossCount asset }
    total page pageSize
  }
  playerLeaderboard(chain: $chain, page: $page, pageSize: $pageSize) {
    entries { rank owner winCount lossCount petCount }
    total page pageSize
  }
  playerRank(chain: $chain) { rank owner winCount lossCount petCount }
}
```

Three read-only rankings over the **merged** battle record — `pet_battle_progress`
where a pet has fought a backend battle, the frozen `pet_roster` counters otherwise.
Ranking on the roster alone is not a simplification but a bug: those counters stopped
moving when battles left the chain (§L Phase 6), so on a deployment whose battles are
all backend-settled the roster-only ranking is empty.

Ordering is wins DESC, then losses ASC, then (pets only) level DESC, then the id or
owner key. The losses tiebreak *is* the win-rate tiebreak — among rows on equal wins,
fewer losses is a strictly higher rate — so nothing is ranked on a ratio drawn from a
handful of fights. Rows with no battles at all are excluded.

| Field | Type | Notes |
| --- | --- | --- |
| `rank` | Int | 1-based over the **full** ranking, not the page; page 2 continues where page 1 stopped |
| `owner` | String | grouping key on the player board: EVM addresses lowercased, Solana pubkeys untouched, matching `normalizeAccount` |
| `petCount` | Int | pets **with a battle record**, not pets owned |

`playerRank` reports the authenticated caller's own standing, so a client does not page
the whole board looking for itself. It takes no owner argument — whose rank it is comes
from the session — and returns **`null` for an unranked player** (no pet has fought)
rather than a zeroed row, which would be indistinguishable from genuine last place.

Neither board has a gRPC fast path, for the same reason `opponents` lost its own:
indexer-go's cache holds chain state and has no view of `pet_battle_progress`, a
backend-owned table, so it cannot answer these correctly. Both read Postgres directly.

### Inventory (roadmap §4)

```graphql
query($chain: String!, $petId: String!) {
  itemCatalog { itemType key category slot rarity effect name description }
  inventory(chain: $chain) {
    item { itemType key category slot rarity effect name description }
    quantity
  }
  petEquipment(chain: $chain, petId: $petId) {
    slot
    item { itemType key category slot rarity effect name description }
  }
}
```

Three read-only joins of an indexer-written projection onto the backend-owned catalog.
`item_roster` and `pet_equipment` are written **only** by indexer-go from the `ItemCore`
subgraph, under the same monotonic `last_version` guard `pet_roster` uses;
`item_definition` is content the catalog seeder writes.

| Field | Type | Notes |
| --- | --- | --- |
| `itemType` | String | ERC-1155 token id as a decimal string. The join key everywhere, including the battle snapshot |
| `key` | String | Stable content key (`xp_potion_i`). Survives a redeploy that renumbers token ids |
| `category` | String | `consumable` \| `equipment` \| `collectible` \| `material`. No cosmetics in v1 |
| `slot` | Int | 0 = weapon, 1 = armor, 2 = trinket; `null` unless equipment |
| `rarity` | Int | 1-5, the same five tiers as pet rarity, not a second scale |
| `effect` | String | Effect payload as a JSON string, `null` for an inert item. A string rather than a typed union: the shape differs per category and gains a variant per effect kind, for a value the client only renders |
| `quantity` | String | Decimal string — a uint256 balance does not fit a JS number |

`inventory` takes **no owner argument**: whose bag it is comes from the session, so there
is no spelling of the query that reads another wallet's items. An unauthenticated caller
gets an empty list rather than an error, matching `playerRank`'s treatment of no standing.
Stacks spent to nothing are omitted — the projection has to keep a zero row, because a
deletion would be invisible to the watermark read that produced it, but a player has no
reason to see one.

`petEquipment` is public, unlike `inventory`. Gear changes a pet's stats in a battle
anyone can be matched into, so hiding it from an opponent would make the fight less
checkable without making it more private. Empty slots (item type `"0"` in the table) are
omitted.

An item held but absent from the catalog is **hidden and logged**, not returned unnamed.
That state means a mint of an undefined type or a catalog seeded behind the contract, and
a blank tile in a player's bag is the worst way to discover either. `itemCatalog` reads
the database rather than the shipped source file, so a rebalance is a row edit rather than
a redeploy; an unseeded deployment therefore returns an empty catalog, which is the honest
answer.

Like the leaderboards, none of these have a gRPC fast path: indexer-go's cache holds pet
state only and has no view of these tables.

#### Inventory writes

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/inventory/use` | JWT | Body `{ chain, petId, itemType }`. Spends one consumable on one of the caller's pets |
| POST | `/api/inventory/entitlements/:id/claim` | JWT | Mints an item the caller has earned |
| POST | `/api/inventory/admin/grant` | JWT + allowlist | Body `{ chain, owner, itemType, quantity }`. Creates an entitlement for any wallet |

All three send a transaction from the backend's item wallet and are rate-limited per
wallet at 15/min, because each one spends gas from that key whether or not it settles.
They return **503** when `ITEM_CORE_ENABLED` is unset: writes refuse individually rather
than the feature going dark, so a missing key never hides a player's items.

**Equipping is not here, and will not be.** `ItemCore.equip` requires `msg.sender` to be
the pet's owner, so the player's own wallet sends it from the client. That is the property
that makes gear in a battle snapshot checkable against chain state by someone who does not
trust this server, rather than an assertion by it.

`use` burns on chain **first**, then applies the effect. The ordering is deliberate: a
burn that lands with a failed apply costs the player an item and gains them nothing, while
applying first and failing to burn would leave them the item *and* the effect, which
repeats. The failed-apply case is logged with everything needed to fix it by hand;
automating that means an outbox, worth building when volume justifies it.

XP grants go through the combat engine's own `applyXp`, so a potion moves a pet on exactly
the curve a battle does, and a pet with no progression row is seeded from its on-chain
level the way its first battle would seed it.

`claim` marks the row claimed **before** minting, conditioned on it still being unclaimed,
so two concurrent claims mint at most once — the loser's update matches no row and it
stops before sending. A failed mint releases the claim so it stays retryable, which is safe
because the client waits for a receipt and treats a reverted one as a failure.

`grant` creates an entitlement rather than minting directly, so an admin grant and a battle
drop reach a bag by the same path. Its allowlist (`ITEM_ADMIN_WALLETS`) is empty by
default: the route is closed until someone is named, not open until someone is excluded.

#### Battle drops

A settled battle can pay an item to each side, written as unclaimed entitlements **in the
same transaction as the receipt** — the rule `battle_history` already follows, because two
writes that can disagree eventually will. Off unless `ITEM_DROPS_ENABLED=true`, separately
from `ITEM_CORE_ENABLED`: recording a drop needs no transaction, only claiming one does.

The roll derives from the battle's own drand seed rather than a new randomness source.
That seed is committed to a future round *before* the fight resolves, so nobody, this
server included, can grind a drop by re-rolling, and anyone holding the receipt can
recompute what should have dropped. Each side draws from its own labelled stream, so one
side's outcome reveals nothing about the other's.

What that does **not** give you: the drop is not part of the signed receipt in v1. An
outsider can recompute what was owed and notice if something else was paid, but cannot
prove it from the receipt alone. Putting drops inside the signed payload means a receipt
schema version and a place in the ruleset hash, which is §4 phase 4 work.

Equipment never drops — that tier is gated behind its own design review, and having gear
fall out of ordinary battles would settle that question by accident. Rarity is the weight,
inverted, so a Common lands five times as often as a Legendary. The pool comes from the
shipped catalog constant rather than `item_definition`, because a replay has to reproduce
what a battle dropped, and a table that content edits underneath would answer differently
next month for the same seed.

Idempotent under a retried receipt transaction: the entitlement's unique key is
`(source_ref, owner, item_type)` with `source_ref` the battle id, so a replay collides with
its own earlier row rather than paying twice.

### Battle data

`battle_history` carries `loserPetId, seed (0x-hex), rounds, winnerHpRemaining,
xpWin, xpLoss` for every settled battle. The battle worker writes the row from the
signed receipt, in the receipt's own transaction, so a battle cannot be recorded
without its receipt. The AI battle dialogue reads `rounds`/HP/XP to flavor its
narration, and head-to-head/recent form for rivalry context.

There is no chain-truth feed behind this any more: `indexer-go` stopped decoding
settle events when battles left the chain, and its `StreamLiveBattles` push is
gone. `foughtAt` is unix seconds.

### Settle keeper

`backend/src/features/settle-keeper/` settles EVM `GameLogic` **breed and mint**
requests (the `requestX` → Pyth Entropy reveals → `settleX` flow) from a
backend-held wallet once entropy reveals, so the player only signs the request
transaction — `settleX` is permissionless and needed no special authorization,
it was just being sent from the player's wallet by default. Off unless
`KEEPER_ENABLED=true`.

Battles are **not** settled here any more (§L Phase 6). `requestBattle`/`settleBattle`
were removed from the contracts entirely, along with the Solana settle keeper and shadow
mode; battles run through the backend-authoritative path below.

### Backend-authoritative battles (v2)

`backend/src/routes/battle.ts` — the workflow described in
`docs/battle-protocol.md`. Submission and consent require a JWT
(the wallet signature inside the body is what actually authorizes the action,
per §D); the reads below require nothing, because every value they return is
either already public on chain or is itself a signed artifact anyone is meant
to check independently.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
The four write routes are gated on `BATTLE_BACKEND_MODE_ENABLED` and return **503
`backend-battle-mode-disabled`** when it is off. Every read below stays served regardless:
switching the mode off stops new battles, it does not retract receipts already issued.
`DELETE /authorizations` is ungated too, since withdrawing consent must keep working, and
`GET /authorizations` for the same reason: a defender needs to see that their consent went
stale precisely when something is off, and a mode flag should not be what hides it.
`DELETE /sessions` is ungated too, so withdrawing a delegated key never depends on a flag.
Saving a defence plan and submitting a team intent are also gated on `TEAM_BATTLES_ENABLED`
(**503 `team-battles-disabled`**), and accepting a team intent is refused with the same code;
withdrawing and reading plans are not.

| POST | `/api/battle/intents` | JWT | Submit a signed battle intent (§D). |
| POST | `/api/battle/intents/:intentHash/accept` | JWT | Freeze the snapshot, commit to a future drand round, sign the commitment, and return it synchronously (§E). |
| POST | `/api/battle/authorizations` | JWT | Submit a signed standing defence authorization (§D). |
| DELETE | `/api/battle/authorizations?chainId=` | JWT | Revoke every live authorization for the caller on one chain. No wallet signature required — refusing battles is never the dangerous direction. |
| POST | `/api/battle/sessions` | JWT | Approve a client-held key to sign battle intents for the caller (§D). The key is generated in the browser and never sent here, so the operator still cannot forge an intent — only the number of wallet prompts changes. Scope is `battle-intent` alone and the window is capped at 24h. |
| DELETE | `/api/battle/sessions?chainId=` | JWT | Revoke every session key for the caller on one chain. Unsigned, like consent revocation: the failure mode is more prompts, never fewer. |
| GET | `/api/battle/authorizations?chainId=` | JWT | The caller's own live authorizations, plus the `rulesetHash` now being served. Each carries `isStale`, true when it was signed under a different ruleset and therefore covers no battle. Always scoped to the authenticated wallet, never to a queried address: one wallet's consent state says which of their pets can be challenged and until when. |
| GET | `/api/battle/config` | none | The `deploymentId`, served `chainIds`, and active ruleset a client needs *before* it can build a signable intent. None of it is derivable client-side, and guessing it fails only after the wallet prompt: a wrong deployment is refused as `wrong-deployment`, a wrong ruleset produces an authorization no battle matches. |
| GET | `/api/battle/:battleId` | none | Battle state summary: state, failure reason, both pets, ruleset hash. |
| GET | `/api/battle/:battleId/commitment` | none | The signed commitment, exactly as delivered at accept time — the re-fetch path if a client's local copy was lost. |
| GET | `/api/battle/:battleId/receipt` | none | The signed receipt, once signing completes. |
| GET | `/api/battle/:battleId/combat-log` | none | The per-strike log plus its hash, served separately from the receipt per §G. |
| GET | `/api/battle/signing-keys` | none | Every signing key this process currently publishes, active and retired (§G). |
| GET | `/api/battle/rulesets` | none | Metadata for every published ruleset bundle. |
| GET | `/api/battle/rulesets/:rulesetHash` | none | One ruleset's full bundle, for replaying against it. |
| POST | `/api/battle/defense-plans` | JWT | Save a signed team-battle defence plan: five pets with ranks, home tiles and tactics, bound to the team ruleset in `GET /config`'s `team.ruleset`. Replaces the caller's earlier plan in the same transaction, so a defender has one live plan. Refused as `plan-ruleset-mismatch` when signed for other rules. |
| DELETE | `/api/battle/defense-plans?chainId=` | JWT | Withdraw the caller's plan. Unsigned and ungated, like consent revocation. |
| GET | `/api/battle/defense-plans?chainId=` | JWT | The caller's live plan (or null), flagged `isStale` when it no longer matches the served team ruleset. Ungated. |
| POST | `/api/battle/team-intents` | JWT | Submit a signed team challenge: three placed pets against a defence plan's hash. Accepted through the same `/intents/:intentHash/accept` route as a duel, which routes by the intent's kind. |
| GET | `/api/battle/team-opponents?chainId=&limit=` | JWT | Plans the caller can challenge now: live, in their window, under the served team ruleset, not the caller's own, with all five pets still the defender's. Each roster pet carries its progression-merged level, and `ready` says whether all five are off cooldown, which acceptance requires. Ungated. |
| POST | `/api/battle/verify-receipt` | none | Body `{ receiptHash }`. Checks the stored signature against a published key and that the payload is well-formed — §A's "operator signature, verified against a published key" row, nothing more. It does **not** re-run the fight, check the drand BLS signature, or recompute progression; that is the standalone verifier's job (§H), which runs with no backend access so its answer cannot depend on this process telling the truth. Passing this check is necessary, not sufficient. |

### Private chat (roadmap §2, v1)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/chat/threads` | JWT | The caller's currently-usable threads, one per married counterpart, with the pet pairs behind each. Creates a thread on first listing — a married pair always ends up with exactly one, so an explicit open call would add a round trip and a null state that resolves one way. |
| GET | `/api/chat/threads/:id/messages` | JWT | A page, oldest first within the page. `before=<messageId>` pages backwards (a chat is read from its end); `limit` defaults to 50, capped at 100. |
| POST | `/api/chat/threads/:id/messages` | JWT | Body `{ text }`, trimmed, 1-2000 characters. The author is the session wallet; a `sender` in the body is ignored. |

Access is **derived, never stored**: a thread answers only while the two wallets have a
married pet pair in `pet_roster.spouse_id`, rechecked on every request. A divorce closes
the conversation the moment the indexer sees it, with nothing to revoke. The thread row
survives — deleting it would destroy the history — it just stops answering.

Status codes carry a deliberate asymmetry. A non-participant gets **404**, the same as a
thread that does not exist, because 403 would confirm the id to anyone probing. A
participant whose marriage has ended gets **403** with a reason, since they already know
the thread exists.

**What v1 does not have**, each a product call flagged in the roadmap rather than an
oversight: no block or report, no profanity filtering, no read receipts or presence, no
edit or delete, and no retention policy. The abuse controls are a length cap and a rate
limit (20 sends/min per wallet, 120 reads) — volume controls, not content ones. This is
the first endpoint in the API that stores genuine user-authored text, which is what makes
moderation a real question here and not elsewhere.

### Battle room WebSocket (v2)

```
ws(s)://<host>/ws/battle-room?roomId=<roomId>
```

Notification-only, per-room channel for backend-authoritative battles (§J).
Connecting without a `roomId` query parameter closes the socket immediately
(code `1008`). Every message is the same small shape:

```json
{ "type": "battle-updated", "battleId": "btl_...", "state": "signed" }
```

The payload never carries battle content, only "this battle changed state, go
re-fetch it" from the read routes above — a client that never connected, or
missed a message, gets the exact same information by polling those same
endpoints; this socket only makes that faster, never more authoritative. A
battle only has a `roomId` if it was accepted with one (`POST
/api/battle/intents/:intentHash/accept` takes an optional `roomId` in its
body); a battle accepted without one still runs through every state normally,
it just has no spectator link to push a notification through.

This is now the only battle WebSocket. It was added as a second channel
alongside `backend/src/ws/liveBattleSocket.ts`, which broadcast every message to
every connected client for the on-chain settle-keeper flow and was filtered
client-side by `(chainId, requestId)`. That socket was removed once battles
stopped being resolved from chain state, so there is no longer a second channel
and nothing left to filter.

### Chat WebSocket (roadmap §2)

```
ws(s)://<host>/ws/chat?threadId=<threadId>
```

Per-thread, and **authenticated**. Two frame shapes, neither carrying message text:

```json
{ "type": "thread-updated", "threadId": "c...", "messageId": 42 }
{ "type": "presence",       "topic": "c...",    "online": ["0xabc…"] }
```

`thread-updated` means "re-read this thread"; the text comes from
`GET /api/chat/threads/:id/messages`, which authenticates the caller and rechecks the
marriage. Missing a notification costs latency, never access. `presence` is the roster of
participants currently connected, which is what drives the online dot.

**Authentication.** The client offers two subprotocols, `cryptopets-auth` followed by the
JWT; the server echoes back only the marker. A subprotocol rather than a query parameter
because browsers cannot set headers on a WebSocket and a URL-borne token is recorded by
proxies and access logs. The upgrade then applies the same participation and live-marriage
gate as the HTTP routes, so a socket can never subscribe to a thread its holder could not
read. A connection with no token, a forged token, or a thread the caller is not in is
refused at the upgrade — it never becomes a subscriber, not even to the fact that the
thread changed.

This is stricter than the channel shipped with. It was unauthenticated at first, on the
argument that contentless frames made it safe; presence forced the change, because "is my
counterpart online" is a claim about identities and an anonymous socket has none. Counting
connections would have reported one person with two tabs open as two people. Closing the
activity-timing leak came along with it.

Presence counts identities, not sockets, so a second tab does not double a person and
closing one does not report them as gone. Authorization is checked at connect only: a
marriage that ends mid-session leaves the socket open until it drops, which costs nothing
because every frame is contentless and the read it prompts refuses immediately.

The battle-room channel above remains unauthenticated. It carries no content and has no
presence, so it has nothing an identity would protect.

### Public receipt corpus (v2)

`backend/src/routes/receipts.ts` — the paginated export §H item 3 calls for.
No authentication on any route here, deliberately: public replay only works if
anyone can *get* the receipts to replay, not just verify a signature over one
they already have. Every route is cursor-paginated; a response's
`nextCursor`/`nextAfter` is `null` once there is nothing further to fetch, so a
client can stop after the first short page instead of making one guaranteed-
empty extra request.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/receipts/by-pet/:chainId/:petId?cursor=&limit=` | Every receipt naming this pet as attacker or defender, oldest first. This is the export a per-pet chain walk (§G) starts from — proving a pet was really level 12 means replaying the receipts that got it there. |
| GET | `/api/receipts/by-wallet/:wallet?cursor=&limit=` | Every receipt where this wallet owned either side, oldest first. Matched case-insensitively against the ledger's owner columns (the receipt table itself has no owner field, only pet ids). |
| GET | `/api/receipts?signingKeyId=&after=&limit=` | Receipts under one signing key, strictly in `sequence` order — the order the *global* hash chain requires. `signingKeyId` is required; this is the endpoint for walking one key's whole chain end to end, not for a general receipt search. |
| GET | `/api/receipts/:receiptHash/inclusion-proof` | The Merkle proof that this receipt is in its anchored batch (§I). Returns `{ receiptHash, batchNumber, merkleRoot, proof }`. **404 `not-batched`** when the receipt is unknown *or* exists but has not been batched yet — the latter is normal and temporary, while an unbatched receipt past the inclusion SLO is operator failure, so a client needs to be able to tell those apart from a receipt that never existed. |

`limit` defaults to 100 and is clamped to 500 on every route. The by-pet and
by-wallet exports order by `(createdAt, receiptHash)`, since two receipts can
share a `createdAt` (concurrent battles resolving in the same second) and an
order that isn't fully deterministic makes cursor pagination silently skip or
repeat rows at a page boundary.

`GET /api/battle/signing-keys` is backed by the `battle_signing_key` table, so a rotated
key keeps being published across restarts and deploys. The in-memory copy is a cache that
keeps the lookup synchronous on the receipt-verification path; the durable list is reloaded
at startup, and any key that is not the one currently signing is reported as rotated —
so an operator who swapped keys without registering the old one explicitly still gets the
old key published. Rows are never deleted: dropping a key would make its receipts
*unverifiable* rather than invalid, which is a different and worse outcome (§H item 4).

### Reward seasons (v2)

`backend/src/routes/rewards.ts` — the claim-proof half of §I. Unauthenticated, like the
receipt corpus: a claim proof only ever pays the wallet bound inside its leaf, so publishing
one lets a third party sponsor someone's gas rather than take their reward.

Read-only by design. Building a season and opening it on chain are operator actions with
real money attached; they belong behind an owner key and a deliberate command, not an HTTP
route reachable by anything holding a token.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/rewards/seasons/:seasonId` | Season metadata: the receipt `sequence` range it covers, the distributor and token its leaves bind to, the root, the total, and the rates it was computed from. The range and rates are the reproducibility contract — they say exactly which slice of the corpus to replay to arrive at this root. |
| GET | `/api/rewards/seasons/:seasonId/claim/:wallet` | The wallet's `amount`, its Merkle `proof`, and the `breakdown` behind the number. **404 `no-entitlement`** covers both an unknown season and a wallet that earned nothing — the answer to "what can I claim" is the same either way, and distinguishing them would leak which wallets participated to anyone enumerating. |

Only **anchored** receipts count toward a season. An unanchored receipt is signed and public,
but its batch root is not yet immutable, so rewarding it would mean paying against a history
that could still be reorganised.

### Relevant environment variables

| Var | Purpose |
| --- | --- |
| `INDEXER_GRPC_ADDR` | indexer-go gRPC link (e.g. `localhost:50051`). Unset = stream + `winEstimate` off; roster falls back to Postgres. |
| `ROSTER_READ_SOURCE` | `grpc` to read matchmaking from indexer-go's cache (Postgres fallback); `postgres` (default) for Prisma only. |
| `INDEXER_PROTO_PATH` | Override path to `proto/cryptopets.proto` (defaults to `../proto`). |
| `KEEPER_ENABLED` | Turns the settle keeper on (breed and mint only — battles are settled by the backend, §L Phase 6). Off by default. |
| `KEEPER_RPC_URL` / `KEEPER_PRIVATE_KEY` / `KEEPER_CHAIN_ID` / `KEEPER_GAME_LOGIC_ADDRESS` | Required once enabled; keeper logs and no-ops if any are missing rather than crashing the server. |
| `KEEPER_BACKFILL_BLOCKS` | How far back to scan on boot for requests never settled (default 5000). |
| `KEEPER_MOCK_REVEAL` | Local dev only: keeper also acts as the Entropy provider (`MockEntropy.mockReveal`). Only takes effect when `KEEPER_CHAIN_ID=31337`. |
| `BATTLE_BACKEND_MODE_ENABLED` | Backend-authoritative battle mode (§L Phase 3). Off by default; gates the write routes, the outbox worker, and the signer requirement. Reads stay served either way. |
| `BATTLE_BATCH_MIN_SIZE` / `BATTLE_BATCH_MAX_SIZE` | Smallest run worth anchoring, and the cap on one batch (§I). |
| `BATTLE_ANCHOR_RPC_URL` / `BATTLE_ANCHOR_PRIVATE_KEY` / `BATTLE_ANCHOR_REGISTRY_ADDRESS` / `BATTLE_ANCHOR_CHAIN_ID` | Anchoring batch roots in `BattleBatchRegistry`. Required together; with any missing, batches are built but never anchored. The wallet needs the registry's publisher role. |
| `BATTLE_ANCHOR_INTERVAL_MS` | How often to build and anchor (default 60000). Latency only — both halves are idempotent. |

> **Migration prerequisite:** the v2 `pet_roster` / `battle_history` columns ship
> in `prisma/schema.prisma`; run `pnpm prisma:migrate` then `pnpm prisma:generate`
> before indexer-go writes the new columns. All new columns are defaulted, so v1
> rows and the dialogue client-report write path stay valid.
