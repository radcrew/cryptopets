# image-generator

Standalone microservice that renders pet NFT art. A pet's DNA is decoded into
visual traits, those traits build a fixed prompt, and Cloudflare Workers AI
turns the prompt into an image. See
[`docs/plan-future-features-roadmap.md`](../../docs/plan-future-features-roadmap.md) §9
for the design rationale.

## The one hard constraint: generate once, then never again

DNA -> traits -> prompt is exact integer math and reproducible forever. The
diffusion step is not: the same prompt and seed give the same image only for one
model version on one provider, so a model deprecation or a silent weights update
would change what an already-minted NFT looks like. Every generated image must
therefore be written to immutable content-addressed storage on first request and
served from there afterwards. Regenerating on cache miss is a correctness bug,
not a performance one.

That also happens to fit the free allocation: Workers AI bills per request, so
one image per pet for the lifetime of the pet keeps a collection's cost bounded
by the number of pets rather than by traffic.

## Why it is a separate package

It shares no code with `backend`, `frontend`, or `shared`, and nothing in the
monorepo imports it. That is deliberate: the service is deployable and testable
on its own, and work here does not touch files other branches are editing.
Clients depend on its *routes*, never its code: `petArtUrl` in `@shared/core`
builds the URL, and `VITE_IMAGE_SERVICE_URL` / `IMAGE_SERVICE_URL` point at it.

That isolation has a cost this service already paid once. `PET_CORE_ABI` in
`src/chain.ts` is a hand-copied transcription of `PetCore.Pet`, and when the
retired battle fields left that struct, nothing here noticed: the fixtures
encoded the same stale layout the reader decoded, so the suite agreed with
itself while every live EVM read threw. `src/chain.test.ts` now transcribes the
struct independently of the fixture, which is the only guard available without
importing from the contracts package. Re-check it against
`contracts/ethereum/src/PetCore.sol` whenever that struct changes.

The
one thing it re-implements is `digitPair` (two-digit decimal slicing of DNA,
canonically `contracts/ethereum/src/DnaLib.sol`); it is not combat math, so
there is no golden-vector obligation and nothing to drift.

## Status

Built incrementally. Done so far:

- [x] DNA -> visual trait derivation (`src/traits.ts`)
- [x] Traits -> deterministic prompt and seed (`src/prompt.ts`)
- [x] Cloudflare Workers AI client and `pnpm generate` CLI (`src/workersAi.ts`)
- [x] Immutable image store: R2, filesystem, memory (`src/store.ts`, `src/r2Store.ts`)
- [x] Generate-once pipeline with in-flight dedupe (`src/pipeline.ts`)
- [x] On-chain reads: tokenId -> dna/rarity/speciesId (`src/chain.ts`)
- [x] HTTP surface and ERC-721 metadata (`src/routes.ts`, `src/metadata.ts`)
- [x] Deployment: `Dockerfile`, plus the Render block in Deployment below
- [x] `PetCore.tokenURI` can be pointed here (owner-settable base URI)
- [x] Burst handling: retry with backoff, bounded concurrency (`src/retry.ts`)
- [x] Chain-agnostic routing, ready for a second reader (`src/readerRouter.ts`)
- [x] Solana reader, dependency-free (`src/solana.ts`, `src/base58.ts`)
- [x] Collection warming with dry-run and resumability (`src/warm.ts`)
- [x] CI and coverage (`.github/workflows/image-generator.yml`)
- [x] Readiness probe that exercises the store and RPC (`src/readiness.ts`)
- [x] Integration tests against fake chain RPCs, a fake S3, and a fake Workers AI
- [x] `pnpm smoke`: boots the built server against fake upstreams end to end
- [x] Clients wired up: `frontend` and `mobile` both render pet art from here
- [x] Verified against live Base Sepolia and Solana devnet: `/ready` passes all
      three checks and `/metadata/evm/1` returns a real pet
- [ ] A live generation run: no real image has been produced yet. Everything up
      to the Workers AI call is confirmed working against the real chain; with a
      placeholder token `/image/evm/1.png` answers 502 (the generation call
      being rejected) and an unminted id answers 404 before spending anything.
      Real `CF_ACCOUNT_ID` / `CF_API_TOKEN` are the only thing still missing
- [ ] Solana verified against a real cluster: the decode is covered by fixtures
      only, since there is no validator in the environment this was written in

Every upstream that can be faked locally now is. Chain RPCs, R2 (through the real
AWS SDK against a fake S3 endpoint), and Workers AI (through real `fetch` against
a fake Cloudflare endpoint) all run over real sockets, and `pnpm smoke` boots the
built `dist/main.js` against those fakes and walks the routes a client uses.

