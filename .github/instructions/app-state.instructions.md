---
applyTo: "src/app/**"
---

# App state and Adventure

Details: [state-and-persistence](../../docs/agent/state-and-persistence.md).

- Change Adventure runs only through the `src/app/adventure.ts` helpers. A
  transition saves with `persistAdventureRun()` before replacing controller
  state or launching a game; a refused write leaves state and controls
  unchanged. Navigation never writes the run: Resume without a restorable
  game shows `openAdventureMap(stored)` unsaved.
- Each new kind of hub decision must change `adventure.decisionKey`, which
  `view-model.ts` builds from the run, route, attempt, pending outcome and
  reward offer. Otherwise `ThreeInterface.latestForAction` accepts stale
  clicks ([three-interface](../../docs/agent/three-interface.md#stable-interaction-state)).
- Reading never writes. Dispatch on `schemaVersion`: exactly `2`, or absent
  for version 1, which converts in memory and is written only by the next
  committed transition. Any other value makes the run unavailable; never
  repair it.
- An interrupted encounter with no restorable save restarts the same attempt
  and seed, so node-start side effects are idempotent per attempt.
  `planAdventureEncounterSetup` spends a Scout's Cache charge: call it once
  per new attempt, persist the setup and reuse it on restarts.
- A mid-game save restores only if its run, node, attempt and seed match.
  Resume needs a run `paused` at stage `encounter`; Pause writes that only
  after the game snapshot write succeeds.
- `adventure-map.ts`, `adventure-route-graph.ts`, `adventure-rewards.ts` and
  `adventure-setup.ts` are leaf modules whose boundary tests pin their
  imports; `adventure.ts` re-exports `adventure-map.ts`, never the reverse.
- Derive Adventure sub-seeds with `deriveAdventureSeed()`, which folds both
  32-bit halves of the base seed in; `lcg()` and `shuffle()` keep only
  `seed >>> 0`.
