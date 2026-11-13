# State and persistence

Untrusted-data validation and Adventure save rules.

## Rules

- Nonconforming input becomes the default value, never partly trusted data.
- Reading never writes. Each Adventure transition saves first, then changes
  controller state or launches a game.
- Change runs only through the `src/app/adventure.ts` transitions, and save
  them only with `persistAdventureRun()`.
- A mid-game save restores only into the run, node, attempt and seed that
  wrote it.
- An interrupted encounter with no restorable save restarts the same attempt
  and seed: node-start side effects are idempotent per attempt, and setup is
  planned once per attempt.
- Leaf modules `adventure-map.ts`, `adventure-route-graph.ts`,
  `adventure-rewards.ts` and `adventure-setup.ts` never import `adventure.ts`,
  which re-exports map names.
- Derive Adventure sub-seeds only with `deriveAdventureSeed`.
- Engine changes that add draws, land plays or card instances update
  `remainingCounterGrowth`.
- Calling `submitAction()` is not success; reconcile with the next snapshot.

## JSON / snapshot validation

Detail for
[Validate and cap untrusted JSON](../../AGENTS.md#validate-and-cap-untrusted-json).
Reuse the guards (`isGameStateLike`, `isAdventureRunState`, …) and
`src/app/validators.ts`; a new persisted shape needs one as strict:

- Counters (`turn`, `nextInstanceId`, `landsPlayedThisTurn`, indexes) reject
  `Infinity` (`JSON.parse('1e309')`), `NaN`, negatives and fractions.
- Fixed values are exact: Adventure opponent decks hold exactly 50 cards.
- Check each union element's `kind` against the known set and drop or default
  unknowns; `Array.isArray` alone proves nothing.
- Cap with `capTail`; capping the head drops the newest events and can desync
  the visible log.
- Back-fill fields older saves lack (`events: []`) on load and in the view
  model; `undefined` never reaches a renderer.

## Switches over snapshot/event shapes

Detail for
[Default branch in union switches](../../AGENTS.md#default-branch-in-union-switches):
formatters return a renderable placeholder (`presentLogEvent` returns
"Unknown event" for `formatLogEventTile` and `formatLogEventText`); selectors
such as `visualEffectForEvent` may return a documented `null`, still from an
explicit `default:`.

## Serialized identity versus display copy

Detail for
[Catalog presentation boundary](../../AGENTS.md#catalog-presentation-boundary):

- `Card.type: 'land'`, the land names, discriminants and field names stay.
  Renaming them to neutral identifiers needs its own versioned migration and
  never rides along with a copy change.
- Keep the legacy `AdventureOpponentDeck.label`, but show one derived from
  the validated `kind` and `lands`.
- Recordings and their `log` are never rewritten; known legacy lines may be
  translated for display, and unknown text stays escaped.
- **Summons attempted (both players)** shows `totalCardsPlayed`: every
  submitted summon, including intercepted ones.

## Controller hygiene

See also [Status-message ordering](../../AGENTS.md#status-message-ordering).

- Features never clear each other's keys: `backToLobby()`,
  `importRecordingJson()` and a non-Adventure `startGame()` never write or
  delete Adventure progress.
- Build the inactive Adventure state only with
  `createInactiveAdventureState()`.
- Write only at commit points, never per action: a run holds up to ten 50-card
  decks, so the summon counter changes in memory.
- Set `hasSavedRun: true` only after the write succeeds.
- A paused run never blocks `startReplay()`; an open Adventure does.
- A refused result leads with its outcome (the board's winner text is not a
  live region); `adventure-controller.test.ts` pins Adventure status copy.
  See [Status announcements](three-interface.md#status-announcements).

## Reentrant UI submissions

`AppController.subscribe()` and `notify()` call listeners synchronously;
`submitAction()` returns nothing and may notify a rejection without advancing
play.

- Trace legality → projected options → renderer interaction → submission →
  notification before changing a stateful control. Reuse shared
  action-resolution helpers and decision/session checks instead of
  duplicating game rules.
- Guard against duplicate submission before calling the controller, which
  may update or dispose the interface first. Cleanup must not dismiss a new
  decision's picker, restore an old selection into a new session, or render
  a disposed interface.
- Reconcile against the latest snapshot, not a status string or an assumed
  async render. After an unchanged-decision rejection, keep still-legal
  selections and allow retry; if legality changed, drop invalid choices and
  never let stale callbacks submit.
- Success never fires twice, rejection never locks the decision, and
  cancellation never submits.

See the
[stateful UI regression matrix](testing.md#stateful-ui-regression-matrix).

## View-model hygiene

Detail for
[Immutable view-model snapshots](../../AGENTS.md#immutable-view-model-snapshots):

- `projectHandCards` names a non-human opponent's cards
  `HIDDEN_HAND_CARD_NAME` (ids and counts may show). Never un-redact
  `players[].handCards`; battlefield panels and the replay log rely on it.
- A reveal is its own field, read from the real `GameState`, cleared when its
  phase ends and never widened by catalog lookups. `revealedEnemyHandForSwamp`
  serves the local human's Drain Memory pick; the AI plays blind by design
  (`src/game/ai-visibility.ts`).
- `AdventureUiState` is frozen, and tier summaries are cached per run object
  and route key: replace a run, never change its route or map in place.

## Adventure run schema (version 2)

`cardgame.adventure-run` holds a version 2 run, `cardgame.adventure-game` an
identity-bound mid-game save. Leaf modules never touch persistence, the
controller, storage, the DOM, randomness or the clock, and boundary tests pin
their imports; `adventure-map.ts` owns pools, map, routes and seeds.

### Adventure product decisions

Approved by the maintainer:

1. Adventure uses a branching encounter map, not a fixed visible line.
2. A fork offers exactly two encounter choices.
3. A map has at most three fork tiers: new runs use three, and saves accept
   zero to three so legacy linear runs stay valid.
4. Every route has six non-boss tiers then one shared boss, keeping the
   seven-win run length; all branches converge on the boss.
5. Rewards are boons/relics: after each non-boss win, pick one of three
   deterministic offers or skip.
6. Losses and draws grant no reward. A loss locks the player into retrying
   the same encounter, preventing route scouting and reward farming.
7. Rewards last only for the current run: no permanent progression,
   currency, shop or unlocks.
8. Unversioned saves stay loadable as linear maps with their exact stored
   opponents and decks.
9. The extra chance on every third consecutive win stays.
10. Browser-only: no Adventure CLI commands and no Adventure state in P2P
    packets.

### Versioning and migration

- A run with a `schemaVersion` key must hold exactly `2` and pass
  `isAdventureRunState`; one without is version 1 and must pass
  `isLegacyAdventureRunState` before `migrateLegacyAdventureRun` converts it
  in memory. Other values (`1`, `3`, `"2"`, `null`) are unavailable, never
  repaired.
- Loading shows a stored `active` run as `paused` in memory only. A converted
  run keeps one unsaved run ID until its next transition first writes it.
- `backfillPreRewardAdventureRun` fills `pendingReward` (null) and
  `encounterSetup` in memory only for runs missing both, with empty `relics`
  and `rewardHistory`.
- New maps are `branching`; `linear` and converted `legacy-linear` maps stay
  valid until those runs finish. Guards fail closed per map kind and stage
  (`adventure-fuzz.test.ts`).
- Every version 1 run the app could write must convert, and every earlier
  version 2 run must still read (`src/test/fixtures/adventure-v1-saves.json`,
  `adventure-v2-pre-reward-saves.json`). A stricter version 2 limit needs a
  rejection test for hand-edited data.

### Save path and identity

- Transitions copy their input (`cloneAdventureRun()`), throw on an invalid
  result and return null for a rejected node or reward;
  `persistAdventureRun()` refuses an invalid run.
- A refused write leaves state and controls unchanged, with the storage
  warning as the status. Start and node start write the run, then clear the
  game slot.
- A terminal result writes the high score, then removes the run (a refused
  removal counts only if a read shows the key gone). If a result write fails,
  `pendingCompletion` keeps the outcome and the finished board; Retry
  reapplies it to a fresh copy of the run, and only Reset navigates meanwhile.
- Commands re-read the latest state and treat IDs as untrusted; a stale or
  repeated Start or node start does nothing.
- `createAdventureRunId()` uses `crypto.getRandomValues` (`randomUUID` is
  missing on insecure LAN origins); never derive a run ID from a seed.

### Attempts and setup

- `selectAdventureNode` takes only an exact `current` or `available` node ID
  at `map` (`adventure-map.test.ts`); `adventureRouteNodes` derives route
  statuses, which are never stored.
- `selectedNodeId` stays fixed through retries, which advance the attempt and
  its seed; restarting the same attempt uses no chance.
- Each `planAdventureEncounterSetup` call uses a Scout's Cache charge, so only
  `startAdventureEncounter` calls it, once per attempt. The saved setup is
  reused on restarts and cleared by results; charges are never refunded.
  Launch games only through `adventureEncounterLaunch`.
- `openingHandSizes` is per player (`[H, 5]`); the engine never sees a reward
  ID.
- `deriveAdventureSeed` mixes fixed purpose tags and lane numbers with integer
  operations, never string hashes, labels, `Math.random` or the clock. Base
  seeds are `Date.now()` values above 2^32, but `lcg()` and `shuffle()` keep
  only `seed >>> 0`: fold both 32-bit halves into every sub-seed
  (`adventure-map.test.ts` pins this).

### Rewards

- Changing `ADVENTURE_REWARD_IDS` order, the offer seed words or an effect
  needs an `ADVENTURE_REWARD_RULES_VERSION` bump and repinned offer tests.
  Store IDs; copy comes from `adventureRewardCatalogEntry`.
- "Reachable Adventure reward states" in `src/test/adventure-rewards.test.ts`
  proves every reachable six-pick inventory still has at least three eligible
  choices. If a catalog change breaks it, grow the catalog instead of adding
  an unchecked fallback.
- Only `resolveAdventureEncounterResult` creates an offer, from the run alone,
  so Retry Saving Result rebuilds it; save it with its `rulesVersion` and
  never reroll or reorder it. Boss wins get none.
- Choices are untrusted: anything but an eligible ID of the run's next offer
  is refused and writes nothing; a refused write keeps the offer.
- Relics protect only the real chances and streak; the run fails when those
  chances reach zero. `scoreEligibleChances` and `scoreEligibleWinStreak` take
  the unprotected result, so rewards never raise the score.
- Never add reward data to recordings, replay or P2P; relic setup lives in the
  recorded initial `GameState`.

### Counters and limits

- Run counters, `baseSeed`, `attemptSeed` and `attemptOrdinal` pass
  `isNonNegativeSafeInteger`. `incrementAdventureCounter` stops at
  `Number.MAX_SAFE_INTEGER` and `computeAdventureScore` clamps, so accepted
  runs can always finish, pause, save and read back their high score.
- In a mid-game save, `turn` and `nextInstanceId` plus their
  `remainingCounterGrowth` (`src/game/engine.ts`) stay within
  `Number.MAX_SAFE_INTEGER`, or Resume restarts the encounter. Only End Turn
  raises `turn` (drawing, or ending an empty-deck game), only a resolved land
  play raises `nextInstanceId`, and decks never refill.
- A mid-game save keeps the latest `ADVENTURE_GAME_LOG_CAP` (1,000) log
  entries and events and at most 50 cards per player;
  `adventure-persistence.test.ts` keeps both slots under 64 KiB.

### Resume

- `resumeAdventure()` restores an envelope only into a stored run `paused` at
  `encounter` whose run ID, node ID, attempt ordinal and attempt seed match,
  if the game is not over and the run write succeeds; writing the run
  `active` first stops a second restore.
- Only `pauseAdventure()` writes `paused` at `encounter`, after its envelope
  write succeeds; a failed run write removes the envelope, and either refusal
  keeps the game open. A leftover envelope beside an `active` run never
  restores. Slot deletion is best-effort; identity matching is the safety
  boundary.
- Otherwise Resume opens the map without writing and warns if a mid-encounter
  game was lost.

## Adventure-specific rules

- Snapshot players have ids `0` then `1`; the engine builds instance ids and
  logs from `player.id`.
- `landsPlayedThisTurn` stays within the one-land-per-turn ceiling.