`CF_API_BASE` and `R2_ENDPOINT` are what make that possible: they override the
Workers AI and R2 endpoints, so the shipped binary can be driven without
credentials. Both have production uses too, a Cloudflare-compatible gateway and
any S3-compatible store. `pnpm smoke` boots the binary twice, once on the
filesystem store and once on R2, because production runs the R2 path and only the
filesystem one had ever actually started.

What none of it can tell you is whether Cloudflare and R2 *accept* these requests.
The request-shape tests spell out exactly what would be sent, so it can be compared
against Cloudflare's docs; a live `pnpm generate` settles it.

## Traits

Every visual trait comes from its own DNA digit pair, so changing one look does
not disturb another:

| Trait | Source | Range |
| --- | --- | --- |
| `element` | pair 0 % 6 | 6 palette families |
| `body` | `speciesId % 8`, else pair 6 % 8 | 8 silhouettes, aligned to the 8 skill archetypes |
| `pattern` | pair 7 % 5 | 5 coats |
| `eyes` | pair 7 / 5 % 4 | 4 eye styles |
| `marking` | pair 7 / 20 % 5 | 5 face markings |
| `aura` | rarity - 1 | 5 frame/glow tiers |
| `build` | HP gene (pair 1) | 0-99 body girth |
| `spark` | INT gene (pair 4) | 0-99 eye/aura intensity |

### Known: the app displays a different element than the metadata

`element` here follows `DnaLib.sol`, the contract's own derivation and the one
combat uses: `digitPair(dna, 0) % 6`, i.e. `(dna % 100) % 6`. The frontend's
`getPetElement` / `getPetClass` in `shared/src/utils/ethereum/petCard.ts` use
`dna % 6` instead. **Those disagree for roughly two thirds of DNA values**
(1332/2000 across a sweep), so a pet whose metadata reads `Element: Water` can
show in the app as "Cosmic Owl".

This predates the service and was not introduced by it; those helpers look like
v1 synthetic fallbacks, alongside `getGeneration`, which the pet card already
prefers a real on-chain field over. Nothing here changes them, because aligning
them would change the displayed class of every existing pet, which is a product
decision rather than a refactor. Flagged so it is chosen rather than discovered.

If they are aligned, the contract derivation is the one to keep: it is on-chain,
it drives combat, and the art is generated from it.

Cosmetic pair 7 decomposes exactly (5 x 4 x 5 = 100), so all 100 of its values
map to a distinct pattern/eye/marking combination. Pair 6 is already spent on
species at mint time (`PetCore._resolveSpecies`), so the HP and INT genes supply
the remaining per-pet variation. Art reads DNA and never feeds back into combat.

## HTTP surface

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness. Touches nothing external and always answers 200 while the process runs |
| `GET /ready` | Readiness. Actually exercises the store and *every* configured chain RPC; 503 with a per-dependency breakdown naming what broke |
| `GET /image/:chain/:tokenId.png` | The pet's art. Generates on first request, cached forever after. 302s to the bucket when `R2_PUBLIC_BASE_URL` is set |
| `GET /metadata/:chain/:tokenId` | ERC-721 metadata, what `tokenURI` should point at |

`:chain` is `evm` or `solana`. Identifiers pass through as strings and each reader
validates its own format, because a pet id is decimal on EVM and a base58 Core
asset pubkey on Solana: `/metadata/solana/<asset-pubkey>`. `createReaderRouter`
separates two failures worth keeping apart: an unimplemented chain is a permanent
400, while a supported chain this deployment has no credentials for is a 501, an
operator problem rather than a caller one.

One trap in that identifier pattern: it accepts alphanumerics rather than the
base58 alphabet, because base58 excludes `0` and would 404 every EVM pet whose id
contains one.

**Metadata never triggers generation.** A marketplace indexing a whole
collection hits every metadata URL at once; if that generated images it would
bill thousands of inferences in a burst. Art is generated when an image is first
actually fetched.

Token ids are resolved by reading `PetCore.getPet` directly over RPC, not via the
backend. The backend's roster is an indexer projection that can lag, and a wrong
`dna` here does not render a slightly stale pet, it renders a *different* pet and
then caches that mistake permanently.

One sharp edge in that contract: **`getPet` has no `entryExists` modifier.** It
reads the mapping directly, so an unminted tokenId returns a zero-valued struct
rather than reverting. Taken at face value that would generate art for a pet that
does not exist and cache it forever, so existence is checked against
`totalPets()`, mirroring PetCore's own `petId > 0 && petId <= _petCount`. The two
calls are issued in parallel, so the check costs an extra `eth_call` and no extra
latency.

