# Plan: three-on-three team battles on a tiled map

Working plan for the team battles designed in the investor whitepaper (section 8). This file is
the execution order and the decisions it depends on. Steps are small on purpose: each phase ends at
a command that passes, so the branch is revertible at any point. The golden-vector and
schema-version rules in `AGENTS.md` apply throughout.

Branch: `feat/team-battles-3v3`. **Status: proposed, nothing implemented.**

## 1. What a team battle is

### Rosters, the challenge, and the draw

- **Defence plan.** A defender saves a roster of five pets, each with a rank (1 to 5), a tactic and
  a home tile in their 3×3 zone. The plan is signed, and it doubles as their consent to be
  challenged.
- **Challenge.** The attacker sees the five rival pets on their home tiles, then picks three of
  their own pets, places them in their own zone, chooses a tactic for each, and signs.
- **Draw.** The defender's three fighters are drawn by the battle seed, weighted by rank, without
  replacement. Past battles therefore never reveal the exact lineup.

  ```text
  weight_i = 6 − rank_i
  roll_k   = keccak256(seed ‖ "SQUAD_DRAW" ‖ k) mod Σ weight(remaining),  k = 1, 2, 3
  ```

  | Rank | Weight | Chance of defending |
  |---|---|---|
  | 1 | 5 | 82.6% |
  | 2 | 4 | 75.9% |
  | 3 | 3 | 65.6% |
  | 4 | 2 | 49.0% |
  | 5 | 1 | 26.8% |

### The map

A 6×3 board: each side owns a 3×3 zone. Columns are numbered from the attacker's back line:
attacker back 0, mid 1, front 2; defender front 3, mid 4, back 5.

- **Front line:** the enemy's occupied column closest to the middle. When it falls, the next
  column becomes the front.
- **Reach:** magic reaches any enemy. A physical strike reaches as far as the pet's Range allows:
  Melee hits the front line only, Reach also hits the column behind it, Ranged hits any tile (at
  85% damage beyond the front line).
- **Neighbours:** same side and `|Δx| + |Δrow| = 1`. Support effects reach neighbours only.

### A round

- All standing pets act once per round. Order: pets without Shell before Shell pets, then higher
  Speed, then Swift, then the attacking side, then the lower slot. A knocked-out pet loses its turn.
- Each strike rolls physical or magic first, then the pet's tactic picks a target among the
  enemies it can reach. Tactics read only the visible state of the fight, so they need no
  randomness and replay identically.

  | Tactic | Targets |
  |---|---|
  | Focus | The enemy with the lowest share of HP left |
  | Breaker | The enemy with the highest INT |
  | Hunter | An enemy this pet's element beats, otherwise Focus |
  | Bodyguard | Whoever last hit the most injured teammate, otherwise Focus |

- Rolls: `roll = keccak256(rs_r ‖ 2·p + k) mod 10,000`, where `rs_r` is the round seed and `p` is
  the pet's position in this round's turn order.
- Damage follows today's strike steps (`protocol/src/combat/strike.ts`), with gear already in the
  stats, then in this order, each step floored:

  ```text
  element             × 85, 100 or 115 / 100
  Ranged long shot    × 85 / 100      (physical, beyond the front line)
  Fury                × 130 / 100     (low HP, or a teammate knocked out)
  Temperament         × 105 / 100     (the tactic suits the pet)
  Combo               × (100 + 10·n) / 100   (n earlier teammate hits on this target this round)
  Expose              × 120 / 100     (used once)
  Critical            × 150 / 100
  ```

### Cooperation

| Who | Mechanic | Rule |
|---|---|---|
| Everyone | Combo | Each earlier teammate hit on the same target in the same round adds 10%; resets every round |
| Cunning | Expose | A critical hit marks the target; the next teammate to hit it deals 20% extra and uses the mark |
| Tank, neighbours | Guard | Once per battle, a Tank takes a hit that would knock out a neighbour |
| Shell and Sage, neighbours | Auras | +10% DEF (Shell) and +10% MDEF (Sage) to neighbours while the source stands |
| Swift, neighbours | Tailwind | Each neighbouring Swift adds 2% crit chance, within the crit cap |
| Fury | Rally | The 30% bonus also applies when a teammate is knocked out |
| Bloodlust, neighbours | Lifelink | Physical-hit healing goes to the most injured of the pet and its neighbours |
| Rebirth | Second chance | Once per battle, the first teammate knocked out survives with 1 HP |

### Winning, and fairness

- Knock out all three opponents to win. If both teams stand after 30 rounds, the team with the
  higher share of its total HP left wins. An exact tie goes to the defender.

| Rule | How it works |
|---|---|
| Level band | A squad counts as its highest-level pet, so a strong pet cannot hide behind weak ones |
| Consent | The defence plan must cover all five roster pets |
| Daily limit | One team battle counts once against the defender's limit |
| XP | The team result decides win or loss for all three fighters; each earns XP against the highest-level enemy |
| Cooldown | All three fighters get it; benched pets stay free |
| Rewards and drops | Counted once per battle |
| Self-battles | Blocked, including different pets of the same owner (Phase 0) |

