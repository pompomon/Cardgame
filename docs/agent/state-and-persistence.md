# State and persistence

Everything that crosses the trust boundary into the app — `localStorage`
reads, imported recording JSON, P2P payloads, snapshot back-fills — must
pass a deep validator. This page captures the invariants that recur most
often in review.

## JSON / snapshot validation

Every JSON value entering the app must pass a structural guard before it is
used. Examples in the codebase:

- `isGameStateLike` (recording load)
- `isAdventureRunState` (schema version 2 Adventure run),
  `isLegacyAdventureRunState` (unversioned version 1 run, checked before
  migration), `isGameStateSnapshot`, `isPlayerStateSnapshot` (Adventure
  mid-game save load)
- `sanitizeLogEvents` (recording log normalization)
- `normalizeStateSchema` (recording back-fill)

When you add a new persisted shape, ship a guard with the same level of
rigor:

- **Reject non-finite numbers.** `Number.isFinite(x)` — `Infinity`/`NaN`
  must not survive (`JSON.parse('1e309')` produces `Infinity`).
- **Reject negatives and fractions for counters.** `turn`,
  `nextInstanceId`, `landsPlayedThisTurn`, round indexes, opponent indexes
  must be `Number.isInteger(x) && x >= 0`. A negative
  `landsPlayedThisTurn` would let a resumed snapshot bypass the
  one-land-per-turn rule.
- **Validate fixed-range fields exhaustively.** Player ids must be
  literally `0` and `1`; deck length must equal the contractual value
  (e.g. 50) for adventure opponent decks.
- **Validate discriminated unions element-by-element.** For each event,
  check `kind` against the known set; drop or default unknowns. Do not
  trust `Array.isArray(x)` alone.
- **Cap array sizes; keep the tail.** Slice as
  `raw.slice(raw.length - MAX_PARSED_LOG_EVENTS)` so the most recent
  entries are preserved. Capping from the head (`slice(0, MAX)`) drops the
  events users most care about and can desync the visible log.
- **Back-fill missing fields safely.** When loading a snapshot saved by an
  older app version, default new fields (e.g. `events: []`) rather than
  letting `undefined` reach renderers.
- **Treat any nonconforming input as the empty/default value**, not as
  partial-validated input. Half-trusted data is worse than no data.

## Switches over snapshot/event shapes

Every `switch (event.kind)` (or any other discriminator-driven switch) must
have a `default:` branch that returns a value matching the function's
documented contract — never an accidental `undefined` fall-through.

- **Formatter/rendering paths** (e.g. `formatLogEventTile`,
  `formatLogEventText`) whose callers always render the result must return
  a safe placeholder such as `{ kind: 'unknown', text: '???' }`. Returning
  `undefined` will crash callers downstream.
- **Selector/lookup paths** where "no result" is a normal outcome (e.g.
  `visualEffectForEvent` in `src/app/visual-effects.ts`, which returns `null`
  for events with no animation recipe) may return that
  documented sentinel (`null`/`undefined`) — but the `default:` branch
  must still be present so unknown discriminants take the safe path
  explicitly.

## Serialized identity versus display copy

The creature terminology is a presentation layer over stable compatibility
contracts:

- Engine cards, actions, events, saves, and network packets retain
  `BasicLand`, the `Forest`/`Island`/`Mountain`/`Plains`/`Swamp` values,
  `Card.type: 'land'`, and existing discriminants and field names. Preserve the
  canonical `BASIC_LANDS` order because it affects deterministic decks,
  recordings, and peer state.
- `src/app/card-catalog.ts` maps those keys to player-facing names, abilities,
  rules text, visual roles, and ASCII asset slugs. Display names and slugs must
  never replace a key in trusted state, mechanical parser input, storage,
  recording JSON, or P2P payloads. Presentation-only grouping and resource-cache
  keys may use display metadata; they must not drive mechanical identity or legality.
- `src/app/game-presentation.ts`, `log-presentation.ts`, and `view-model.ts`
  derive immutable display snapshots. Renderers and the CLI consume those
  projections instead of maintaining another key-to-copy map.
- `AdventureOpponentDeck.label` remains a legacy serialized field. Accept and
  preserve it on load, but derive the visible opponent label from validated
  `kind` and `lands`; never render persisted label text verbatim.
