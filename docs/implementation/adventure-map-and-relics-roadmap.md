# Adventure branching map and boons/relics roadmap

> [!IMPORTANT]
> This document is an implementation roadmap, not evidence that the feature,
> migration, automated checks, or browser verification has been completed.

## Status and approved decisions

The following product decisions are approved for implementation:

1. Adventure uses a branching encounter map rather than a fixed visible line.
2. A fork offers exactly two encounter choices. More than two choices are not
   supported.
3. A map contains no more than three fork tiers. New runs initially use three;
   the persisted model accepts zero through three so legacy linear runs remain
   valid.
4. Every route has seven encounter tiers: six non-boss encounters followed by
   one shared boss. A chosen route therefore keeps the current seven-win run
   length and all branches converge on the boss.
5. Rewards use a boons/relics system. A player chooses one of three deterministic
   offers, or skips, after each non-boss victory.
6. Losses and draws do not grant rewards. A loss locks the player to retry the
   same selected encounter, preventing route scouting and reward farming.
7. Rewards affect only the current run. There is no permanent account
   progression, currency, shop, or unlock system.
8. Existing unversioned Adventure saves remain loadable and continue as linear
   maps with their exact stored opponents and decks.
9. The existing extra chance on every third consecutive win remains in place.
10. The feature is browser-only, like the current Adventure mode. It does not
    add Adventure commands to the CLI or Adventure state to P2P packets.

## Implementation checklist

- [x] Milestone 0 — Record the approved design and atomic delivery plan
- [ ] Milestone 1 — Introduce the versioned Adventure aggregate and legacy migration
- [ ] Milestone 2 — Add deterministic two-branch map generation and route rules
- [ ] Milestone 3 — Deliver the branching map as an end-to-end browser flow
- [ ] Milestone 4 — Add the typed boon/relic catalog and deterministic reward rules
- [ ] Milestone 5 — Deliver reward selection and relic application end to end
- [ ] Milestone 6 — Harden persistence, reentrant input, accessibility, and recovery
- [ ] Milestone 7 — Complete documentation, compatibility, and release verification

Each milestone is intended to be a separately reviewable change. It must include
its own focused tests and leave the repository passing the required validation
sequence. Do not defer correctness or trust-boundary tests to a later milestone.

## Current baseline

| Area | Current behavior | Gap to close |
| --- | --- | --- |
| Run model | `AdventureRunState` stores a seven-entry `opponentLineup`, a numeric current opponent, chances, streak, totals, seed, and lifecycle status. | No schema version, map, route choice, reward stage, or relic inventory. |
| Opponents | Six shuffled non-mono opponents followed by one shuffled mono boss. | A new run needs up to three additional non-boss alternatives while retaining a seven-encounter chosen path. |
| Player deck | Every encounter recreates the balanced 50-card starter deck. | Relics need deterministic encounter setup without mutating normal game modes. |
| Progression | A win advances immediately; a loss consumes a chance and retries; a draw retries. Every third win grants a chance. | A win must stop at a persisted reward decision before the next map tier. |
| Persistence | Run state and a mid-encounter `GameState` snapshot use separate local-storage keys and deep validators. | Versioned migration, map/reward validation, and atomic choice commits are required. |
| Controller | A new or resumed run launches an encounter immediately. Encounter completion returns to the main lobby. | Adventure needs explicit map, encounter, and reward stages. |
| View model | Renderers receive an immutable Adventure summary and opponent labels derived from trusted mechanical identity. | It needs immutable map nodes, route status, relics, and reward choices without exposing full decks. |
| Browser UI | The native Three.js interface shows Adventure statistics and a Resume button in the lobby. | It needs a semantic, responsive route and reward hub. |
| Recordings | Adventure encounters record their concrete initial `GameState` and subsequent actions. | Relic-modified setup must remain completely represented by that initial snapshot. |

Relevant implementation seams:

- `src/app/adventure.ts` — run construction, opponent decks, scoring, and
  Adventure snapshot validation.
- `src/app/adventure-persistence.ts` — run storage boundary.
- `src/app/controller.ts` — run lifecycle and encounter transitions.
- `src/app/types.ts` and `src/app/view-model.ts` — immutable renderer contract.
- `src/renderers/three/interface-model.ts`, `interface.ts`, and `interface.css`
  — native map/reward presentation and interaction.
- `src/game/engine.ts` — generic initial-hand setup only; it must not know about
  Adventure or relic identities.

## Goals

- Give the player meaningful route and reward decisions while preserving the
  compact seven-encounter run.
- Make map generation, reward offers, retries, and encounter setup reproducible
  from persisted run data.
- Preserve old saves, existing recordings, stable mechanical card identities,
  scoring fields, and the `totalCardsPlayed` meaning.