Status codes are deliberately distinguishable: 404 unminted pet, 400 bad chain or
token id, 502 Workers AI failure (nothing was cached, so a retry can succeed).

### Liveness vs readiness

They answer different questions, and conflating them causes the failure each is
meant to prevent. `/health` says the process is running: it makes no external
call, so a platform that restarts unhealthy instances never restarts one over a
transient upstream blip. `/ready` says this instance can actually serve an image,
by proving both dependencies that otherwise break a deploy silently:

- **The store.** Wrong R2 credentials or a missing bucket boot perfectly well and
  fail on the first image, long after the deploy was declared good.
- **The chain RPC.** A bad URL is invisible until a request needs it.

The chain probe reads a real token id and counts "no such pet" as success: any
answer proves the RPC is reachable and the contract address decodes, and that is
cheaper than requiring a pet that exists. Only a transport failure is unready.

**Every configured chain is probed, not just the first.** Checking one while
serving two would let a deployment whose Solana provider blocks
`getProgramAccounts` pass readiness and then fail every Solana request. Each chain
gets an identifier it will actually accept: a decimal id on EVM, and on Solana the
system-program pubkey, since `'1'` is not base58 and the reader would reject it
before the network, proving nothing.

**Point the platform's health check at `/health`, and check `/ready` yourself
after deploying.** Wiring a platform probe to `/ready` sounds stricter but means an
upstream blip can cycle a service that is otherwise fine; the deploy-time
validation is better done once, deliberately, than continuously.

## Storage

`IMAGE_STORE` selects the backend: `r2` (production), `filesystem` (dev), or
`memory` (tests and one-shot CLI runs; never persists). All three implement the
same two-method `ImageStore` interface, so an IPFS or Arweave pin can be added
later without touching the pipeline.

**The key is derived from a pet's art identity — `(dna, rarity, speciesId)` —
not from the prompt.** That distinction is the whole point. Keying on the prompt
would mean any wording tweak in `prompt.ts` becomes a cache miss and a brand-new
image for a pet somebody already owns. Keying on identity means an existing pet
keeps its art however much the prompt table later evolves. Pets with identical
dna, rarity, and species are identical by construction, so they share a key and
one generation covers both.

The derivation is pinned by golden key fixtures in `src/store.test.ts`, in the
spirit of `contracts/test-vectors`. It has the largest blast radius in the
service: every generated image lives at its key, so any change orphans all of
them at once and every pet silently gets new art. A test that only checks the
derivation agrees with itself cannot catch that, so the expected digests are
written down. A deliberate change is an `ART_VERSION` bump, not a fixture edit.

Regenerating art for existing pets is therefore an explicit decision: bump
`ART_VERSION` in `src/store.ts`. Keys are namespaced by version, so old art stays
readable and a bump can be rolled back. Every owner sees their pet change, which
makes it a product call, not a refactor.

Each image is written alongside a JSON manifest recording the traits, model,
prompt, seed, and timestamp that produced it. Once a model version moves on, that
manifest is the only record of how a given pet came to look the way it does.

## Burst behaviour

Image generation is a paid, rate-limited upstream, and the natural access pattern
is bursty: a marketplace loading a collection's images arrives as N requests at
once. Three things keep that from turning into N failures.

- **Bounded concurrency** (`CF_MAX_CONCURRENT`, default 2). Excess callers queue
  rather than fail, because waiting a few seconds beats being told a pet has no
  image. Deliberately low: the free allocation is small and the queue drains fast.
- **Retry with backoff** (`CF_MAX_ATTEMPTS`, default 3) on 429 and 5xx, honouring
  `Retry-After` when the upstream sends one, capped so a hostile value cannot pin a
  request open. A 4xx other than 429 is not retried: the request itself is wrong,
  so another attempt buys the same error. Retrying a 429 is free (a rejected
  request was never billed); a 5xx may have been billed, which is the honest cost.
- **Bounded total spend.** Nonexistent pets are rejected before generation, so the
  lifetime inference count is bounded by the number of minted pets, not by traffic.
- **Bounded response time** (`IMAGE_RESPONSE_TIMEOUT_MS`, default 25s). Past that
  the request answers 503 with `Retry-After` instead of holding the connection.
  The generation is *not* cancelled: it finishes and lands in the store, so the
  retry is a cache hit and the inference already paid for is not wasted. Without
  this, a cold gallery of 50 pets leaves its last caller waiting ~150s, and a
  single request can hang for `CF_TIMEOUT_MS x CF_MAX_ATTEMPTS` (~3 minutes),
  which browsers and proxies abandon anyway.