- Recording versions 1 and 2 continue to import without schema churn.
  Structured event identities, ability lookups, and creature/ability wording in
  event framing are formatted through the catalog; there are no hardcoded
  tutorial/log exceptions. A generic `draw` event carries no ability-source
  field, so its display must not attribute the draw to Listen In.
  Known legacy text-log templates may be translated conservatively for display,
  but neither the recording nor its stored `log` array is rewritten; unknown
  text remains escaped and unchanged.
- P2P `action` packets retain only legacy action discriminants and mechanical
  fields. Display names, ability copy, and asset slugs must not enter the wire
  format, so old-copy and new-copy peers apply the same deterministic action.
- Player-facing **Drain Memory** still uses the legacy Swamp target fields.
  Opponent card identities remain redacted everywhere except the existing,
  actor-scoped legal target projection described below; catalog lookup must
  never widen that visibility.
- Browser-only inline rules and full previews for visible Hand, Board, and
  Discard pile creatures use projected data, not extra controller access or
  schema changes. They add no CLI inspection access.
- Adventure's **Summons attempted (both players)** label retains the serialized
  `totalCardsPlayed` counter and its existing semantics: both players' submitted
  summons count, even if intercepted. It is not a count of resolved summons.

## Controller hygiene

These patterns come up repeatedly:

- **Don't clear unrelated persisted state from a feature action.**
  `importRecordingJson()` must not delete a saved adventure run. Each
  feature owns its own keys.
- **Centralize "inactive adventure baseline".** The same object literal
  was duplicated across the constructor, `refreshAdventureFromStorage()`,
  and the reset path. Use `createInactiveAdventureState()`; otherwise
  fields drift.
- **Avoid redundant persistence.** `pauseAdventure()` writes the mid-game
  save and then the paused run once, then resets the UI with
  `resetToLobby()`. Every Adventure transition is saved when it happens, so
  `backToLobby()` and `startGame()` never write Adventure progress.
- **Don't write large objects to `localStorage` on every action.**
  Saving the run on every `play_land` would synchronously JSON-stringify the
  whole map, up to ten 50-card decks. The summon counter changes in memory;
  write only at commit points (node start, result, explicit pause).
- **Don't silently overwrite warning statuses.** If a refused Adventure
  write puts a "storage unavailable" warning in `state.status`, a later
  unconditional `state.status = 'Adventure started.'` hides the failure
  from the user. Either surface the warning last, or only set the success
  status when persistence succeeded.
- **Only set `hasSavedRun: true` after the write actually succeeded.**
  The persistence layer intentionally swallows write failures; mirror that
  state honestly in `hasSavedRun`. Otherwise the UI advertises a resumable
  run that `resumeAdventure()` will fail to load.
- **Don't block replay on a paused adventure run.** A saved-and-paused
  adventure is exactly the state where the user might want to import a
  recording. `startReplay()` must not refuse merely because a paused run
  exists. It refuses only while Adventure mode is open.
- **Don't auto-clear an active adventure run on unrelated `startGame()`
  calls.** If a tab closed mid-round leaves the run as `active` in
  storage, starting a casual non-adventure mode must not silently delete
  the saved progress.

## Reentrant UI submissions

`AppController.subscribe()` and `notify()` invoke listeners synchronously.
`submitAction()` returns no acceptance result and can notify a rejection without
advancing gameplay. Renderer code must not equate calling it with success.

- Trace engine legality → projected options → renderer interaction →
  controller submission → notification before changing a stateful control.
  Reuse shared action-resolution helpers and existing decision/session checks;
  never duplicate game rules in a renderer.
- Establish duplicate-submission protection before invoking the controller.
  A notification may update or dispose the interface before the call returns.
  Post-submit cleanup must not dismiss a new decision's picker, restore an old
  selection into a new session, or render a disposed interface.
- Reconcile against the latest controller snapshot, not a status-message string
  or an assumed asynchronous render. On unchanged-decision rejection, preserve
  or restore still-legal pending selections and permit retry. If legality has
  changed, discard invalid choices without allowing stale callbacks to submit.
- Keep success, rejection, and explicit cancellation distinct. Successful
  submission must not fire twice, but rejection must not permanently lock the
  decision. Cancellation must not submit an action.