- Keep all renderer input untrusted: node and reward IDs are revalidated against
  the latest controller state before mutation.
- Keep Adventure policy in `src/app/`, generic game setup in `src/game/`, and
  HTML/CSS/focus behavior in `src/renderers/three/`.
- Make each transition crash/reload safe without writing the full run on every
  game action.

## Non-goals

- Arbitrary graphs, cycles, route backtracking, more than two choices at a fork,
  or paths with different encounter counts.
- Shops, currency, random events, deck-building rewards, permanent unlocks, or
  metagame progression.
- Relics that add mid-turn actions, change action legality, add new card types,
  or require relic fields in `GameState`.
- Adventure support in the CLI, replay controls, or P2P.
- New artwork, map textures, audio, or service-worker asset policy.
- A high-score reset or change to the legacy score formula. Reward-derived chance
  benefits are excluded from its remaining-chances input as described below.

## Player flow

### New run

1. Starting Adventure creates and persists a complete seeded map and empty relic
   inventory, then opens the Adventure map instead of launching a game.
2. The current tier exposes one encounter or exactly two branch choices.
3. Activating an available node commits that choice and launches its encounter.
   A branch is not committed merely by focus, hover, or preview.

### Victory

1. The controller records the completed node and existing streak/chance updates.
2. A non-boss victory creates and persists one three-choice reward offer tied to
   the completed node.
3. The browser opens the reward screen. The next encounter cannot start while
   that reward remains pending.
4. Choosing or skipping resolves the offer exactly once, advances to the next
   tier, and returns to the map.
5. A boss victory completes the run immediately; it does not create a reward
   that can never be used.

### Loss or draw

- A loss applies any relevant protection relics, then performs the remaining
  existing chance/streak consequences. If chances remain, the selected node
  stays locked for a retry with a new deterministic attempt seed.
- A draw keeps the selected node locked for a retry, consumes no reward or
  protection charge, and does not refund encounter-setup charges such as
  Scout's Cache that were consumed when the encounter was committed.
- Neither result advances the map or creates a reward.

### Pause, reload, and resume

- Pausing during an encounter continues to save the live `GameState` separately.
- Pausing on the map or reward screen saves only the run aggregate.
- Resuming opens the exact persisted stage: map, reward, or an encounter
  snapshot whose envelope matches the saved run and selected attempt.
- A tab closed with an `active` run is surfaced as paused, without discarding its
  selected route, pending reward, relic charges, or attempt seed.

## Branching map contract

### Shape

- A map is an ordered list of seven tiers, not a general-purpose graph.
- Tiers 1–6 are non-boss encounters. Tier 7 contains exactly one mono boss for
  newly generated maps.
- A tier contains either one center node or two left/right nodes.
- At most three of tiers 1–6 contain two nodes.
- New runs use three non-adjacent fork tiers. The base seed deterministically
  selects one of the valid tier patterns.
- Non-adjacent forks guarantee a visible convergence tier between decisions;
  if tier 6 is a fork, both choices converge directly on the boss.
- Edges are implicit between consecutive tiers. Every node in one tier reaches
  every node in the next, which prevents cycles, unreachable nodes, and
  user-controlled edge injection.
- A new map therefore contains ten nodes at most but every completed path still
  contains exactly seven encounters.

The validator accepts zero through three fork tiers. Zero is reserved for
migrated legacy runs, which remain linear rather than receiving new opponents
mid-run. Version 1 accepted any known opponent kind in its seventh slot, so a
version 2 map explicitly marked as migrated legacy data must also accept and
preserve that final opponent. The single final tier is still the run's boss
encounter by position; only newly generated maps require its opponent kind to be
`mono`.

### Node identity and opponents

- Node IDs are deterministic structural IDs based on tier and lane, not random
  UUIDs or display labels.
- Opponent IDs, mechanical creature keys, and 50-card decks remain persisted
  compatibility data. Player-facing labels continue to come from
  `displayAdventureOpponentLabel`.
- New maps choose enough distinct non-boss opponents from the existing standard,
  dual, and random pool to populate every alternative. Mono opponents remain
  boss-only.
- The selected opponent deck is cloned before game creation. Map state never
  passes its stored deck by reference to the engine or renderer.
- The view model exposes only node ID, tier/lane, derived label, mechanical
  roster summary, and derived route status. It never exposes the 50-card deck.

### Route status

Node status is derived rather than persisted independently:

- `completed` — the node appears in the selected path and was won.
- `current` — the only retry node, or an available node in a single-node tier.
- `available` — either of the two choices at an uncommitted fork.
- `bypassed` — the unchosen sibling after a branch is committed.
- `locked` — a future node.
- `boss` is an additional presentation attribute, not a replacement for route
  status.

