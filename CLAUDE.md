# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The import above pulls in the cross-tool non-negotiables and command baseline from [AGENTS.md](./AGENTS.md), shared with other coding agents (Cursor, Codex, etc.). Everything below is Claude Code specific.

## What this is

`do-not-stop` (product name **cryptopets**) is a pnpm monorepo for a Web3 pet-battling game deployed on both Ethereum (Hardhat/Sepolia) and Solana (local validator/devnet). Live demo: https://cryptopets.vercel.app.

## Working Guidelines

**Think before coding.** State assumptions explicitly rather than silently picking between interpretations. If a request is ambiguous, or a simpler approach exists than the one implied, say so before implementing, especially around the chain-parity and licensing boundaries documented below, where a wrong guess is expensive to unwind.

**Simplicity first.** No speculative abstractions, no unrequested configurability, no error handling for scenarios that can't occur at the call site. If a change could be half the size, make it that size.

**Surgical changes.** Touch only what the task requires; match each file's existing style even where you'd choose differently. When your edit makes an import, variable, or function unused, remove it, but leave pre-existing dead code alone and just flag it. Never drive-by "fix" one leg of the combat simulator (Solidity/Rust/Go/TS) without updating the other three and rerunning the golden vectors (see Architecture).

**Goal-driven execution.** For multi-step work, state a short plan with a verification step per item, e.g. "port fix to indexer-go, then verify with `go test ./internal/combat -run TestName` against the golden vector." Use the smallest per-package command from the table below that actually exercises the change, not the whole suite, unless the change is broad.

**Loops and autonomy.** "Done" means the relevant command from the table above passes, not "looks right." Work on a branch so changes are easy to revert. Autonomous or `/loop`-driven runs need an explicit stop condition (a passing test, a clean lint run) and an iteration cap; don't loop indefinitely on judgment calls like game-balance tuning or design decisions, those are a human call. If you hit the cap or get stuck, stop and report what you tried and what's blocking, rather than thrashing or guessing further.

**Text.** In commit messages, PR descriptions, and docs written for this repo: no em-dashes, no filler ("it's worth noting," "essentially"), no LLM tells ("it's not just X, it's Y," "delve"). Reread before finishing and cut anything that doesn't earn its place.