Use the [stateful UI regression matrix](testing.md#stateful-ui-regression-matrix)
for changes to target pickers, response controls, and shared submission paths.

## View-model hygiene

- **Project immutable snapshots.** `buildViewModel` must not return
  `adventure: state.adventure` (live reference). Build an
  `AdventureUiState` (or similar) shape and copy fields. The same applies
  to `game`, `players`, etc. — every existing path already does this; new
  fields must follow.
- **Back-fill on the way out.** If a renderer needs `game.events` and an
  older snapshot might not have it, default to `[]` here so renderers
  never see `undefined`.
- **Scoped hand reveals.** `projectHandCards` redacts a non-human opponent's hand
  to `HIDDEN_HAND_CARD_NAME` in AI and P2P modes. The view model
  may *narrowly* widen visibility for the Drain Memory decision (internally,
  `revealedEnemyHandForSwamp` is populated only while the local human is
  choosing a Swamp discard target, in `swamp_target` or `plains_target`
  phase).
  The reveal must (a) read from the real `GameState`, not the redacted
  projection, (b) be exposed as its own field — never by un-redacting
  `players[].handCards`, which other surfaces (battlefield panels,
  replay log) rely on — and (c) clear automatically once the decision
  phase ends. The AI side continues to play Swamp without enemy-hand
  visibility (see `src/game/ai-visibility.ts`); the resulting asymmetry
  is intentional.
- **Hidden-hand contract.** When a local human opposes an AI or remote peer,
  `players[].handCards` for the opponent may expose stable card ids and counts,
  but every card name must be `HIDDEN_HAND_CARD_NAME`. Do not unredact that
  array for convenience; any intentional reveal must live in a separate,
  narrowly scoped view-model field and disappear when the relevant decision
  phase ends. Keep those fields as projected snapshots, not references to
  controller-owned `state.game` or `state.adventure` objects.

## Adventure run schema (version 2)

`cardgame.adventure-run` holds a schema version 2 run and
`cardgame.adventure-game` holds an identity-bound mid-game save. Both keys
keep their names; only their formats changed.

- **Dispatch on the version key.** A payload with a `schemaVersion` key must
  be exactly `2` and pass `isAdventureRunState`. A payload without the key is
  version 1: it must pass the strict `isLegacyAdventureRunState` guard first
  and is then converted in memory by `migrateLegacyAdventureRun`. Any other
  value (`1`, `3`, `"2"`, `null`, …) makes the run unavailable; never repair it.
- **Reading never writes.** The constructor, `refreshAdventureFromStorage()`,
  `importRecordingJson()`, and lobby navigation show a stored `active` run as
  `paused` in memory only. A loaded or converted run is written only by the
  next committed transition: a node start, Pause, a result, or a Resume that
  restores a saved game. `backToLobby()`, `startGame()` and
  `importRecordingJson()` never write Adventure progress.
- **One change and save path.** Change runs only through the helpers in
  `src/app/adventure.ts` (`startAdventureEncounter`, `openAdventureMap`,
  `resumeAdventureEncounter`, `pauseAdventureRun`,
  `resolveAdventureEncounterResult` or its `applyAdventureEncounterResult`
  wrapper, `chooseAdventureRunReward`, `skipAdventureRunReward`). They copy
  their input and throw on an invalid result. `startAdventureEncounter` and
  the two reward helpers return null for a rejected node, offer or reward.
  Save with `persistAdventureRun()`, which refuses a run that fails the
  guard. Copy runs with `cloneAdventureRun()`, which copies only known
  fields, deeply.
- **Milestone 1 rules.**
  - `stage` is `map` or `encounter` for a resumable (`active`/`paused`) run;
    Milestone 5 adds `reward`. Finished runs have no stage, selected node, or
    attempt seed.
  - `map.kind` is `linear` for runs created by Milestones 1–2, where only
    the final tier is a mono boss, or `legacy-linear` for converted runs,
    where any known kind may be last. Keep accepting both kinds until such
    runs finish. New runs use `branching` (see the Milestone 3 rules).
  - Exactly seven tiers, each with one `center` node. The guard recomputes each
    node ID (`tier-N-center`) and rejects mismatches.
  - Opponents keep the legacy `label`, a known `kind`, one to five unique known
    lands, and a 50-card deck with unique card IDs. Strings are length-limited.
  - `currentTierIndex` is 0–6. `completedNodeIds` lists one node per finished
    tier in order, or all seven for a completed run. `selectedNodeId` is a node
    of the current tier and stays fixed through retries; it and
    `attemptSeed` are required at `encounter`.
  - Counters are finite, non-negative integers. `relics` and `rewardHistory`
    were reserved and empty until Milestone 5 (see the Milestone 5 rules).
- **Milestone 2 rules.**
  - **Ownership.** `src/app/adventure-map.ts` owns opponent pools and decks,
    map types, node IDs, `isAdventureMap`, the shared route check
    `isAdventureRouteState`, seed derivation, the branching generator, and the
    route rules. It is a leaf module that imports only `game/cards`,
    `game/types`, and `app/validators`, never `adventure.ts`, persistence, the
    controller, storage, or the DOM. Imports go one way: `adventure.ts` uses
    the map module and re-exports the names other modules already import.
    `adventure-map.test.ts` checks the imports.
  - **Map kinds.** `isAdventureMap` applies rules per kind. `linear` and
    `legacy-linear` keep the Milestone 1 rules. A `branching` map has seven
    tiers; tiers 1–6 hold `[center]` or `[left, right]` in that order; its
    forks are one of `ADVENTURE_FORK_PATTERNS` (tiers {1,3,5}, {1,3,6},
    {1,4,6}, or {2,4,6}); tier 7 is a single `center` mono boss with no mono
    opponent before it; and opponent IDs are unique across the map. Unknown
    kinds fail closed.
  - **Gate (removed in Milestone 3).** `isAdventureRunState` now accepts
    `branching` maps, and `createAdventureRun` uses
    `generateBranchingAdventureMap`.
  - **Seeds.** Derive map and attempt seeds only with `deriveAdventureSeed`:
    a fixed `ADVENTURE_SEED_PURPOSE` tag, explicit lane numbers (center 0,
    left 1, right 2), and both 32-bit halves of the base seed, mixed with
    integer-only operations into a 32-bit unsigned seed for the existing
    `shuffle` and `lcg`. Never use string hashes, labels, object-key order,
    `Math.random`, or the clock. `lcg` keeps only `seed >>> 0`, so a raw clock
    seed would ignore its high bits. `adventureAttemptSeed` gives every attempt
    number at a node its own seed. Changing a tag, lane number, or the mixing
    changes every derived seed; the pinned test makes that deliberate.
  - **Route statuses** are derived by `adventureRouteNodes`, never stored. In
    completed tiers the won node is `completed` and its sibling `bypassed`. In
    the current tier of a resumable run, a selected node is `current` and its
    sibling `bypassed`; with nothing selected, a single node is `current` and
    fork nodes are `available`. Later tiers, and the current tier of a failed
    run, are `locked`. `boss` marks the final tier by position.
  - **Selection rejection.** `selectAdventureNode` treats the node ID as
    untrusted. It accepts only a string that exactly matches a `current` or
    `available` node of the current tier, on a resumable run at the `map`
    stage. Anything else — non-strings, case or whitespace variants,
    prototype-style keys, bypassed, completed, or future nodes, the boss
    early, or the sibling of a node locked in for retry — returns null without
    throwing or changing the run. A successful selection keeps the attempt
    number and any stored seed, and derives a seed only when none is stored.
  - `retryAdventureNode` and `completeAdventureNode` throw unless the state is
    an active encounter. All route rules leave their input unchanged and
    return fresh route fields with no opponents or decks.
- **Milestone 3 rules.**
  - **Stages.** A new run starts `active` at `map` with no selected node and
    no attempt seed. Starting a node moves to `encounter`. A non-terminal
    result returns the run `active` at `map`; since Milestone 5, a non-boss
    win waits at `reward` first. A terminal run has no stage.
  - **Save first.** Build the candidate with the `adventure.ts` helpers,
    persist it, and only then replace controller state or launch a game. A
    refused write leaves state and controls unchanged, with the storage
    warning as the status. Write order:
    - **Start:** run write, game-slot clear, then the hub.
    - **Node start:** run write, game-slot clear, then `createInitialGame`
      with the arguments from `adventureEncounterLaunch(run)`.
    - **Pause mid-encounter:** envelope write, then the paused-run write. If
      the run write fails, clear the envelope and keep the game open.
    - **Resume with a matching save:** run write, launch the game, then clear
      the slot.
  - **Completion.**
    - A non-terminal result writes the next run.
    - A terminal result writes the highest of the stored, in-memory and new
      scores as the high score, then removes the run key. A refused removal
      counts as success only when a successful read confirms the key is
      absent; an unreadable slot counts as failure (also for Reset).
    - If any write fails, memory keeps the pre-result run, the game-over
      board and `pendingCompletion` with the exact outcome. Retry applies
      the outcome again to a fresh candidate from the same run, so nothing
      is applied twice.
    - While a result is pending, every navigation action except Reset is
      blocked.
  - **Navigation never writes.** `backToLobby()`, `startGame()` and
    `importRecordingJson()` re-read storage and never write or delete
    Adventure progress. Leaving mid-encounter without Pause loses the live
    game; Resume then opens the map, and the committed attempt restarts
    without using a chance.
  - **Commands re-read the latest state.** `startAdventureNode(nodeId)` does
    nothing unless all of these hold: Adventure is open, there is no game,
    no replay and no pending result, and the run is resumable. It treats the
    node ID as untrusted. A repeated Start while a run is open does nothing.
  - **Projection.** The `AdventureUiState` snapshot is frozen. Tier
    summaries contain no decks and are cached in a `WeakMap` by run object
    and route key, so never change a run's route or map in place; replace
    the run object. The summon counter is the only field changed in place.
    It is not part of the route key and does not affect the cached tiers.
    `decisionKey` (`runId|route|attempt|pending|offer`) changes with every
    committed route or reward decision and is part of `threeDecisionKey`.
- **Milestone 4 rules.**
  - **Wired in by Milestone 5.** The reward rules stay pure. Milestone 5
    calls them from the run transitions and relaxes the run guard to
    `isAdventureRewardHoldings` plus run-level checks (see the Milestone 5
    rules).
  - **Ownership.** `src/app/adventure-rewards.ts` owns the reward catalog,
    reward guards, eligibility, offers, choose and skip, relic charges, and
    loss protection. `src/app/adventure-setup.ts` owns opening-hand setup.
    Both are leaf modules that never import `adventure.ts`, persistence, the
    controller, storage, or the DOM; their tests check the imports.
    `adventure-map.ts` adds `parseAdventureNodeId` and `adventureRewardSeed`
    (the reserved `rewardOffer` purpose) and now owns
    `AdventureEncounterOutcome`. The engine knows only the generic
    `openingHandSizes` option and never sees a reward ID.
  - **Catalog and version.** `ADVENTURE_REWARD_IDS` order, the offer seed
    words, and the effects are rules version 1. Changing any of them changes
    what a seed offers: bump `ADVENTURE_REWARD_RULES_VERSION` and repin the
    offer tests. Store only IDs; reward names and rules text are display
    copy.
  - **Eligibility and offers.** Second Wind is offered until taken twice, a
    unique relic until it is owned, and a charged relic while it holds fewer
    than two charges. `generateAdventureRewardOffer` derives the offer from
    the base seed, the source node, and the number of resolved offers, so
    regenerating it gives the same choices. Persist the offer anyway: it
    records its `rulesVersion`, and a later rules version would generate
    different choices. There is no reroll.
  - **Choose and skip.** `chooseAdventureReward` treats the choice as
    untrusted. It returns null unless the offer is the run's next one and the
    choice is exactly one of its IDs and still eligible. Skip records
    `rewardId: null`. Both return fresh `remainingChances`, `relics`, and
    `rewardHistory` only. Second Wind must never raise the score-eligible
    chances.
  - **Protection.** Apply `applyAdventureLossProtection` to the real chances
    and streak only. On a loss, Guardian Sigil uses a charge only when a
    chance would be lost, and Streak Anchor only when a positive streak would
    reset. Other outcomes change nothing. The score-eligible shadows always
    take the unprotected result.
  - **Setup.** Call `planAdventureEncounterSetup` once per committed attempt,
    because each call uses a Scout's Cache charge, and reuse the stored setup
    on restarts. `adventureEncounterGameSetup` returns
    `openingHandSizes: [H, 5]` with H from 5 to 8, never a shared count. The
    creature guarantee only reorders a copy of the player's deck.
- **Milestone 5 rules.**
  - **Reward stage.** A non-boss win completes its node and advances the
    tier at once, then waits at `reward` with the offer that node earned.
    At `reward`, nothing is selected, the attempt number is 0 and there is
    no seed. `selectAdventureNode` requires `map`, and `startAdventureNode`
    refuses with a notice while an offer waits. `openAdventureMap` keeps
    `reward`, so Resume reopens the offer. A boss win never creates one.
  - **Run guard.** `isAdventureRunState` adds these checks to the holdings
    guard:
    - `pendingReward` is non-null exactly at `reward`. Its source is the last
      completed node, its ordinal equals the history length, and every
      choice is still eligible.
    - `rewardHistory` names the latest resolved offers' source nodes in
      route order, with no gaps. Earlier tiers may lack entries, for runs
      saved before rewards existed.
    - `encounterSetup` is required at `encounter`. At `map` it is allowed
      only with a kept node and seed, and other stages have none.
  - **Pre-reward back-fill.** Milestones 1–4 wrote version 2 runs without
    `pendingReward` and `encounterSetup`. `readStoredAdventureRunRecord`
    passes every payload with a `schemaVersion` key through
    `backfillPreRewardAdventureRun` before the guard. It fills both fields only when both are missing and
    `relics` and `rewardHistory` are empty arrays. `pendingReward` becomes
    null, and `encounterSetup` becomes the default five-card setup at
    `encounter`, otherwise null. Anything else goes to the strict guard
    unchanged. The back-fill stays in memory; never write on read.
  - **Generate the offer inside the result transition.**
    `resolveAdventureEncounterResult` creates the offer from the run alone,
    so Retry Saving Result rebuilds the identical offer. Never generate,
    reroll or reorder an offer anywhere else. Save it, and resolve it only
    through `chooseAdventureRunReward` or `skipAdventureRunReward`.
  - **Setup lifecycle.** `startAdventureEncounter` plans the setup only when
    the run has none, and saves it with the committed attempt, along with
    any Scout's Cache charge it used. A lost-game restart of the same attempt
    reuses it. Every result clears it, and nothing refunds a charge. Launch
    new games only through `adventureEncounterLaunch(run)`. Never call
    `planAdventureEncounterSetup` outside the start transition.
  - **Loss protection.** Relics protect only the real chances and streak.
    The score-eligible counters always take the unprotected result. The run
    fails only when the real chances reach zero.
  - **Reward commands.** `chooseAdventureReward(offerId, rewardId)` and
    `skipAdventureReward(offerId)` re-read the latest state. They do nothing
    for a game, a replay, a pending result or another offer ID. An unoffered
    reward ID shows a notice and writes nothing. They save first:
    - A refused write keeps the offer and shows the storage warning.
    - Success clears `lastResult`, which moves focus to the current tier.

    Pause and Back to Lobby keep the offer: Pause saves it, and Back to
    Lobby writes nothing.
  - **Projection.** `relics` and `pendingReward` are frozen copies. Names and
    rules text come from `adventureRewardCatalogEntry`, never from saved
    data. `lastResult` reports which relic prevented a chance loss or a
    streak reset.
  - **Recordings.** Relic setup lives in the recorded initial `GameState`.
    Never add reward data to recordings, replay or P2P.
- **Milestone 6 rules.**
  - **Exactly-once Pause.** Pause mid-encounter writes the envelope, then
    the paused run. If either write is refused, the live game, its Game Menu
    and the Pause control stay open with the storage warning. The next
    successful Pause writes `[game, run]` once, and Resume restores that
    game once.
  - **A leftover envelope never restores.** Resume restores an envelope
    only when the stored run is `paused` at `encounter`. Only Pause writes
    that state, and only after its envelope write succeeds. If the run
    write and then the envelope removal are both refused, the stored run
    stays `active` next to the leftover envelope. Neither Resume nor a reload
    restores it, and a later Pause replaces it. A restore writes the run
    `active` before the game launches, so one envelope never restores twice.
    For every other leftover, identity matching remains the safety boundary.
  - **Mid-game save caps.** `normalizeGameSnapshot` keeps only the latest
    `ADVENTURE_GAME_LOG_CAP` (1,000) `log` entries and `events`, and the
    guard checks only the kept log tail. Each player may hold at most
    `ADVENTURE_DECK_SIZE` (50) cards across deck, hand, battlefield and
    graveyard, counting a pending land play for its actor. Each zone's
    length is checked before its entries. `turn` and `nextInstanceId` must
    be safe integers.
  - **Safe integers.** Run counters, `baseSeed`, `attemptSeed` and
    `attemptOrdinal` must pass `isNonNegativeSafeInteger`. A hand-edited
    counter can then neither make the score infinite nor make a seed lose
    precision. A version 1 run holding an unsafe value converts to null, so
    it is unavailable. An opponent may list at most five lands.
  - **Counter limit.** Every counter that grows, in the run transitions
    and in the in-place summon counter, goes through
    `incrementAdventureCounter`. That function stops at
    `Number.MAX_SAFE_INTEGER` instead of growing past it, so a run the guard
    accepts can still finish an encounter, pause and save.
    `computeAdventureScore` clamps to the safe integers, so the high score
    it writes always reads back.
  - **High score.** `readStoredAdventureHighScore` accepts only the decimal
    digits `persistAdventureHighScore` writes, up to
    `Number.MAX_SAFE_INTEGER`. Anything else reads as 0.
  - **Budget.** Both slots stay far below the origin quota. These sizes were
    measured from the app's own transitions:
    - The largest run, a won route that claims every reward, is 33,364
      bytes.
    - The largest saved finished AI game is 18,296 bytes.

    The engine logs at most six entries a turn, so real games stay near 600
    entries, well under the cap. Reading and validating the largest run
    takes about 0.17 ms, and the largest envelope about 0.07 ms (Node 26,
    development container). `adventure-persistence.test.ts` keeps both slots
    under 64 KiB and seeded AI game logs under half the cap.
  - **Status copy.** `describeAdventureRelicChargeUse` in
    `game-presentation.ts` describes a used relic charge from the reward
    catalog. The text names the relic, says what the charge did, and gives
    the charges left, or says "used its last charge" at zero.
    `usedAdventureRelicCharges(before, after)` lists the charges a
    transition used. Results keep them in `lastResult.relicsUsed`, which the
    result panel shows.
    - A node start names each charge it used.
    - A restart of the same attempt adds "Same opening as before". It adds
      "; no relic charge used" only when the run holds a charged relic.
    - A Resume that cannot restore a lost game says the encounter restarts
      without using a chance. It adds "or a relic charge" when the run holds
      a charged relic.
    - A draw says no chance was used.
    - A successful Retry Saving Result starts with "Result saved."
    - A refusal straight after the same refusal says "still"
      (`repeatedWarning`), so the status text changes and is announced
      again. The Three interface re-announces any further identical status
      itself.
- **Migration closure.** Every version 1 run the app could have written must
  convert into a run that passes the version 2 guard. Every version 2 run an
  earlier milestone could have written must still read. When a version 2
  limit is stricter than version 1, check that app-written data meets it and
  add a rejection test for hand-edited data that does not. The real captures
  live in `src/test/fixtures/adventure-v1-saves.json` and
  `src/test/fixtures/adventure-v2-pre-reward-saves.json`.
- **Run identity.** `createAdventureRunId()` uses `crypto.getRandomValues`
  (`randomUUID` is missing on insecure LAN origins) with a counter, clock and
  `Math.random` fallback. Never derive a run ID from a seed. A converted
  version 1 run keeps one unsaved ID in memory until its first save; a reload
  before that harmlessly assigns another.
- **Mid-game save identity.** Pause writes an envelope with the run ID, node
  ID, attempt ordinal, attempt seed, and the deeply validated `GameState`.
  Resume restores it only when all of these hold:
  - the run is paused at `encounter`;
  - all four identity fields match;
  - the saved game is not over;
  - the run write succeeds.

  A bare version 1 `GameState`, an invalid slot, or a mismatched envelope is
  never restored. Resume opens the map with the committed node, attempt and
  seed, so the encounter restarts from its attempt seed without using a
  chance. A recovery warning appears when a mid-encounter game was lost.
  Deleting the slot is best-effort cleanup; identity matching is the safety
  boundary.
- **Score counters.** `scoreEligibleChances` and `scoreEligibleWinStreak`
  shadow the real chances and streak, and `computeAdventureScore` reads the
  score-eligible chances. Without rewards they move together. Second Wind,
  Guardian Sigil and Streak Anchor change only the real counters, so a
  reward can never raise the score.
- **Resume status.** A refused write shows only the storage warning.
  Otherwise the status is the success message, followed by the recovery
  warning when a mid-encounter game was lost. At `reward` the status asks
  for a reward choice or a skip.

## Adventure-specific rules

- Validate that the two snapshot players have ids `0` and `1` in that
  order (the engine uses `player.id` to build instance ids and logs).
- Validate `nextInstanceId` is a non-negative integer; the engine relies
  on it as a monotonic counter.
- Validate `landsPlayedThisTurn` is a non-negative integer ≤ the
  one-land-per-turn ceiling.