The controller accepts a node only when it belongs to the current tier and its
latest derived status is `current` or `available`. Stale, bypassed, future,
completed, and unknown IDs are rejected without changing state.

### Determinism

- `baseSeed` is the only wall-clock-derived value and is captured at run
  creation.
- Map layout, opponent selection, opponent deck order, reward offers, and
  encounter attempt seeds use fixed unsigned integer seed derivation and the
  existing seeded shuffle utilities.
- Seed derivation uses stable tier/lane/attempt ordinals, not object iteration,
  localized labels, or implementation-dependent string hashing.
- The active attempt seed is persisted before an encounter launches.
- Retrying increments a persisted attempt counter, so reload does not repeat or
  silently replace a generated attempt.
- Each new run has a persisted, unique run ID independent of its base seed.
  Each committed encounter attempt is identified by its node ID, attempt
  ordinal, and seed; retries and new runs must not reuse an earlier identity.

## Boon and relic contract

### Reward timing and offer rules

- A reward is generated only after winning tiers 1–6.
- Each offer contains three distinct eligible catalog IDs plus a separate Skip
  action.
- Offer generation is deterministic from the run seed, completed node ID, and
  reward ordinal.
- The generated offer, offer ID, source node ID, and catalog/rules version are
  persisted before rendering. Reload never rerolls it.
- Choice payloads contain stable IDs only. Names and rules text come from one
  app-level reward catalog and are escaped by the renderer.
- An offer is resolved at most once. Its source node must be the just-completed
  node, and its choice must still be one of that persisted offer's IDs.
- A chosen reward affects future encounters only.
- No reroll action is included in the first release.

### Initial catalog

The first catalog deliberately avoids ongoing mid-game rules. Effects apply at a
run transition or while constructing a normal initial `GameState`, allowing the
recording's initial snapshot to remain the complete replay contract.

| Stable ID | Player-facing reward | Kind and cap | Effect |
| --- | --- | --- | --- |
| `second-wind` | Second Wind | Immediate boon, at most twice per run | Gain one chance. This is separate from, and compatible with, the existing third-win chance. |
| `guardian-sigil` | Guardian Sigil | Charged relic, maximum two charges | Automatically prevent the next chance loss, then consume one charge. |
| `streak-anchor` | Streak Anchor | Charged relic, maximum two charges | Automatically prevent the next nonzero win streak from resetting, then consume one charge. |
| `prepared-pack` | Prepared Pack | Unique passive relic | Draw one additional opening card in every future encounter. |
| `scout-cache` | Scout's Cache | Charged relic, maximum two charges | Draw two additional opening cards in the next encounter, then consume one charge when that encounter is committed. |
| `gravebloom-charm` | Gravebloom Charm | Unique passive relic | Guarantee at least one Gravebloom Dryad in future opening hands. |
| `signal-charm` | Signal Charm | Unique passive relic | Guarantee at least one Signal Siren in future opening hands. |
| `rooftop-charm` | Rooftop Charm | Unique passive relic | Guarantee at least one Rooftop Gargoyle in future opening hands. |
| `echo-charm` | Echo Charm | Unique passive relic | Guarantee at least one Echo Doppelgänger in future opening hands. |
| `memory-charm` | Memory Charm | Unique passive relic | Guarantee at least one Memory Vampire in future opening hands. |

The catalog contains enough distinct capacity for all six reward screens without
duplicating an option within one offer. Offer eligibility excludes unique relics
already owned and capped boons/charges. A generation test must cover every
reachable six-pick inventory and prove that three eligible choices always
remain; expanding the catalog is preferable to adding an unchecked fallback.

### Effect ordering and limits

1. On loss, Guardian Sigil prevents one chance decrement if a decrement would
   occur.
2. Streak Anchor separately prevents a positive streak reset. If both effects
   apply, each consumes one charge for the consequence it prevented.
3. A draw consumes neither protection.
4. Before encounter creation, guaranteed-creature charms reorder the already
   shuffled player deck without adding, deleting, or renaming cards. Required
   mechanical keys are processed in canonical `BASIC_LANDS` order.
5. Base opening hand size is five. Prepared Pack adds one and Scout's Cache adds
   two, with an explicit maximum opening hand of eight.
6. Scout's Cache is consumed by the persisted start-encounter transaction, not
   by rendering or by `createInitialGame`. A failed commit does not consume it.
7. If multiple charms are owned, each required creature appears in the opening
   hand. Five charms still fit the minimum five-card hand.

`src/game/engine.ts` may receive a generic, validated two-player initial-hand
size option (one count for each player, bounded by deck size) whose default
remains `[5, 5]`. Adventure passes `[playerHandSize, 5]`, never a shared scalar:
Prepared Pack and Scout's Cache change only player 0's opening hand, not the
opponent's. The engine must not import Adventure modules, branch on relic IDs,
or add relic state to `GameState`. Deck reordering and relic policy remain in
`src/app/`.