**Commit messages.** After *every* response in which you change one or more files — not just at the end of a multi-step task, and not just when asked — automatically draft and show a Conventional Commits message (`feat:`, `fix:`, `docs:`, `chore:`, etc., matching this repo's history) in a copyable code block. This applies even to small, incremental edits (a single CSS tweak, a one-line fix) made in response to iterative follow-up requests, not only to larger logically-complete changes. Scope it to the actual uncommitted change set (check `git status`) and call out any unrelated modified files so they can be excluded. Do not run `git commit` yourself; the user commits manually unless they explicitly ask you to.

## Commands

Run from repo root unless noted. Package manager is **pnpm** (`packageManager: pnpm@9.15.9`).

### Install / dev
```bash
pnpm install                 # root only
pnpm install:all             # root + frontend + website + backend + mobile + contracts/ethereum + image-generator
pnpm dev                     # backend + frontend + image-generator + indexer-go (concurrent)
pnpm dev:fe                  # frontend only
pnpm dev:be                  # backend only
pnpm dev:mobile              # mobile only
pnpm dev:web                 # website only
pnpm dev:art                 # image-generator only (pet art, :8787)
pnpm dev:idx                 # indexer-go only, hot-reloaded by air (health :8090, gRPC :50051)
pnpm eth:node                # local Hardhat network
pnpm eth:deploy              # deploy contracts to it
pnpm sol:docker               # start Solana validator (docker-compose)
pnpm sol:inject-ngrok         # tunnel local Solana RPC for mobile/device testing
pnpm fe:eth:local            # HH node + deploy + VRF watcher + backend + frontend, concurrently
pnpm mobile:eth:local        # same, with mobile instead of frontend
pnpm fe:sol:local            # backend + frontend + Solana docker/ngrok, concurrently
```
> `pnpm dev` runs four services and, unlike the `fe:*:local` stacks, **deliberately omits `--kill-others-on-fail`**. Two of the four are optional and exit at boot when unconfigured: `image-generator` without `CF_ACCOUNT_ID`/`CF_API_TOKEN`, `indexer-go` without `DATABASE_URL`. Under `--kill-others-on-fail` either one would take the backend and frontend down with it, which is why they used to be left out entirely. Without the flag a misconfigured optional service dies in its own pane and the rest keep running. The cost is that a backend crash no longer tears the stack down either, so read the pane labels (`BE`, `FE`, `ART`, `IDX`). Run `pnpm dev:be` / `dev:fe` / `dev:art` / `dev:idx` individually when you want one.
>
> `pnpm dev:idx` needs [`air`](https://github.com/air-verse/air) on `PATH` (`go install github.com/air-verse/air@latest`); config is `services/indexer-go/.air.toml`. It is the only service here without a pnpm script of its own, so the root script `cd`s into the package.

> `pnpm eth:deploy` and `pnpm eth:vrf:watch` currently reference `deploy:inject` and `vrf:watch` scripts that **no longer exist** in `contracts/ethereum/package.json` (that package was refactored to `scripts/deploy.ts` plus Hardhat Ignition). If these fail, deploy directly with `pnpm --prefix contracts/ethereum deploy` (or `deploy:sepolia` / `deploy:base-sepolia`) instead of chasing the root wrapper script. `DEVELOPMENT.md` and `contracts/ethereum/README.md` also document a few commands (`pnpm clean`, `pnpm vrf:watch`, and an older "start everything" meaning of `pnpm dev`) that don't match the current root scripts, so treat those docs as partially stale and trust `package.json` scripts blocks over prose.

### Lint / test / build (root aggregates)
```bash
pnpm lint                    # frontend lint:check + @shared/core lint + website lint + mobile lint
pnpm lint:fix
pnpm test                    # equals contracts/ethereum test (Hardhat/Mocha), NOT a full monorepo test run
pnpm build                   # compile contracts + build backend + frontend + website
```
**`pnpm lint` and `pnpm test` do not cover every package.** `image-generator` is not in *any* root aggregate and is not even a workspace member; it has its own lockfile and its own CI workflow. Do not reach for `pnpm --filter image-generator <script>` either: it prints `No projects matched the filters` **and exits 0**, so it reports success having run nothing. Run per-package commands below when touching those.

### Per-package commands
| Package | lint | test | build | single test |
|---|---|---|---|---|
| `frontend` | `pnpm --filter frontend lint:check` (`eslint . --max-warnings 0` + CSS naming check) | `pnpm --filter frontend test` (vitest) | `pnpm --filter frontend build` (`tsc -b && vite build`) | `pnpm --filter frontend exec vitest run <path>` or `-t "<name>"` |
| `backend` | `pnpm --filter backend lint` (`eslint .`) | `pnpm --filter backend test` (vitest) | `pnpm --filter backend build` (`prisma generate && tsc`) | `pnpm --filter backend exec vitest run <path>` |
| `shared` (`@shared/core`) | `pnpm --filter @shared/core lint` | `pnpm --filter @shared/core test` (vitest) | *(none, consumed as raw TS)* | same vitest pattern |
| `protocol` (`@cryptopets/protocol`) | `pnpm --filter @cryptopets/protocol lint` | `pnpm --filter @cryptopets/protocol test` (vitest) | *(none, consumed as raw TS; `typecheck` runs `tsc --noEmit`)* | same vitest pattern |
| `verifier` (`@cryptopets/verifier`) | `pnpm --filter @cryptopets/verifier lint` | `pnpm --filter @cryptopets/verifier test` (vitest) | *(none, consumed as raw TS; `typecheck` runs `tsc --noEmit`)* | same vitest pattern |
| `mobile` | `pnpm --filter mobile lint` | `pnpm --filter mobile test` (jest) | *(none, RN, use `android`/`ios` scripts)* | `pnpm --filter mobile exec jest <path>` or `-t "<name>"` |
| `website` | `pnpm --filter website lint` (`next lint`) | *(no test script)* | `pnpm --filter website build` | n/a |
| `contracts/ethereum` | `pnpm --filter ethereum lint` (solhint, security rules only) | `pnpm --prefix contracts/ethereum test` (`pnpm hh test`) | `pnpm compile` (`pnpm hh compile --force`) | `pnpm --prefix contracts/ethereum hh test test/<File>.test.ts` |
| `contracts/solana/cryptopets` | n/a | Anchor test suite (see package README) | `anchor build` | n/a |
| `services/indexer-go` | `go vet ./...` | `go test ./...` (unit only; Postgres tests are gated on `TEST_DATABASE_URL` and **truncate tables**, scratch DB only) | `go build -o bin/indexer ./cmd/indexer` | `go test ./internal/combat -run TestName` |
| `services/image-generator` | `pnpm lint` (from that dir) | `pnpm test` (vitest) | `pnpm build` (`tsc`), plus `pnpm typecheck` for the specs | `pnpm test <path>` |

> `services/image-generator` runs from its own directory and installs with `pnpm install --ignore-workspace`. Two traps: a plain `pnpm install` there walks up to the monorepo root and installs *that*, leaving the package with no `node_modules`; and `pnpm --filter image-generator <script>` from the root exits 0 without running anything, since the filter matches no workspace project. Its suite runs in `.github/workflows/image-generator.yml`, not the Coverage workflow.

> `contracts/ethereum`'s solhint config (`.solhint.json`) lists **security rules only** and deliberately does not extend `solhint:recommended`. The recommended set reports 595 problems on this source: 382 are missing natspec tags, and most of the remainder are gas-style opinions (`gas-custom-errors`, `gas-indexed-events`) that would change revert data and the event ABI on deployed, upgradeable contracts, breaking the subgraph and every test asserting a reason string. Those are product decisions, not lint fixes. `not-rely-on-time` is also omitted: all 16 of its findings are `block.timestamp` gating a cooldown, breeding window, season boundary, or batch stamp, which are hour- and day-scale against roughly 15s of miner drift. The rules that remain all pass today, so a failure is a real regression rather than pre-existing debt. Solhint's config parser rejects unknown top-level keys, so this rationale cannot live in the file itself.

`*_test:coverage` scripts exist for frontend/backend/shared (`vitest run --coverage`); CI runs these in `.github/workflows/coverage.yml` and posts a combined PR comment. Coverage requires `@vitest/coverage-v8` to match the installed `vitest` major version, or coverage collection breaks repo-wide.

## Architecture

### Component map
| Component | Stack | Role |
|---|---|---|
| `frontend` | React 19, Vite, Wagmi, Viem, TanStack Query | Web app, wallet integration |
| `backend` | Node.js, Express, TypeScript, Prisma, JWT | REST + GraphQL + gRPC API server, plus the settle keeper (async battle/breed/mint settlement) |
| `mobile` | React Native | Cross-platform client |
| `website` | Next.js | Marketing/docs site |
| `services/indexer-go` | Go | Optional cross-chain indexer (EVM pull + Solana push) |
| `contracts/ethereum` | Solidity, Hardhat | EVM contracts (`PetCore`, `GameLogic`, `GameConfig`, `ItemCore`) + subgraph |
| `contracts/solana/cryptopets` | Rust, Anchor | Solana programs |
| `shared` (`@shared/core`) | TypeScript | Common utils/types/hooks, consumed as raw TS (no build step), shared by frontend + mobile |
| `protocol` (`@cryptopets/protocol`) | TypeScript | MIT, dependency-free battle protocol: the TS combat engine plus (in progress) canonical encodings, hashes, and drand seed derivation. Consumed as raw TS by `shared`/`backend` and by `verifier` |
| `verifier` (`@cryptopets/verifier`) | TypeScript | MIT, standalone public receipt verifier (§H). Depends only on `protocol`; no backend access, no database. Checks seed derivation, operator signature, drand BLS beacon, combat replay, progression, and hash-chain continuity, reporting each independently |
| `proto` | Protobuf/Buf | gRPC contract (`GameDataService`) between `indexer-go` and `backend` |
| `services/image-generator` | Node.js, TypeScript, Cloudflare Workers AI, R2 | Standalone service rendering pet NFT art + ERC-721 metadata. **Not a pnpm workspace member** (see below) |

### Data flow
On-chain pet state (EVM via subgraph watermark polling, Solana via WebSocket push + backfill) is mirrored into Prisma-owned Postgres (`pet_roster`) by **`indexer-go`, which is the only indexer**. It also owns `item_roster` and `pet_equipment` (roadmap §4, EVM-only), on their own watermarks separate from the roster's — a shared cursor advanced by the busy stream would skip the quiet one's unread rows permanently, since the incremental query filters on `updatedAt_gt`. The backend's built-in Node `RosterIndexer` no longer exists — nothing in `backend/src` indexes chain state, so a local stack that needs a populated roster has to run `indexer-go`. `battle_history` is not indexed at all: the backend writes it from its own signed receipts. `indexer-go` also answers pet-state reads and win estimates over gRPC; if it is down the backend falls back to reading Postgres directly (`ROSTER_READ_SOURCE` controls `grpc` vs `postgres`, and matchmaking always reads Postgres). Frontend, mobile, and website all talk to the backend via REST + GraphQL; none of them read chain state directly. The one thing outside that path is pet art: the frontend and mobile app request images straight from `image-generator` (`VITE_IMAGE_SERVICE_URL` / mobile's `IMAGE_SERVICE_URL`), which reads `PetCore` over RPC itself rather than trusting the indexer, because a stale `dna` there would not render an outdated pet but a *different* one, and cache that permanently. Both clients build the URL with `petArtUrl` from `@shared/core`, so the route shape (numeric id on EVM, Core asset pubkey on Solana) is written down once; only the environment read is per-platform. Art is optional by construction: unset the variable, or let the service be down, and pets fall back to their emoji avatars. Note the service transcribes `PetCore.Pet` by hand in `src/chain.ts` rather than importing an ABI, so a change to that struct silently breaks every EVM read here until it is copied across. See `backend/API.md`, `services/indexer-go/README.md`, `services/image-generator/README.md`.

Note: there is no `docs/architecture.md` and no `services/indexer-go/ARCHITECTURE.md`. The component map and data flow live in this file's Architecture section, and the indexer's real doc is `services/indexer-go/README.md`. Everything that used to link to those two paths now points at the real ones, so a new reference to either is a mistake rather than a known gap.

### Cross-chain interfaces: one thin adapter layer, plus logic that stays deliberately separate
`shared/src/hooks/adapters/` (`ChainAdapter` in `types.ts`) is a real, shared TypeScript interface. `useEvmAdapter` and `useSolanaAdapter` both implement it, `useChainAdapter` returns whichever is active, and every public pet-action hook consumes it for the mutation itself. `useLevelUpPet`, `useTrainPet`, `useRenamePet`, `useTransferPet`, `useBattlePets` and the pet-list read are chain-blind end to end, with no chain test anywhere in them. `useCreatePet` and `useBreedPets` are **not**: they call the adapter for the write, then carry the EVM-only Pyth Entropy settle lifecycle inline behind `isEvm` guards (14 and 15 of them respectively, in 209- and 179-line files). Treat those two as chain-blind on the action and chain-specific on the settlement. Check `adapters/types.ts` before assuming this doesn't exist.

What that adapter does NOT unify: `frontend/src/chains/ethereum/` (wagmi client, in-tree ABI JSONs: `gameConfigAbi.json`, `gameLogicAbi.json`, `petCoreAbi.json`) and `frontend/src/chains/solana/` (Anchor wallet/provider/signer) are still separate, low-level wiring with no shared interface between them, each adapter reaches into its own directly. The async breed and mint randomness flows are also not unified: EVM's Pyth Entropy watch lives in `shared/src/hooks/chains/ethereum/useWatchEntropyFulfillment.ts` and `usePolledContractEvent.ts`, Solana's Switchboard flow in `shared/src/utils/solana/breedWithSwitchboardVrf.ts` and `mintWithSwitchboardVrf.ts`. Battles take neither path as of §L Phase 6: they are drand-seeded and settled by the backend. The combat simulator is not unified either; see the next section. Treat the adapter as a thin, uniform shape over pet-action mutations and reads, not a claim that the underlying chain logic is shared.

### Frontend panels: a controller hook when there's a state machine, direct composition when there isn't
`frontend/src/components/pet/interactions/panels/` holds two shapes, and which one a panel uses is not about size. The test is whether the panel owns a **multi-step state machine** — a flow with intermediate states the player sits and watches.

- **It does** → a headless controller hook in `frontend/src/hooks/<feature>/`, and the component consumes that single hook and holds **no** `useState`/`useEffect` of its own. `battle` (27-line view over `useBattlePanel`), `breed` (73 over `useBreedPanel`), `marriage` (94 over `useMarriagePanel`). Each of those flows has real intermediate states: request, entropy reveal, settle, result, and for battle a mismatch reconciliation.
- **It doesn't** → the component composes the shared hooks directly and keeps its form state local. `rename`, `level-up`, `train`, `defense` all open with the same preamble (`useChainCapabilities`, `usePetList`, `useNotifyError`, plus the action hook, plus `useFees` where the action costs money). These are one action over one selected pet; there is no interim state worth modelling.

Do not "fix" `useBattlePanel` for being 511 lines. Its own doc comment records the reasoning: selection and validation are tightly coupled (random-match and battle-start both touch validation), so one controller is the honest seam, and the genuinely separable concerns were already extracted to `useResultDialogue` (still in `frontend/src/hooks/battle/`, since it maps dialogue turns onto view props) and `useBattleOutcome` (now `@shared/core`, along with `useLiveBattleAnimation` — both are platform-neutral, so mobile's battle scene gets them for free). If it does get touched, the thing worth consolidating is its six `useEffect`s, whose ordering is implicit, not its line count.

### Combat simulator: one frozen port, two live ones, and the vectors that hold them together
The battle/combat logic began as four independent implementations. As of §L Phase 6 they are no longer peers, and the Solidity one is gone:

- **Frozen** — Solana's `game/battle_sim.rs` and `game/xp.rs`. No caller left in the program, kept because their golden-vector tests are what still tie the vectors to what really settled on that chain. **Do not change them.** A bug is fixed forward in the live ports under a new `rulesetVersion`.
- **Deleted** — `contracts/ethereum/src/CombatSim.sol`. Removed once nothing on chain called it, together with `gen-battle-vectors.ts` (which generated `battle.json` from it) and `CombatGoldenVectors.test.ts`. `battle.json` is unchanged and still gates the live ports; what is gone is the ability to regenerate it, and the Solidity leg of the parity check.
- **Live** — `protocol/src/combat/` (the canonical engine, re-exported from `shared/src/utils/combat` for existing importers) and `services/indexer-go/internal/combat/` (the independent verifier). These two `MUST` change together. §F's circuit breaker only has value because they were written to disagree if either drifts, so updating one alone quietly disarms it.

The remaining three are validated against the same golden vectors at `contracts/test-vectors/{battle,xp}.json`, run by Anchor, `combat_golden_test.go`, and `@cryptopets/protocol`'s `tests/combat/goldenVectors.test.ts`. A third file, `equipment.json`, pins what gear does (roadmap §4) and is read by the **two live ports only** — the frozen Solana port predates equipment and never applies it, so it is not a witness to that file. Its first case reproduces a `battle.json` row exactly, which is what proves the modifier path costs an ungeared fight nothing rather than merely claiming so. Equipment applies after `extract` and before the skill multipliers, so Tank's `+20%` multiplies the geared total; that ordering is pinned by a vector case at a one-point margin in both ports, because moving it in one alone changes every geared fight. A fourth file, `team.json`, pins the three-on-three team engine and squad draw (`docs/battle-protocol.md` §F, "Team battles") and is likewise read by the two live ports only. With one fighter a side the team engine must be a duel strike for strike, which both ports check by replaying every `battle.json` and `equipment.json` case through it. Keeping Anchor's frozen suite running is the point: it proves the vectors still describe what actually settled on Solana, and the live suites prove the current engine has not drifted from it. Hardhat no longer checks `battle.json` at all — that leg went with `CombatSim.sol`. `contracts/ethereum/test/XpFormula.test.ts` still runs, but note it is a pure-TypeScript reimplementation of the formula checked against the fixture; it does not call a contract, and did not before this change either.

Hashing uses **legacy Keccak-256** (`keccak256(abi.encodePacked(...))` byte layout); a SHA3-vs-Keccak mismatch fails every vector. The TS port covers XP and level progression as well as fight math: `protocol/src/combat/xp.ts` mirrors the XP rules the chains settled under (`GameLogic._calcXp` / `PetCore.addXp`, plus the same-opponent decay that `PetCore` no longer carries) and is validated against `contracts/test-vectors/xp.json`, with the snapshot-shaped wrapper in `protocol/src/progression/` (vectors: `protocol-progression.json`). This became portable once `lastOpponentId`/`streak` were frozen into the battle snapshot; before that the client had no way to know the streak state XP depends on. Note the decay shift **must be clamped to 31** in TS: JavaScript's `>>` masks the shift count to 5 bits, so an unclamped `200 >> 32` returns 200 where Solidity, Rust, and Go all return 0. `services/indexer-go/internal/combat/xp.go` still covers only the formula and decay, not level-up.

Two protocol objects are now versioned, and the rule is the same for both: **an absent `schemaVersion` means 1, never "whatever this build implements"**. `snapshot` v2 adds per-pet equipment and `ruleset` v2 adds the combat-affecting item catalog; every snapshot and published bundle written before those fields existed is a v1 object with receipts already signed over it, so defaulting to the current version would re-encode all of them under a layout they were never hashed under. Old versions stay in `SUPPORTED_VERSIONS` permanently. This was not theoretical: the first draft defaulted to current and 35 receipt vectors caught it immediately.

**If a golden vector test fails, a live port has drifted from the rules real battles were settled under. Fix the drifted port, never edit the vector.** A *frozen* port failing a vector means something worse — the vectors or the contract source no longer match what is deployed — and is an incident, not a test failure.

### Per-battle on-chain settlement is retired (§L Phase 6)
New battles run through the backend-authoritative path (`BATTLE_BACKEND_MODE_ENABLED`): signed intent, committed drand round, signed receipt, Merkle batch anchored by `BattleBatchRegistry`. `GameLogic`'s `requestBattle`/`settleBattle` flow and both settle keepers are **legacy**, kept for one reason — every battle they settled has to stay replayable, and the events and receipts they produced stay served indefinitely (§H). Retiring the path means new battles stop using it, never that old ones become uncheckable. The keepers remain deployable (`KEEPER_ENABLED`, `KEEPER_SOLANA_ENABLED`, both off by default) so an existing deployment can drain in-flight requests rather than stranding them.

### Settle keeper: the second EVM breed/mint transaction isn't the player's
Battles no longer take this path at all as of §L Phase 6 (above). Breed and mint still do — they have no backend-authoritative equivalent and continue to settle on chain.

`GameLogic`'s async flows (`requestBattle`/`requestCreateFromDNA`/`requestMintStarter` → Pyth Entropy reveals → `settleX`) used to have the frontend send the settle transaction itself, meaning two wallet prompts per action even though settle is permissionless. A backend service, `backend/src/features/settle-keeper/`, now watches Pyth Entropy's `Revealed` event and sends the settle transaction from its own wallet; the frontend only falls back to prompting the player if the keeper hasn't settled within ~45s (keeper outage or not configured). Gated by `KEEPER_ENABLED` (off by default); see `backend/env.example` for the full var list. This fixes only the double-signature UX; the related security fix — `requestBattle` snapshotting sim inputs so a level-up between request and settle can't reroll a committed battle — already lives in `GameLogic.sol` itself.

### Battle fee funds the settle keeper's own gas (EVM) — retired
Retired with the on-chain battle path (§L Phase 6): `GameConfig.battleFee`, `setBattleFee`, and `useFees().battleFee` are all gone, and the keeper settles breed and mint only. Kept because the `GameConfig` migration it forced is still live and its env-staleness warning still applies. The original text follows.

The EVM settle keeper (above) sends `settleBattle` from its own wallet, but until this was added that transaction (~800k gas, `SETTLE_GAS_LIMIT` in `backend/src/features/settle-keeper/abi.ts`) was entirely unfunded — the player's `requestBattle` payment only ever covered the Pyth Entropy fee. `GameConfig.battleFee` (owner-tunable via `setBattleFee`) is now required on top of the entropy fee at `requestBattle` time, escrowed in the pending record, and refunded on `cancelBattle` (no settle tx is ever sent for a cancelled request); on a normal settle it just adds to the contract's withdrawable balance alongside the other protocol fees — there's no automatic reimbursement to the keeper wallet specifically, so it still needs manual top-ups from `withdraw()` proceeds. The frontend surfaces this via `useFees().battleFee` (chain-neutral — see the Solana section below) and shows it in the Start Battle button label. Because `GameConfig` isn't behind a proxy (see its own doc comment), adding this field required a fresh `GameConfig` deployment plus a new `setGameConfig(address)` setter on both `GameLogic` and `PetCore` (added together, deliberately — `PetCore` reads several other config values like `battleCooldown`/`poolSizes`, and pointing only one proxy at a new instance would let the two silently diverge). `scripts/upgrade-game-config.ts` handles the migration: it replays every existing tunable from the old `GameConfig` onto the new one before repointing anything, so live-tuned values (fees, skill balance, cooldowns) aren't reset to source defaults. This has been run against the live Base Sepolia deployment; any client env (`VITE_GAMECONFIG_ADDRESS`, `KEEPER_GAME_CONFIG_ADDRESS`) pointing at the old `GameConfig` address needs updating too, or fee reads fail outright (the old contract has no `battleFee()` at all) — check `frontend/.env`/`.env.local` and `backend/.env` aren't stale before assuming a deployment issue is something else.

### Solana battles are retired too (§L Phase 6)
`commit_battle`/`settle_battle`/`cancel_battle`, the `BattleRequest` account, the Solana settle keeper (`backend/src/features/settle-keeper-solana/`), and `GlobalState.battle_fee_lamports` are all gone. Solana battles now take the same backend-authoritative path as EVM ones, so `settle_breed`/`settle_mint` are the only remaining commit/settle flows, and both still require the player's own signature: their Metaplex Core mint CPI needs a real payer signature, which is why the keeper never generalized to them.

One thing deliberately stayed: `game/battle_sim.rs` and `game/xp.rs` have no caller left in the program but are **frozen, not deleted**. With `CombatSim.sol` gone, their golden-vector tests are the *only* remaining independent witness that `contracts/test-vectors/{battle,xp}.json` describe what actually settled on chain — the two live ports are the things those vectors check, so they cannot vouch for them.

`set_open_to_challenges` and `PetAccount.open_to_challenges` were **deleted** (v7). `commit_battle` was the flag's only reader, and defender consent is now a wallet-signed `DefenseAuthorization` (§D) that `accept.service.ts` requires per battle — covering pet, level band, ruleset hash, validity window and daily cap. The flag protected nothing while a UI toggle still implied it did, which is worse than dead code. `GlobalState.level_band_width` went with it, matching the EVM removal of `GameConfig.levelBandWidth`.

Both sat mid-struct, so every field after them moved: `CURRENT_ACCOUNT_VERSION` is now **7**, and it needs a redeploy plus `GlobalState` reinit and re-minted pets. `services/indexer-go/internal/solana/idl/cryptopets.json` is hand-edited to match, because it drives **positional Borsh decoding** — an IDL still listing `openToChallenges` would misalign every field from `xp` onward and corrupt silently. Re-diff it against the IDL `anchor build` generates.

`GlobalState._reserved` has absorbed both removals — 16 → 24 for `battle_fee_lamports`, 24 → 26 for `level_band_width` — so `GlobalState::SPACE` never changes and the account's rent-exempt size stays put. `PetAccount::SPACE` shrank by 1 byte. `ErrorCode` renumbered when the battle variants went: `#[error_code]` assigns codes sequentially from 6000, so every code after them shifted.

**Rust/Anchor changes here were written without a local toolchain (no `cargo`/`anchor`/`rustc`/`solana` on PATH in this environment) — run `anchor build` / `anchor test` before trusting them.**

### Entropy / randomness
Both remaining async EVM flows — breed (`requestCreateFromDNA`) and starter mint
(`requestMintStarter`) — use Pyth Entropy v2 (`requestV2` → `entropyCallback`
stores the revealed word only → a separate permissionless settle call runs the actual logic).
This has already fully replaced the Chainlink VRF and predictable `Utils.randMod`
(keccak-of-timestamp) schemes that older revisions of `contracts/plan-contract-upgrade.md`
describe as the v1 baseline still to be migrated — there is no `Utils.sol`, no Chainlink
dependency, and no `randMod` anywhere in `contracts/ethereum/src` today; treat that plan doc's
"current state" tables as historical, not current, and trust the contract source instead.
Locally there's no live Pyth network, so Hardhat tests deploy `MockEntropy` and reveal manually
(`entropy.mockReveal(...)`); the settle keeper's `KEEPER_MOCK_REVEAL` flag (see above) does the
same thing for a running local node, replacing the old `vrf-fulfill-watcher.ts` script for this
flow (see the stale-script note in Commands above).
Solana breeding and minting use Switchboard On-Demand (commit then settle), also async.
Battles use neither: they are seeded from a committed drand round by the backend (§E).

### Pet stats: chain state plus backend progression, merged at the read
On-chain `level`/`xp`/`winCount`/`lossCount` are **frozen** for battles — nothing has written them since §L Phase 6 — while the live record accumulates in `pet_battle_progress`. Neither table alone is right: the roster misses every backend battle, and progress rows only exist for pets that have fought.

The rule, applied in two places because there are two read paths:
- **Backend-served pets** (opponents, `pet`, `searchPets`, `allPets`): merged server-side in the GraphQL resolvers via `backend/src/repositories/battleProgress.overlay.ts`.
- **A player's own pets**: read straight off PetCore / the Solana program by the chain adapter, so the *client* merges, in `usePetList` via `shared/src/hooks/useBattleProgress.ts` (backed by the `battleProgress(chain, petIds)` GraphQL field).

Both apply the same rule: a pet with a progress row shows backend progression, one without shows chain truth, and `readyAt` takes the **later** of the two cooldowns (breeding still writes the on-chain one; battles write the backend one). Progress rows are seeded from on-chain level on a pet's first battle, so the two agree the moment a row appears.

The merge is deliberately **not** in `roster.repository.ts`. `snapshot.builder.ts` seeds a first progress row from the roster's on-chain level and `intent.service.ts` checks ownership there; merging in the repository would feed overlaid progression back into the thing that produces it.

Two reads are exceptions to the two-site split above, and for the same reason: what they merge is also what they filter or order on, so the merge has to happen in the query. `findReadyOpponents` filters, bands and orders on level and cooldown; `leaderboard.repository.ts` (pet board, player board, `findPlayerRank`) ranks on win/loss. Both do a raw `LEFT JOIN` against `pet_battle_progress` rather than being overlaid afterwards, because an overlay applied to a page can only rewrite rows the query already chose — for matchmaking that fixes the cooldown and leaves the level band reading frozen values, and for the leaderboard it produces a page ordered by numbers nobody ranked on. The cost is that these queries have **no gRPC fast path**: indexer-go's cache holds chain state and has no view of `pet_battle_progress`, a backend-owned table, so it cannot answer them correctly. `getPetById` keeps its cache path, because there the resolver does the merge.

The leaderboard is worth knowing about specifically because the naive version of it is wrong in a way that looks right: ranking on `pet_roster.win_count`/`loss_count` alone returns **nothing** on a deployment whose battles are all backend-settled, since those columns froze at §L Phase 6. `docs/plan-future-features-roadmap.md` §1 originally proposed exactly that; its "Built" banner records the correction.

### battle_history comes from the receipt now, not the indexer
`battle_history` feeds the AI dialogue service's rivalry / head-to-head context. It used to be written by the indexer from on-chain settle events, with the dialogue endpoint filling gaps from the client's own result report. Both sources are gone: there are no settle events, and a client-reported result must never be able to restate what was signed.

The battle worker writes the row from the signed receipt, in the **same transaction** as the receipt itself, so a battle cannot be recorded without its receipt or the reverse. `foughtAt` is unix seconds, taken from `receipt.createdAt` — the removed client-report path wrote `Date.now()` milliseconds, so any row predating this sorts far in the future in `getRecentForm`.

The dialogue endpoint's anti-forgery guard still exists but now compares the client's claimed winner against that recorded row rather than against a chain event. It stays permissive when the battle is not yet on record (dialogue can be requested before the receipt commits), which is acceptable because it now only protects the dialogue cache — the battle record itself is no longer writable from that path.

Consequently `src/grpc/battleStream.ts` is deleted: nothing published to it after indexer-go stopped ingesting battles, and nothing read from it after this. `INDEXER_GRPC_ADDR` still matters for pet-state reads and win estimates. `StreamLiveBattles` and `ListReadyOpponents` are gone from `proto/cryptopets.proto` too, along with indexer-go's whole `BattleEvent` pipeline — no adapter had published one since battles left the chain.

### Inventory: two owners, one join, and gear that has to be checkable (roadmap §4)
`ItemCore.sol` is an ERC-1155 where the token id is the item *type* and the balance is the
quantity, so a catalog of 20 items and one of 2,000 cost the same on chain. Four tables
split across two owners, and the split is the point: `item_definition` is backend content a
rebalance edits, while `item_roster` and `pet_equipment` are chain projections **only
indexer-go writes**, under the same monotonic `last_version` guard `pet_roster` uses.
`item_entitlement` is backend-owned and holds earned-but-unminted drops. Reads join a
projection to the catalog in TypeScript rather than SQL, so the two owners stay visible.

Four things are easy to get wrong here:

- **Equipping escrows the token into `ItemCore`, and only the player can send it.**
  `equip` requires `msg.sender` to be the pet's owner, so the backend physically cannot do
  it — that is what makes gear in a battle snapshot checkable against chain state by
  someone who does not trust the operator, rather than an assertion by it. Escrow also
  stops one sword buffing five pets without a locked-balance invariant that breaks the
  moment a geared pet changes hands. Consumables go the other way: the backend burns them
  from its own authorized wallet, which is a real trust grant (an authorized caller can
  burn any wallet's items) and the reason that key belongs nowhere shared.
- **Nothing in the projections is ever deleted.** A spent stack writes `quantity 0` and an
  emptied slot writes `item_type "0"`, because indexer-go resumes from an `updatedAt`
  watermark and a deleted row is one it never learns about. Zero is a value, not an absence.
- **Battle drops derive from the battle's own drand seed**, committed before the fight
  resolves, so nobody including the operator can grind one. They are written in the *same
  transaction* as the receipt, the rule `battle_history` already follows. The honest limit
  is larger than it used to say here: an outsider holding the receipt **cannot** recompute
  the drop at all. The rates and the drop pool are backend constants (`drops.ts`,
  `catalog.data.ts`), neither reaches the ruleset, and only the seed and battle id are
  signed, so the payout is not pinned by the receipt either. Publishing them would put
  non-equipment items into `rulesetHash`, which §4 rules out because adding a collectible
  would then re-consent every defender. Tracked as D2 in
  `docs/plan-battle-inventory-hardening.md`.

- **The catalog has a lenient read and a strict one, and combat must use the strict one.**
  `getCatalog`/`getPetEquipment` hide a row they cannot read, which is right for a bag: one
  unnamed tile beats a bag that will not open. `getCombatCatalog`/`getPetEquipmentForCombat`
  throw instead, and `servedRuleset` and `snapshot.builder` use those. The difference is not
  fussiness: an unreadable equipment row dropped from `itemCatalog` moves `rulesetHash` and
  invalidates every outstanding defence authorization, and an uncatalogued equipped item
  dropped from a snapshot produces a receipt saying the pet fought bare while
  `ItemCore.equipmentOf` at `sourceVersion` says otherwise. Acceptance turns either into an
  `item-catalog-stale` rejection rather than fighting under rules it cannot state.

Equipment reaching combat is what made this expensive, and it is why `snapshot` and
`ruleset` both went to schema v2 (see the combat-simulator section above). The snapshot
freezes **resolved modifiers plus the item type**: the modifiers so unequipping after
acceptance cannot change a committed fight, the item type so the `equipment` check can
confirm those modifiers were the ones the catalog declares. Replay alone cannot do that — a
receipt granting +50 ATK from a 4-ATK dagger replays perfectly. That check is
`findEquipmentMismatches` in `@cryptopets/protocol`, and it has **two** callers on purpose:
`@cryptopets/verifier` runs it on a finished receipt, and `accept.service` runs it before a
battle starts, so a fight guaranteed to fail verification is refused rather than held. One
implementation because two would drift into a battle that accepts and then cannot be
verified, with the comparison itself the last thing anyone would suspect. What remains
unproven is *ownership* of the item, which is a claim about chain state at `sourceVersion`
that the verifier deliberately cannot read.

`servedRuleset()` joins the live catalog onto `SOURCE_DEFAULT_RULESET` and caches for the
process's life, so a catalog edit needs a restart. That is deliberate: it moves
`rulesetHash`, which invalidates every outstanding `DefenseAuthorization`, and that should
be a deliberate rollout rather than a row edit that quietly re-prices live battles. Only
equipment reaches the ruleset for the same reason — re-prompting every defender because a
badge was added would train players to click through the one prompt that matters.

### Every WebSocket channel goes through one upgrade listener
`backend/src/ws/channel.ts` owns the process's single `upgrade` handler and dispatches on path; `battleRoomSocket.ts` and `chatSocket.ts` are thin registrations on top of it. Do **not** add a channel by constructing `new WebSocketServer({ server, path })`. That attaches one upgrade listener *per instance* to the same HTTP server, Node calls every listener on every upgrade, so each connection is handled twice, the client gets two HTTP 101 responses, and the second is parsed as a frame — `RangeError: Invalid WebSocket frame: RSV1 must be clear`. It breaks **every** channel, not just the new one, and per-channel tests will not catch it because each builds its own HTTP server with a single channel attached (`tests/ws/channel.test.ts` is the regression test that does).

A channel may declare an authorizer, which runs before the handshake so a refused client never becomes a subscriber at all. The battle room has none: its frames carry nothing a client could not re-fetch, which is the only thing that makes an anonymous socket acceptable. Chat has one, and needed it for presence — "is my counterpart online" is a claim about identities, and an anonymous socket has none, so counting connections would report one person with two tabs as two people. Presence therefore counts identities, not sockets. The JWT arrives as a WebSocket subprotocol rather than a query parameter: browsers cannot set headers on a WebSocket, and a URL-borne token is recorded by proxies and access logs.

### Private chat (roadmap §2 v1): access is derived per request, never stored
`chat_thread` deliberately does not record the marriage that justifies it. Every read, send, and socket upgrade rechecks `pet_roster.spouse_id` through `chat.service.authorizeThread`, so a divorce closes the conversation the moment the indexer sees it, with no revocation step that could be forgotten. The thread row survives — deleting it would destroy the history — it just stops answering.

Two consequences worth keeping: a non-participant gets **404, not 403**, identical to a thread that does not exist, because 403 would confirm a thread id to anyone probing; and the caller is normalized (`normalizeAccount`) at the service boundary, since the caller doubles as the thread's participant key and an unnormalized spelling would open a second thread beside the first and split the conversation.

### Known v1 contract limitations (design context, not regressions to "fix")
`contracts/plan-contract-upgrade.md` documents intentional v1 gaps that v2 is designed around: no battle authorization (anyone can call `battle()`/`attack()` on anyone's pets), an EVM `changeDna` cheat that lets a level-20 pet set arbitrary DNA, and a Solana `create_starter_pet` that accepts client-supplied dna/rarity. v2 plan: EVM moves to UUPS proxies (`PetCoreProxy` + `GameLogicProxy`, with `CombatSimV1` deployed as a separate contract to stay under the 24KB bytecode ceiling); Solana adds versioned/reserved-space accounts and migrates pets to Metaplex Core NFTs. This is a plan doc; check current contract source before assuming any of it is implemented.

### Hardhat specifics worth knowing
- Contract sources live in `contracts/ethereum/src/` (not `contracts/`): `PetCore.sol`, `GameLogic.sol`, `GameConfig.sol`, `DnaLib.sol`, `TestDeployer.sol`, plus `BattleBatchRegistry.sol` / `SeasonRewardDistributor.sol` for the backend-battle anchor and rewards, and `ItemCore.sol` for inventory (§4).
- `@openzeppelin/contracts-upgradeable` is pinned to **4.7.3** while `@openzeppelin/contracts` is `^5.4.0`. A new upgradeable contract uses the 4.x initializer style (`__ERC1155_init`), not v5's `_update` hook — `ItemCore.sol` is the worked example.
- `scripts/deploy.ts` has **no `localhost` network** (see `scripts/networks.ts`), so the documented local path does not run. To deploy locally, start `pnpm hh node`, deploy `MockEntropy`, write an `ignition/parameters/.runtime-localhost.json` naming it, and call `pnpm hh ignition deploy ignition/modules/CryptoPetsV2Live.ts --network localhost --parameters <file> --deployment-id <name>` directly.
- Both compiler profiles (`default` and `production`) are pinned to `viaIR` explicitly, because Hardhat Ignition silently drops viaIR/optimizer settings from a flat config and the two profiles must match. `CombatSim.sol`'s "stack too deep" was the original reason; with it deleted the remaining sources compile without viaIR, so the setting is now an optimizer choice rather than a requirement.
- The `localhost` network hardcodes the 5 standard Hardhat dev private keys; only live networks (Sepolia, Base Sepolia, see `scripts/networks.ts`) read `PRIVATE_KEY` from env.
- Deployment is Hardhat Ignition-based (`ignition/modules/CryptoPetsV2Live.ts`); use `pnpm --prefix contracts/ethereum deploy:status` / `deploy:visualize` to inspect.

### Solana local setup
`contracts/solana/docker-compose.yml` runs two services: `solana-dev` (the validator itself, ports 8899/8900/9900) and an **ngrok tunnel** service exposing the local RPC (needs `NGROK_AUTHTOKEN`, ngrok web UI on 4040). This is how mobile/on-device testing reaches a local validator (`pnpm sol:inject-ngrok`), and it isn't documented in `DEVELOPMENT.md`.

### indexer-go internals
Two chain adapters (Solana WS push, EVM subgraph pull) behind a `ChainIndexer` interface feed a single version-guarded pgx batch writer into Postgres. Layout: `cmd/indexer` (binary, supports `-scan-once`), `internal/{indexer,evm,solana,store,combat,grpcsrv}`, `pb/` (buf-generated). It indexes the roster only: the battle pipeline (`battlebus`, `BattleEvent`, `InsertBattles`) is gone, and `battle_history` is written by the backend from signed receipts. An optional in-memory read cache (`ROSTER_CACHE_ENABLED`) is write-through and version-guarded; it's only coherent while `indexer-go` is the sole writer, so it should stay off during shadow-mode (dual-indexer) operation and only be enabled at promotion.

### Auth
Backend auth is nonce, then wallet-signature, then JWT (`backend/README.md`), guarding a single `/graphql` endpoint; the authenticated wallet becomes the matchmaking `caller` context (`backend/API.md`). Roster/battle reads are read-only projections of what the indexer(s) wrote; the backend no longer decodes contract events itself. `winEstimate` returns `null` (not an error) when unavailable, so treat that as a degraded UI state, not a failure.

### Testing conventions
See `docs/testing.md` for the full per-package suite table. Test work is expected to land on dedicated branches per test type/area (e.g. `test/frontend-modules`), not mixed into feature branches, with coverage reported after each change.

### Every new Prisma migration must enable RLS on the tables it creates
The database is Supabase, and `ALTER DEFAULT PRIVILEGES` in `public` grants **every newly created table** to `anon` and `authenticated` with ALL privileges — SELECT, INSERT, UPDATE, DELETE, TRUNCATE. Prisma emits no RLS statements, so a migration that only does `CREATE TABLE` ships a table that anyone holding the project's public anon key can read *and* delete through PostgREST.

All existing tables have RLS enabled with **zero policies**, which is the correct posture here rather than an unfinished one: with no policy, RLS denies the PostgREST roles everything, while the backend connects as the table owner (`postgres`) and owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set. So the backend is unaffected and the public roles get nothing. Verified by experiment: as `anon`, a `SELECT` against an RLS-enabled table returns zero rows, while the same query against an identical table without RLS returns the data and a follow-up `DELETE` removes it.

So every migration that creates a table **MUST** end with:

```sql
ALTER TABLE "new_table" ENABLE ROW LEVEL SECURITY;
```

Do **not** add `FORCE ROW LEVEL SECURITY`: it applies policy-less RLS to the owner too, which denies the backend its own tables. Note the existing tables got RLS out of band (dashboard or manual SQL) rather than from their migrations, so each of them was exposed between deploy and the fix — putting the statement in the migration is what closes that window.

### Migrations run with `deploy`, never `dev`
`pnpm --filter backend prisma:migrate` is `prisma migrate deploy`. There is one database configured here and it is production, so `migrate dev` is the wrong tool twice over: it wants a shadow database, and when it finds drift it offers to **reset** — against this database that is the whole game. It also *would* find drift, because the RLS above was applied out of band on the older tables and is not in their migration files.

`prisma migrate dev` is still available as `prisma:migrate:dev` for anyone pointing `DIRECT_URL` at a scratch database of their own. `db:push` deserves the same caution: it reshapes the database from the schema with no migration recorded, which is how a column disappears without a file saying so.

`prisma.config.ts` sets `connect_timeout=30` on the migration URL. Prisma's default is short enough that a proxy or antivirus doing TLS inspection makes every migration command fail as `P1001: Can't reach database server` — pointing at a database that is up and answering `pg` clients on the same URL at the same moment. Measured behind such an interceptor: the handshake takes ~19s and the engine gives up at ~10s. `sslmode=disable` also makes the error go away and **must not be used**: it works by putting the database password on the wire in clear text.

## Licensing

This monorepo has split licensing; see the table in `README.md`. `contracts/ethereum`, `contracts/solana`, `indexer-go`, `proto`, `protocol`, and `verifier` are MIT; everything else (`frontend`, `backend`, `mobile`, `website`, `shared`, `image-generator`) is PolyForm Noncommercial 1.0.0 (root `LICENSE`). Match the license of whichever package you're editing when adding new files.

`protocol` (`@cryptopets/protocol`) is MIT deliberately: the backend-authoritative battle design (`docs/battle-protocol.md` §H) only holds up if outsiders can run the receipt verifier, and the verifier depends on this package. So it must never import from a PolyForm package (`tests/package.test.ts` enforces it), and it must stay free of clock reads, ambient randomness, and I/O (eslint enforces the first two). The TS combat engine lives here now, re-exported from `shared/src/utils/combat` so existing importers are unchanged.