### Backward compatibility, by construction

With one pet on each side, face to face, every team and map rule switches itself off: no teammates,
no neighbours, and the only enemy is always in reach. Under today's attributes, turn order, rolls
and the win check must then reduce **exactly** to today's engine. This is a requirement, not a hope:
the first cases in the new vector file replay every `battle.json` fight in this layout (Phase 1).

## 2. Decisions to make first

Each has a recommendation; the phases below assume it unless this section is updated.

| | Decision | Recommendation |
|---|---|---|
| D1 | **Attributes 2.0.** The rules use Speed, Range and Temperament, which do not exist yet. | Build the team engine with them as inputs, and ship team battles first with neutral values (everyone Melee, equal Speed, no temperament bonus). Attributes 2.0 then fills those inputs under a later ruleset version. The cost is a second re-consent when Attributes 2.0 ships; the benefit is not blocking on genes that need a contract upgrade. |
| D2 | **Consent object.** | A new signed object kind, `defensePlan` v1 (roster, ranks, tactics, home tiles, plus today's consent fields). `DefenseAuthorization` v1 stays for duels. |
| D3 | **Locks.** The three defenders are unknown until the seed. | Lock all five roster pets from acceptance until the battle is computed, then release the two benched pets. |
| D4 | **Receipt shape.** | `receipt` v2: a team result, per-pet previous-receipt links for the six fighters (benched pets are not linked), and progression for six pets. `combatLog` v2 records actor and target slots and the guard, expose and second-chance events. |
| D5 | **Duels.** | Keep one-on-one battles for players with fewer than three pets. Team battles are a separate challenge type. |
| D6 | **Chains.** | Base first. Solana battles are paused, and the frozen Solana port is not touched. |
| D7 | **Same-owner battles.** Today only a pet fighting itself is blocked (`backend/src/features/battle/ledger/intent.service.ts`). | Block different pets of the same owner before team battles exist, as its own small PR (Phase 0). |

## 3. How it fits the current code

| Layer | Today | Team battles |
|---|---|---|
| TS engine `protocol/src/combat/` | `simulate()`: one pet against one | A team engine that generalises it. The duel path stays for receipts signed under older rulesets |
| Go engine `services/indexer-go/internal/combat/` | Same, independently written | The same generalisation, written independently from the spec. **Must change with the TS engine** |
| Vectors `contracts/test-vectors/` | `battle.json`, `xp.json`, `equipment.json` | New `team.json`; the existing files are never edited |
| Schemas `protocol/src/domain/schemaVersions.ts` | intent 1, defence 1, snapshot 2, ruleset 2, receipt 1, combat log 1 | intent 2, `defensePlan` 1 (new kind), snapshot 3, ruleset 3, receipt 2, combat log 2. Every older version stays in `SUPPORTED_VERSIONS`, and an absent version still means 1 |
| Public verifier `verifier/` | Replays duel receipts | Also replays team receipts, including the draw, placements and every targeting decision |
| gRPC `proto/cryptopets.proto` | `VerifyBattle` | A new `VerifyTeamBattle`; the old call stays |
| Backend ledger `backend/src/features/battle/` | Intent, accept, snapshot, compute, verify, sign, progression, locks for two pets | Team variants of each (Phase 4) |
| Database | `defense_authorization`, `battle_ledger`, `pet_battle_lock`, `pet_battle_progress` | New tables for defence plans and team battles. Every migration ends with `ENABLE ROW LEVEL SECURITY` and is applied with `prisma migrate deploy` |
| Matchmaking and leaderboard | Single pets, level band by pet | Defence plans as opponents, level band by the squad's highest level; each fighter's win or loss counts |
| Frontend `frontend/src/components/pet/interactions/panels/battle/` | Duel panel over `useBattlePanel` | A team controller hook (it has a multi-step state machine), a defence plan editor, a placement board and map playback |

## 4. Phases

### Phase 0: prerequisites

1. Block battles between two pets of the same owner (D7), with a test that fails before the change.
2. Record the outcome of D1 to D6 in section 2.

*Done when:* `pnpm --filter backend test` passes with the new test.

### Phase 1: the team engine in both languages, and its vectors

1. Write the engine spec in `docs/battle-protocol.md`: integer arithmetic and flooring at each
   step, turn-order tie-breaks, the per-round seed, tactic tie-breaks, the draw, and the 30-round
   rule.
2. Implement it in TypeScript under `protocol/src/combat/` (pure: no clock, no ambient randomness,
   no I/O).
3. Implement it in Go under `services/indexer-go/internal/combat/`, from the spec rather than from
   the TS code.
4. Add `contracts/test-vectors/team.json`:
   - every `battle.json` case as a one-on-one, face-to-face fight, which must match exactly
   - hand-checked small cases for each rule: reach and front-line collapse, neighbours, combo,
     expose, guard, auras, tailwind, rally, lifelink, second chance, the 30-round HP share and the
     defender's tie
   - full three-on-three battles
   - draw cases
5. Add `team.json` to the vector lists in `AGENTS.md`, `CLAUDE.md` and `.github/workflows/parity.yml`.

*Done when:* `pnpm --filter @cryptopets/protocol test` and `go test ./internal/combat` both pass on
`team.json`, and `battle.json`, `xp.json` and `equipment.json` are unchanged and still pass.

### Phase 2: protocol objects and the public verifier

1. `defensePlan` v1, intent v2, snapshot v3 (three attackers with tiles and tactics, five roster
   pets with ranks, tiles and tactics, gear for all), ruleset v3 (map, cooperation values, team
   parameters), receipt v2 and combat log v2, each with hashing vectors in
   `contracts/test-vectors/protocol-*.json`.
2. The public verifier replays team receipts.

*Done when:* `pnpm --filter @cryptopets/protocol test` and `pnpm --filter @cryptopets/verifier test`
pass, and the verifier workflow's existing receipt corpus still verifies.

### Phase 3: the Go verifier service

1. Add `VerifyTeamBattle` to `proto/cryptopets.proto`, regenerate, and serve it from
   `internal/grpcsrv`.
2. Add the backend client next to `backend/src/grpc/verifyBattle.ts`.

*Done when:* `go vet ./...` and `go test ./...` pass in `services/indexer-go`, and the backend client
test passes.

### Phase 4: backend

1. Prisma migrations for defence plans and team battles, each ending with
   `ENABLE ROW LEVEL SECURITY`.
2. APIs: save and revoke a defence plan, list team opponents, submit a team challenge, read a team
   battle.
3. Ledger:
   - accept: consent covers all five, the level band uses the highest level, the daily limit
     counts once, all three attackers are off cooldown
   - lock the five roster pets until computed (D3)
   - snapshot three plus five, with gear
   - compute: draw, then the team engine
   - verify through `VerifyTeamBattle`
   - sign receipt v2
   - progression and cooldowns for the six fighters
   - `battle_history` rows, and drops once per battle
4. A `TEAM_BATTLES_ENABLED` flag, off by default.

*Done when:* `pnpm --filter backend lint`, `pnpm --filter backend test` and the type check pass.

### Phase 5: web frontend

1. Defence plan editor: rank, tactic and home tile for five pets, then sign.
2. Team challenge: the rival's five home tiles, pick three, drag-to-place on the 3×3 zone,
   tactics, a turn-order preview, start.
3. Map playback (strikes, knockouts, guard, expose, second chance), a result screen (damage per
   pet, MVP, XP) and replay.
4. A controller hook for the team flow, with platform-neutral parts in `@shared/core` so mobile can
   reuse them.

*Done when:* `pnpm --filter frontend lint:check`, `pnpm --filter frontend test` and
`pnpm --filter frontend build` pass.

### Phase 6: rollout on Base Sepolia

1. Publish ruleset v3. Defenders save plans, which is their one re-consent.
2. Turn on `TEAM_BATTLES_ENABLED` for testnet.

*Done when:* a full team battle is signed and batched on Base Sepolia, and its receipt verifies with
the public verifier.

### Later, not this ticket

Mobile screens, Attributes 2.0 (D1), season maps and special tiles, battle plans (Attack, Guard,
Break), the relay format, team AI commentary, and balance tuning with a simulation harness.

## 5. Commands

| Package | Command |
|---|---|
| protocol | `pnpm --filter @cryptopets/protocol test` |
| verifier | `pnpm --filter @cryptopets/verifier test` |
| indexer-go | `go vet ./...` and `go test ./...` (from `services/indexer-go`) |
| backend | `pnpm --filter backend lint`, `pnpm --filter backend test` |
| frontend | `pnpm --filter frontend lint:check`, `pnpm --filter frontend test`, `pnpm --filter frontend build` |

## 6. Risks

- **The two engines drift.** Each is written from the spec, and `team.json` is what holds them
  together. A failing vector means a drifted engine; never edit the vector.
- **Rounding.** Every multiplier is an integer step with flooring, in a fixed order. One step out of
  place changes many fights, so each step has its own vector case.
- **Old receipts.** Schema versions are append-only; the verifier workflow's corpus must keep
  passing.
- **Re-consent friction.** Saving a defence plan is a new prompt for every defender. Put the editor
  in onboarding and make the default plan one tap.
- **Availability.** Locking five roster pets per accepted challenge (D3) makes defenders busier.
  Watch how often challenges are refused for locks.
- **Balance.** The whitepaper's simulations show formation matters most, a defensive wall is
  strong, and Bodyguard is weak. Tune through ruleset values, not code.
- **Scope.** Attributes 2.0 and season maps are the obvious creep; both are outside this ticket.

## 7. Open questions

1. D1: ship with neutral attributes, or wait for Attributes 2.0?
2. Should a defender be able to cancel a plan while one of its pets is locked in a battle?
3. How should the leaderboard rank team wins against duel wins: together or on separate boards?
4. What do benched defenders earn, if anything?

## References

- Investor whitepaper, section 8 (team battles) and section 4.8 (Attributes 2.0)
- [`docs/battle-protocol.md`](./battle-protocol.md): §D consent, §E randomness, §F versioned
  combat, §G receipts, §H public replay
- [`AGENTS.md`](../AGENTS.md): the golden-vector and schema-version rules