## Versioned run aggregate

New saves use Adventure schema version 2. The aggregate needs these concepts:

| Field/concept | Purpose and invariant |
| --- | --- |
| Schema and rules versions | Distinguish legacy shape, map rules, and reward catalog semantics. Known versions are handled explicitly. |
| Run identity | A unique persisted ID created for each new run, independent of seed; immutable through pause, migration commit, and retry. |
| Lifecycle status | Existing `active`, `paused`, `completed`, and `failed` meanings remain. |
| Stage | Exactly one of map, encounter, encounter-completion-pending, or reward for a resumable run. |
| Map tiers | Exactly seven ordered tiers; one or two nodes per non-boss tier; one boss; at most three fork tiers. |
| Current tier | Integer index in range. Completed tiers form a strict prefix. |
| Selected/active node | Null before a fork choice; otherwise belongs to the current tier and remains locked through retries. |
| Selected path | At most one node per completed tier, with unique known node IDs. |
| Attempt number and seed | Non-negative attempt counter and persisted seed for the selected node. |
| Pending encounter result | Present only while completion is pending; records win, loss, or draw, whether the completed encounter is the boss, and any terminal score candidate so the exact transition can be retried. |
| Pending reward | Null outside reward stage; otherwise one source node and three distinct catalog choices. |
| Relic inventory | Known IDs only, unique entries, bounded rank/charge/count values. |
| Reward history/counts | Bounded known IDs used to enforce acquisition caps and audit one reward per completed node. |
| Existing counters | Chances, score-eligible chances, streak, score-eligible streak, rounds, and attempted summons retain integer validation. The score-eligible counters shadow the chances and streak a reward-free run would have. |

All arrays and nested discriminated unions are deeply validated and bounded.
Unknown schema versions, stages, node lanes, node IDs, reward IDs, relic IDs, or
effect discriminants fail closed. Numeric fields reject non-finite, negative, or
fractional values as appropriate.

### Legacy migration

- Treat the existing unversioned shape as version 1.
- Validate it with its current strict validator before migration.
- Convert its seven stored opponents into seven single-node tiers in the same
  order. Do not generate alternatives or replace stored decks.
- Mark the converted map as legacy-linear so its final stored opponent remains
  valid even if hand-edited version 1 data used a non-mono known kind.
- Map `currentOpponentIndex` to the current tier because that field currently
  selects the actual opponent deck. If a valid version 1 payload has a
  contradictory `currentRound`, normalize the tier from the opponent index and
  cover that compatibility rule with a fixture. Preserve all chances, streak,
  totals, base seed, active seed, and lifecycle status.
- Initialize score-eligible chances and score-eligible streak from the migrated
  run's remaining chances and win streak respectively.
- Start with no relics, reward history, or pending reward.
- Use the separately validated game snapshot to distinguish a paused
  mid-encounter run from a paused between-encounter run only when it is bound to
  that run and attempt. Legacy bare snapshots contain no such identity and
  cannot be safely rebound: reject them with a visible recovery warning and
  offer a retry of the saved encounter, never restore them into a different run.
- Assign a fresh run ID on migration at the first explicit run commit; retain
  it on all subsequent commits. Never derive it solely from the legacy seed.
- Do not rewrite local storage merely because the lobby was opened. Write
  version 2 at the next explicit run commit.
- Today an on-load `active` run is normalized to `paused` and immediately
  rewritten. Version 2 deliberately keeps that normalization in memory but
  defers its durable write until resume or another explicit run commit.
- Keep the existing storage keys. A malformed version 1 or version 2 run remains
  unavailable rather than being partially repaired.

Existing high scores remain comparable and are not reset. The legacy score
formula remains unchanged, but version 2 passes its persisted score-eligible
chance count as the remaining-chances input. This count starts at the migrated
or new run's normal chance count. A separate persisted score-eligible streak
starts at the migrated run's win streak or zero for a new run, increments on
every win, and resets on every loss regardless of Streak Anchor. Its ordinary
third-win milestones increase score-eligible chances. Every loss decrements
score-eligible chances with a floor of zero, regardless of whether Guardian
Sigil prevents the actual chance loss. Second Wind never increases the shadow
count, and actual chances continue to control run survival. Score tests cover
both chance rewards and the sequence of a two-win streak, a Streak
Anchor-protected loss, and another win, proving that rewards cannot increase the
chance contribution to score.

## Controller state machine

The controller is the only authority allowed to advance the run:

