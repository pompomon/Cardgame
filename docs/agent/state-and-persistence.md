# State and persistence

Everything that crosses the trust boundary into the app — `localStorage`
reads, imported recording JSON, P2P payloads, snapshot back-fills — must
pass a deep validator. This page captures the invariants that recur most
often in review.

## JSON / snapshot validation

Every JSON value entering the app must pass a structural guard before it is
used. Examples in the codebase:

- `isGameStateLike` (recording load)
- `isAdventureRunState`, `isAdventureOpponentDeck`, `isGameStateSnapshot`,
  `isPlayerStateSnapshot` (adventure snapshot load)
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
  `effectDescriptorForEvent` in `src/renderers/phaser/effects.ts`, which
  returns `null` for events with no animation recipe) may return that
  documented sentinel (`null`/`undefined`) — but the `default:` branch
  must still be present so unknown discriminants take the safe path
  explicitly.

## Controller hygiene

These patterns come up repeatedly:

- **Don't clear unrelated persisted state from a feature action.**
  `importRecordingJson()` must not delete a saved adventure run. Each
  feature owns its own keys.
- **Centralize "inactive adventure baseline".** The same object literal
  was duplicated across the constructor, `refreshAdventureFromStorage()`,
  and `setAdventureRun(null)`. Use one factory; otherwise fields drift.
- **Avoid redundant persistence.** `pauseAdventure()` calling
  `setAdventureRun(run)` followed by `backToLobby()` (which re-pauses)
  causes two synchronous `localStorage` writes. Do the work once.
- **Don't write large objects to `localStorage` on every action.**
  Triggering `setAdventureRun(run)` from every `play_land` synchronously
  JSON-stringifies the full 7×50-card lineup. Write on commit boundaries
  (round end, explicit pause), or debounce.
- **Don't silently overwrite warning statuses.** If `setAdventureRun(...)`
  surfaces a "storage unavailable" warning via `state.status`, a later
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
  exists.
- **Don't auto-clear an active adventure run on unrelated `startGame()`
  calls.** If a tab closed mid-round leaves the run as `active` in
  storage, starting a casual non-adventure mode must not silently delete
  the saved progress.

## View-model hygiene

- **Project immutable snapshots.** `buildViewModel` must not return
  `adventure: state.adventure` (live reference). Build an
  `AdventureUiState` (or similar) shape and copy fields. The same applies
  to `game`, `players`, etc. — every existing path already does this; new
  fields must follow.
- **Back-fill on the way out.** If a renderer needs `game.events` and an
  older snapshot might not have it, default to `[]` here so renderers
  never see `undefined`.

## Adventure-specific rules

- Validate that the two snapshot players have ids `0` and `1` in that
  order (the engine uses `player.id` to build instance ids and logs).
- Validate `nextInstanceId` is a non-negative integer; the engine relies
  on it as a monotonic counter.
- Validate `landsPlayedThisTurn` is a non-negative integer ≤ the
  one-land-per-turn ceiling.