The client side matters too: pet images are lazy-loaded, so a gallery requests art
only for pets actually on screen rather than one per pet in the collection. Run
`pnpm warm` before pointing anything at a fresh deployment and none of this
arises, because every request is a hit.

Concurrent first-ever requests for the same pet are collapsed into one
generation, so a pet's page open in two tabs bills one inference rather than two.
The dedupe is per process; with several instances the race is still possible, and
the honest bound is that R2 resolves it last-write-wins and the pet is stable
from then on. A shared lock is only worth adding if that shows up in practice.

## Commands

Run from this directory. The service is deliberately *not* a member of the root
`pnpm-workspace.yaml`, so it keeps its own `pnpm-lock.yaml` and needs
`--ignore-workspace` on install; a plain `pnpm install` here walks up to the
monorepo root and installs that instead, leaving this package with no
`node_modules`. `pnpm --filter` from the repo root does not reach it either.

That isolation has one cost worth knowing: the root `pnpm lint` and `pnpm test`
aggregates, and the Coverage workflow, all skip this package. `.github/workflows/
image-generator.yml` is what actually runs its suite, on Node 22 to match the
Dockerfile, and it also builds the image and checks the container reports missing
configuration rather than crashing.

```bash
pnpm install --ignore-workspace
pnpm test          # vitest
pnpm lint          # eslint
pnpm build         # tsc -> dist/
pnpm typecheck     # tsc including the specs, which build/ excludes
pnpm test:coverage # vitest --coverage
pnpm build && pnpm smoke   # boot dist/main.js against fake upstreams
pnpm dev           # watch mode on :8787
pnpm start         # run the built server

# One-shot generation. Prints traits, seed, and prompt before it needs
# credentials, so prompt wording can be iterated on with no token set.
cp env.example .env   # then fill in CF_ACCOUNT_ID / CF_API_TOKEN
pnpm generate --dna=7934056188134207 --rarity=3 --out=pet.png

# Defaults to the filesystem store, so running the same pet twice serves the
# second from cache and bills nothing. --store=memory forces a fresh inference.
pnpm generate --dna=7934056188134207 --rarity=3 --store=memory

# Pre-generate a whole collection (see Warming below).
pnpm warm --from=1 --to=200 --dry-run
pnpm warm --from=1 --to=200
```

## Warming

Art is generated on first fetch, so the first marketplace crawl after `tokenURI`
starts resolving here hits a cold cache: every image at once, all of them misses.
`pnpm warm` walks an id range ahead of time and turns that into cache hits, with
the spend somewhere it can be watched.

```bash
pnpm warm --from=1 --to=200 --dry-run   # reads the chain, generates nothing
pnpm warm --from=1 --to=200
```

Two properties matter more than speed:

- **One pet's failure does not stop the run.** A gap in the range, an RPC hiccup,
  a pet that was burned: each is recorded and the walk continues. Aborting midway
  through a paid batch is the worst outcome, since the work already done is fine.
  Failures are listed individually, not just counted, and the process exits
  non-zero so a script can retry.
- **Runs are resumable by construction.** The pipeline checks the store before any
  inference, so re-running after a partial failure pays only for what is still
  missing. Ids past the current supply count as "not minted", not as errors,
  because warming past the end is routine.
- **Pets are warmed `CF_MAX_CONCURRENT` at a time**, the same budget a live
  instance generates with, rather than one after another: a large collection at a
  few seconds an image would otherwise take most of a day. Progress streams as
  pets finish, while the final summary stays in id order.

`--dry-run` still reads the chain and checks the cache, so it reports exactly
which pets would be generated. Use it to size a run before paying for it.

**Warming is EVM-only, and says so.** Solana pets are addressed by Metaplex Core
asset pubkey, so an id range names nothing there; `--chain=solana` is refused
rather than walking ids that every reader rejects, which would report a tidy
"not minted" summary and exit 0 having warmed nothing. Warm a Solana collection
by requesting its image URLs directly.

## Model choice

Default is `@cf/bytedance/stable-diffusion-xl-lightning`. It takes an explicit
`seed`, so a pet's image is re-derivable from its DNA, and it is tuned for 4-8
steps, which keeps free-allocation usage low.
`@cf/black-forest-labs/flux-1-schnell` also works via `CF_IMAGE_MODEL`: it
returns base64 in a JSON envelope instead of raw PNG bytes, and the client handles
both. Flux is sent only `prompt` and `steps`, its documented input: anything
outside that schema risks a 400, which is non-retryable and would fail every
request. So flux output cannot be re-derived from DNA, only recovered from cache. No LLM is involved anywhere; prompts
come from a lookup table, because an LLM would add nondeterminism and a second
inference cost to something a table does exactly.