| Current stage | Command | Valid next state |
| --- | --- | --- |
| Map | Start current/available node | Encounter with committed node, attempt, setup consumption, and seed persisted first |
| Encounter win, non-boss | Internal game completion | Reward with completed node and pending offer persisted |
| Encounter win, boss | Internal game completion | Completed terminal state and persisted high-score handling |
| Encounter loss with chances | Internal game completion | Map with the same retry node selected |
| Encounter loss without chances | Internal game completion | Failed terminal state and persisted high-score handling |
| Encounter draw | Internal game completion | Map with the same retry node selected |
| Encounter completion pending | Retry completion | Reapply the recorded result to a fresh candidate and persist its exact win/loss/draw transition |
| Reward | Choose known offered ID | Apply once, advance tier, clear selection/offer, open map |
| Reward | Skip | Advance tier without inventory change, clear offer, open map |
| Any resumable stage | Pause/back to lobby | Same stage and decisions retained with paused lifecycle |

Add explicit controller API operations for starting a map node and resolving a
reward. Both re-read the latest state, validate the supplied ID, establish
duplicate-submission protection before notifying listeners, and either commit
once or leave the decision retryable.

High-integrity transitions use persistence-first candidates:

1. Clone/project the bounded run aggregate.
2. Validate and apply the requested transition to the candidate.
3. Persist the candidate.
4. Only after success, replace controller state and launch/advance.
5. If an internally triggered encounter result cannot be persisted, retain the
   game-over snapshot, enter encounter-completion-pending with that exact result,
   surface the storage warning last, and expose an explicit Retry completion
   operation. Retrying replays no game actions and cannot change the result.
6. Treat a terminal run candidate and its high-score update as one completion
   transaction. Persist the idempotent maximum high score first, then persist
   the terminal run state; do not replace controller state, clear the run, or
   discard completion-pending state until both writes succeed. Failure of either
   write keeps Retry completion available with the same terminal result and
   score candidate.
7. On any other storage failure, retain the old actionable state, surface the
   storage warning last, and allow a safe retry.

This prevents a reward from disappearing or a charged relic from being consumed
in memory when its durable commit failed.

### Encounter snapshot identity

- Persist the separate `GameState` in a versioned envelope containing the run
  ID, selected node ID, attempt ordinal, attempt seed, and deeply validated
  game snapshot. Keep these identity fields in the committed run aggregate too.
- Restore only when the run is resumable at the encounter stage and **all**
  envelope identity fields equal its current committed attempt. An invalid,
  unbound, stale, or mismatched snapshot is never launched, even if removing it
  from storage fails. Surface a recovery warning and allow the saved encounter
  to be retried without silently substituting a different game.
- A reset, a new run, completion, and a newly committed retry invalidate the
  previous attempt by run or attempt identity before any snapshot cleanup.
  Deletion is best-effort cleanup, not the correctness boundary. A failed
  snapshot write during Pause retains the live game and leaves Pause retryable.

## View-model and presentation contract

- Add app-level immutable summaries for map tiers/nodes, relic inventory, and
  reward offers.
- Freeze/copy every nested list and object; never pass run map, opponent decks,
  pending rewards, or relic entries by reference.
- Derive map status, opponent labels, reward names, descriptions, and creature
  names from trusted app catalogs.
- Do not serialize player-facing labels or asset slugs as map/reward identity.
- Keep `totalCardsPlayed` projected as **Summons attempted (both players)** with
  its current semantics.
- Expose enough information to explain automatic relic consumption in the
  result/status copy without exposing controller internals.

## Native Three.js interface

When Adventure mode has no active game, render an Adventure hub instead of the
generic lobby:

- Use an ordered semantic list for seven tiers.
- Render a single center node or two left/right choices per tier. Use text and
  icons in addition to color for completed, current, available, bypassed,
  locked, and boss states.
- Apply `aria-current="step"` to the current tier/node and include tier,
  opponent, route status, and roster summary in each accessible name.
- Only `current` and `available` nodes are buttons; `current` covers both
  single-node convergence tiers and committed retries. Locked, bypassed, and
  completed nodes are non-interactive.
- Show chances, streak, attempted summons, owned relics/charges, and current
  opponent context near the route.
- Show reward choices as a full Adventure panel with exact effect text, current
  cap/charge context, Choose controls, and a distinct Skip control.
- Keep Pause and Reset available from map/reward screens. Reset remains an
  explicit destructive action and must not share an element ID with in-game
  controls.
- After an encounter, focus the reward/result heading. After choosing or
  skipping, focus the current map tier. On rejected persistence, preserve focus
  and keep the same controls usable.
- Keep controls at least 44 CSS pixels, labels wrappable, internal panels
  scrollable when required, and the route usable in narrow portrait, short
  landscape, coarse-pointer, safe-area, reduced-motion, and 200% text contexts.
- Do not place the route in WebGL or create a second browser renderer.

## Atomic milestones

### Milestone 0 — Roadmap

**Scope**

