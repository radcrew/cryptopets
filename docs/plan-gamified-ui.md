# Gamified UI

The web app reads as software: verb pages, forms, numbers first. This plan moves it toward a game
while every existing feature keeps working. The reference is the clickable game-feel prototype
(Shore hub, Pulse countdown, egg hatch, loot chest, Tower, Hall of Champions, Team 3v3 board).

## Principles

- **Design system first.** Restyle the shared UI kit (`NeonButton`, `NeonCard`, `TabSwitch`) and
  the app shell before touching any feature, so every page changes at once and no feature code
  moves. Props and class names stay stable, so existing tests keep passing.
- **Features stay where they are.** Routes, hooks, controller hooks and chain flows are not
  rewritten. New scenes compose the same `@shared/core` hooks the current pages use.
- **No new runtime dependencies.** Sound is synthesised with the Web Audio API, motion is CSS and
  the Web Animations API, particles are a small canvas.
- **Respect the player.** Sound has a persisted mute switch and only starts after a user gesture.
  `prefers-reduced-motion` stills looping effects.
- **Web only.** Sound, particles and scenes live in `frontend`, not `@shared/core`, because they
  depend on browser APIs that React Native does not have.

## Phases

| Phase | Scope | Verification |
|---|---|---|
| 1. Foundation | Game fonts (Bungee display, Fredoka body) and motion tokens. Chunky 3D `NeonButton`, `TabSwitch`, top bar and sidebar. Sound provider with a mute switch, button taps and toast cues. | `pnpm --filter frontend lint:check`, `test`, `build`, and a visual pass on every route |
| 2. The Shore | `/main` becomes a living scene of the player's own pets with places that open existing routes (Arena, Nest, Hall, Bag, Training). The Pulse orb follows the real drand quicknet clock. The gallery stays on the page. | Same commands, plus wallet-connected and disconnected visual passes |
| 3. Battle feel | Pulse countdown before a fight resolves, damage pops, critical shake, victory and defeat stamps, for duels and Team 3v3, driven by the existing battle controller hooks. | Same commands, plus the battle hook tests |
| 4. Feature scenes | Breeding egg hatch, level-up and training bursts, inventory loot reveal, leaderboard podium. | Same commands |
| 5. Game frame | The dashboard frame goes: no sidebar, no top bar. Every page is drawn on a full-screen scene (the Shore, the arena, the nest, the Hall of Champions, the market), with a game HUD over the top and a dock over the bottom. The Shore becomes the whole home screen and the gallery moves to `/pets`. This also replaces the old phone layout, where the sidebar took most of a small screen. | Same commands, plus desktop and 390px visual passes |

## Status

- Phase 1: done on `feat/gamified-ui`. Every route checked visually at desktop width.
- Phase 2: done. The Shore sits above the gallery on `/main`. Its size follows the scene's own width through a container query, because a pinned sidebar makes the scene far narrower than the window. Below 820px of scene width only the Hall, Nest and Arena are drawn; the other doors stay in the sidebar. Only the Battle Arena accepts a preselected pet today, so a pet's card offers Battle and nothing else.
- Phase 3: done. Three pieces in `frontend/src/components/game/` serve both the duel and Team 3v3: the Pulse moment, strike pops and the result stamp. The client is never told which drand round a battle committed to, so the Pulse moment shows the live beat while the battle is `accepted` or `committed`, and never claims a round number. Checked visually on the battle overlay preview; a live team battle was not run, since it needs a wallet signature.
- Phase 4: done. One `Celebration` card in `frontend/src/components/game/` opens from a success each feature already reported: a level-up (always exactly one level on chain), training (the XP bar fills only to what the refreshed pet list reports), breeding (an egg cracked in three taps; the child is found by name among pets that did not exist before), and an inventory claim (a chest). Escape closes it at any stage. The leaderboard's existing podium is restyled as plinths with medals and a crown. The cards were checked visually through the battle overlay preview; the podium was not, since the leaderboard needs a signed-in session.
- Phase 5: done. The sidebar, top bar and pin hook are deleted; their behaviour moved rather than vanished. The HUD shows the player's real rank and wins (the old rank footer), the placeholder daily quests behind a scroll key, the sound switch and the wallet. The dock has keys for Pets, Nest, Battle, Bag and Ranks, and a More sheet lists every page, with team battles only while the backend accepts them. Page panels are translucent so their scene shows through, and the arena has the prototype's Duel or Team 3v3 switch. On a phone the HUD puts the wallet on a second row.