## Deployment

The `Dockerfile` builds from this directory alone, with no monorepo context. That
falls out of the service not being a workspace member: its lockfile is
self-contained, so the image is small and the build cannot break because another
package changed.

```bash
docker build -t image-generator .
docker run --rm -p 8787:8787 --env-file .env image-generator
```

Set `IMAGE_STORE=r2` in production. The container runs unprivileged and needs no
writable volume, which is only true because R2 is the store; the filesystem store
would need one.

The commands the image runs are verified against the built output: `node
dist/main.js` boots, the `HEALTHCHECK` probe returns 0, `--frozen-lockfile`
resolves, the compiled JS imports nothing outside `dependencies` (so the `--prod`
runtime stage is complete), and `SIGTERM` stops the listener and exits without
lingering handles. The image build itself is unverified: there is no Docker on the
machine this was written on, so alpine and layer specifics need one real
`docker build`.

### Render

Render reads only a repo-root `render.yaml`. The repo has none at the moment
(it was removed while the project runs on localhost only), so this is the block
to put back if the service is deployed there again, with the reasoning behind it:

```yaml
  - type: web
    name: do-not-stop-image-generator
    runtime: node
    plan: free
    rootDir: services/image-generator
    # --ignore-workspace: this package is not a pnpm workspace member and has
    # its own lockfile, so the monorepo root must not be resolved here.
    buildCommand: |
      export PNPM_PREFIX="$HOME/.npm-global"
      export PATH="$PNPM_PREFIX/bin:$PATH"
      npm install -g --prefix "$PNPM_PREFIX" pnpm@9.15.9
      pnpm install --ignore-workspace --frozen-lockfile && pnpm build
    startCommand: node dist/main.js
    # /health, not /ready: a platform probe on /ready lets an upstream blip cycle
    # an otherwise healthy service. Check /ready once after deploying instead.
    healthCheckPath: /health
    envVars:
      - key: PUBLIC_BASE_URL
        sync: false     # must match the service's own URL
      - key: IMAGE_STORE
        value: r2
      # Set in the dashboard, not here: CF_ACCOUNT_ID, CF_API_TOKEN, R2_BUCKET,
      # R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, EVM_RPC_URL, PETCORE_ADDRESS.
```

Two notes carried over from the existing blueprint: do not set
`NODE_ENV=production` in `buildCommand`, since it skips the TypeScript
devDependency the build needs, and free web services sleep when idle. Sleeping is
harmless here as long as `IMAGE_STORE=r2`, because art already generated survives
in the bucket; a service that slept on the `filesystem` store would wake up and
regenerate.

### Why not Cloudflare Workers

Workers would remove both credentials: Workers AI and R2 are available as
bindings rather than as authenticated HTTP APIs. It would also mean a different
runtime (no `node:http`, no S3 client) and a rewrite of the server and store
layers. Worth doing if this service grows, not worth it to ship the first
version.

### Pointing tokenURI here

`PetCore.tokenURI` used to hardcode `https://api.cryptopets.io/metadata/`, which
does not resolve. It now prefixes an owner-settable base, so it can point at this
service. This is the one change outside `services/image-generator/`
(`contracts/ethereum/src/PetCore.sol` plus `scripts/upgrade-pet-core.ts`).

An upgrade alone changes nothing: with no base set, `tokenURI` returns exactly its
old value via `DEFAULT_BASE_TOKEN_URI`. Pointing it here is a separate owner call,
so the two steps verify independently and the URI can move later without
redeploying.

```bash
# Upgrade the implementation and point tokenURI at this service in one run.
pnpm --prefix contracts/ethereum exec tsx scripts/upgrade-pet-core.ts \
    --network=base-sepolia --base-uri=https://art.cryptopets.io/metadata/evm/

# Or change only the URI later, with no redeploy.
pnpm --prefix contracts/ethereum exec tsx scripts/upgrade-pet-core.ts \
    --network=base-sepolia --skip-upgrade --base-uri=https://art.cryptopets.io/metadata/evm/
```

The token id is appended verbatim, so the base must end with its own separator
(`/`, or `=` for a query-style base). The script warns when it does not, rather
than refusing, since a wrong value is visible in the next `tokenURI` read and
fixed by re-running.

## License

PolyForm Noncommercial 1.0.0, the root [`LICENSE`](../../LICENSE), same as every
non-contract package in this repo.