- Record approved topology, reward rules, migration, architecture, and
  acceptance gates in this document.
- Make no runtime, persistence, or UI changes.

**Definition of done**

- Reviewers can approve map and reward semantics before schema code lands.
- Remaining milestones are unchecked and make no implementation claim.
- Documentation-only validation is recorded accurately.

### Milestone 1 — Versioned aggregate and migration

**Scope**

- Introduce version 2 domain types, guards, and normalization helpers.
- Represent the existing seven-opponent run as seven single-node tiers while
  preserving the current immediate-launch behavior.
- Read valid version 1 saves and normalize them in memory without eager writes.
- Centralize run cloning/validation so later transitions cannot construct
  partially valid state.

**Primary modules**

- `src/app/adventure.ts`
- `src/app/adventure-persistence.ts`
- `src/app/types.ts`
- `src/test/adventure.test.ts`
- `src/test/adventure-persistence.test.ts`
- `src/test/controller.test.ts`

**Required tests**

- Version 1 fixtures migrate losslessly, including every counter and deck.
- Version 2 round-trips and rejects every malformed nested field and invariant.
- Run IDs are persisted, unique across new runs even with the same seed, and
  retained by pause and retry; versioned snapshot envelopes reject malformed
  identity fields and snapshots.
- Unknown versions fail closed.
- Constructor/lobby reads do not rewrite stored version 1 JSON.
- Legacy fixtures with a non-mono seventh opponent or mismatched round/index
  follow the documented compatibility normalization and remain completable.
- Existing pause/resume gameplay, score, streak chance, and recording behavior
  is unchanged; only the documented eager on-load storage rewrite is removed.

**Definition of done**

- Production behavior is still linear and functionally unchanged.
- All new schema data is deeply validated and immutable outside its owner.
- This milestone can be reverted without touching renderer or engine code.

### Milestone 2 — Pure map generation and route rules

**Scope**

- Add a focused app-level map module for seeded tier generation, structural
  validation, available-node selection, path completion, bypass derivation, and
  deterministic attempt seeds.
- Provide a pure generator for three non-adjacent two-node tiers and a shared
  boss, but do not connect it to live `createAdventureRun` yet.
- Keep live new runs and migrated maps linear until Milestone 3 lands the
  generator, controller selection API, and map UI together.

**Primary modules**

- `src/app/adventure-map.ts` (new)
- `src/app/adventure.ts`
- `src/test/adventure-map.test.ts` (new)
- `src/test/adventure.test.ts`

**Required tests**

- Repeated seeds produce byte-equivalent map aggregates.
- A broad seed table always yields seven tiers, ten total nodes, three
  non-adjacent forks, two choices per fork, and one final mono boss.
- Node, opponent, and nested card IDs are unique where required.
- Every possible route is exactly seven encounters and reaches the boss.
- Illegal, stale, bypassed, completed, and future selections are rejected.
- Retries preserve the selected node while changing only the deterministic
  attempt ordinal/seed.

**Definition of done**

- Map policy is pure, deterministic, renderer-independent, and exhaustively
  tested.
- No UI advertises branching before the complete vertical flow exists.

### Milestone 3 — Branching map vertical slice

**Scope**

- Add map/encounter stages and controller commands to start a valid node.
- Switch new-run construction from the temporary linear version 2 aggregate to
  the tested branching generator in this same vertical change.
- Start and resume Adventure at its hub instead of automatically launching a
  fresh encounter; continue restoring true mid-encounter snapshots directly.
- Advance wins to the next tier, lock losses/draws to retry, and complete at the
  shared boss.
- Project immutable map summaries and add the native HTML route, actions, focus
  behavior, and responsive styling.

**Primary modules**

- `src/app/controller.ts`
- `src/app/types.ts`
- `src/app/view-model.ts`
- `src/app/lobby-presentation.ts`
- `src/renderers/three/interface-model.ts`
- `src/renderers/three/interface.ts`
- `src/renderers/three/interface.css`
- Focused controller, view-model, lobby, and Three-interface tests

**Required tests**

- New run → choose either branch → win → convergence tier → later forks → boss.
- Loss and draw retry the committed node and cannot switch to its sibling.
- Mid-encounter pause restores the exact game; map pause restores the exact map.
- Snapshots from a reset run, a completed attempt, or an earlier attempt at
  the same node are rejected even when removal fails; a matching versioned
  envelope restores exactly once. Legacy unbound snapshots are rejected with
  a visible retry path rather than restored into another run.
- A rejected mid-encounter pause snapshot keeps the live encounter open, shows
  the storage warning last, and leaves an explicit Pause retry usable; it must
  not navigate to the lobby until both snapshot and run commits succeed.
- Stale/double node activation starts at most one encounter.
- Storage rejection leaves the same node actionable and does not consume an
  attempt.
- Rejected completion commits for non-boss win, boss win, loss with chances,
  terminal loss, and draw retain the exact pending result and converge after one
  successful Retry completion without double-applying counters, relics, rewards,
  or score handling.
- Reject terminal run and high-score writes independently. A rejected high-score
  write must retain completion-pending and Retry completion before any terminal
  cleanup; each retry converges exactly once without lowering or double-counting
  the score.
- View-model snapshots do not share map/opponent references.
- Markup has unique IDs, escaped copy, correct semantics, and only valid node
  buttons.

**Definition of done**

- The branching map is fully playable without rewards.
- Existing linear migrated runs use the same hub and remain completable.
- Browser users never reach a state with no legal navigation action.

### Milestone 4 — Pure reward and relic rules

**Scope**

- Add one canonical app-level reward catalog with stable IDs and catalog/rules
  versions.
- Add pure eligibility, deterministic offer generation, choice application,
  cap/charge handling, loss protection, and encounter setup helpers.
- Add a generic optional initial-hand-size engine setup parameter with unchanged
  defaults.
- Keep reward generation disconnected from controller progression until the
  complete vertical flow lands in Milestone 5.

**Primary modules**

- `src/app/adventure-rewards.ts` (new)
- `src/app/adventure-setup.ts` (new)
- `src/game/engine.ts`
- `src/test/adventure-rewards.test.ts` (new)
- `src/test/adventure-setup.test.ts` (new)
- `src/test/engine.test.ts`

**Required tests**

- Offers are deterministic, contain three distinct eligible IDs, and change
  predictably with source node/reward ordinal.
- Exhaustive reachable six-pick inventories never exhaust the three-choice pool.
- Unknown/capped choices fail without mutation; valid choices apply exactly once.
- Guardian and Streak effects consume only when their consequence applies.
- Opening-hand setup preserves exactly 50 unique cards across all zones, uses
  canonical mechanical order, guarantees owned charms, and caps the Adventure
  player's hand at eight while the opponent still starts with exactly five.
- Generic engine setup accepts two validated player-specific hand counts;
  `[5, 5]` retains the default, and an Adventure `[6, 5]` or `[8, 5]` changes
  only player 0's opening hand.
- Normal, tutorial, CLI, P2P, and replay initialization remains byte-equivalent
  when no setup override is supplied.

**Definition of done**

- Reward policy has no DOM, controller, storage, or Three.js dependency.
- The game engine exposes generic setup only and contains no Adventure/relic ID.

### Milestone 5 — Reward and relic vertical slice

**Scope**

- Create and persist a pending reward after each non-boss victory.
- Add controller commands for choose and skip with persistence-first commits.
- Apply run-layer effects during result resolution and encounter setup effects
  during the start-node transaction.
- Project immutable reward/relic summaries and add the reward panel and relic
  inventory to the Adventure hub.
- Keep boss completion reward-free.

**Primary modules**

- `src/app/controller.ts`
- `src/app/adventure.ts`
- `src/app/adventure-persistence.ts`
- `src/app/types.ts`
- `src/app/view-model.ts`
- `src/renderers/three/interface-model.ts`
- `src/renderers/three/interface.ts`
- `src/renderers/three/interface.css`
- Adventure/controller/view-model/Three-interface tests

**Required tests**

- Each non-boss victory creates one persisted offer; loss, draw, and boss victory
  create none.
- Reload preserves exact offer order and does not reroll.
- Choose/skip advances once; stale and duplicate activation cannot double-apply.
- A pending reward blocks node start and survives pause/reload.
- Persistence failure retains the reward, focus, and retry path.
- Each catalog effect changes only its documented future transition/setup.
- Relic-modified encounters create recordings whose initial snapshot replays
  without reward metadata or special replay rules.

**Definition of done**

- All ten catalog entries are selectable, visible, persisted, and functional.
- No placeholder/no-op reward can be offered.
- A full new run can traverse three forks, claim or skip six rewards, and
  complete the boss.

### Milestone 6 — Hardening and accessibility

**Scope**

- Audit every map/reward transition against synchronous notifications,
  unchanged-decision rejection, stale input, duplicate activation,
  cancellation/disposal, and storage unavailability.
- Audit mid-encounter pause persistence so a rejected snapshot or run write keeps
  the live encounter open with its warning and retry control intact.
- Complete keyboard, focus, screen-reader, reduced-motion, responsive, and
  high-text-zoom behavior.
- Add explicit status copy for automatic relic consumption and retry outcomes.
- Audit caps, validation cost, and local-storage payload size.

**Required tests and checks**

- Extend the stateful UI regression matrix to node and reward controls.
- Fuzz/fixture malformed version 2 maps, offers, relics, and attempt fields.
- Verify no opponent deck or hidden hand data enters route/reward markup.
- Verify controls and text at narrow portrait, short landscape, coarse pointer,
  safe areas, and 200% text in a production browser.
- Verify reload at map, pending reward, committed encounter, loss retry, and
  post-boss completion boundaries.
- Verify mismatched run/node/attempt/seed envelopes cannot restore a stale
  encounter after reset, retry, or completion, including failed snapshot
  removal.
- Reject snapshot and run writes independently during a mid-encounter pause;
  each rejection must retain the resumable game, avoid lobby navigation, and
  succeed exactly once through the explicit Pause retry.

**Definition of done**

- All decisions remain usable after rejection and submit at most once after
  acceptance.
- Automated tests and recorded browser evidence cover the complete state machine.

### Milestone 7 — Compatibility and release gate

**Scope**

- Update README Adventure rules and durable agent guidance for the final schema,
  migration, map, reward, and setup invariants.
- Run the full compatibility matrix for legacy Adventure saves, recordings,
  normal game modes, tutorial, CLI, P2P, non-root builds, and offline reload.
- Record actual automated and visual outcomes using the repository PR template.

**Required validation**

1. Node 24 and clean `npm ci`.
2. `npm run lint`.
3. `npm run test`, with the observed test count.
4. `npm run build`.
5. Secret scan of changed files.
6. CodeQL/review validation after committing.
7. Production preview at the configured non-root base path.
8. Browser interaction, screenshot capture, screenshot inspection, and
   reviewer-accessible attachment tracked as separate outcomes.

**Definition of done**

- Every acceptance criterion below is met or explicitly blocked with maintainer
  follow-up; no required item is silently waived.
- The final PR description reports actual results and ends with the required
  validation line.

## Acceptance criteria

### Map

- New runs have seven tiers, exactly two choices at each of no more than three
  forks, and one shared mono boss.
- No route can skip, repeat, or exceed an encounter tier.
- Route choice, retry, reload, and resume are deterministic and preserve the
  committed node.
- Migrated valid saves retain their exact seven opponents and remain completable.

### Rewards and relics

- Every non-boss win produces exactly one persisted three-choice offer; no other
  result does.
- Choice and skip are idempotent, revalidated, reload-safe, and cannot be farmed.
- Every offered effect is implemented, bounded, visible, and described in
  catalog-backed player copy.
- Opening setup preserves card identity/count and is fully captured in recording
  initial state.

### Architecture and compatibility

- Dependencies remain `renderers/three/ → app/ → game/`.
- The engine has no Adventure, map, reward, or relic identity.
- Renderers consume immutable summaries and never receive stored opponent decks.
- Stable mechanical card keys remain the only serialized card identity.
- Existing recording versions, normal modes, tutorial, CLI, and P2P behavior
  remain compatible.
- `totalCardsPlayed` and its **Summons attempted (both players)** label retain
  their exact current meaning.

### UX and recovery

- Route and rewards are fully keyboard- and screen-reader-operable with unique
  IDs, visible focus, 44-pixel controls, non-color status, and predictable focus
  restoration.
- Narrow portrait, short landscape, safe areas, coarse pointers, reduced motion,
  and 200% text remain usable without clipped required actions.
- Storage failure never silently loses a route choice, reward, charge, snapshot,
  or warning.
- Reset is explicit; starting another mode does not delete the saved run.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Version 2 corrupts or strands existing runs | Keep a dedicated strict version 1 validator, migrate to a linear map in memory, and test real serialized fixtures without eager rewrite. |
| Branch generation produces an invalid/unreachable graph | Persist ordered one/two-node tiers with implicit edges rather than arbitrary adjacency; validate shape and property-test broad seeds. |
| Reload rerolls a more favorable reward | Persist the complete offer before presentation and derive it from stable run/node ordinals. |
| Double activation grants two rewards or starts two games | Guard by current stage/decision key before notifying, persist once, and reject stale IDs. |
| Relics make recordings depend on missing run metadata | Restrict effects to run transitions and initial setup; record the resulting initial `GameState`. |
| Relics leak into normal game rules | Give the engine only a generic setup option with unchanged defaults; keep catalog/effect interpretation in `src/app/`. |
| Guaranteed cards duplicate/delete deck entries | Reorder existing cards only, preserve stable IDs, use canonical key order, and assert 50 cards across zones. |
| Larger maps cause local-storage jank | Persist only at map/reward/encounter/pause boundaries, never on every action; measure serialized payload size. |
| Player farms rewards by losing or switching a branch | Reward wins once per node, lock a selected node through retries, and keep completed/rewarded node IDs in validated state. |
| Native route is unusable on mobile or assistive technology | Use semantic HTML and text status, test focus/zoom/orientation, and keep WebGL out of the route UI. |
