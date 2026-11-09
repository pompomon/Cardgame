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
- [x] Milestone 1 — Introduce the versioned Adventure aggregate and legacy migration
- [x] Milestone 2 — Add deterministic two-branch map generation and route rules
- [x] Milestone 3 — Deliver the branching map as an end-to-end browser flow
- [x] Milestone 4 — Add the typed boon/relic catalog and deterministic reward rules
- [x] Milestone 5 — Deliver reward selection and relic application end to end
- [x] Milestone 6 — Harden persistence, reentrant input, accessibility, and recovery
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

**Delivery notes**

- New runs use a `linear` map and converted version 1 runs use
  `legacy-linear`. Later milestones must keep reading both kinds until those
  runs finish.
- The mid-game save uses the identity-bound envelope from
  [Encounter snapshot identity](#encounter-snapshot-identity). A bare version 1
  game snapshot is never restored: Resume restarts the saved encounter from its
  seed, without using a chance, and shows a recovery warning.
- `relics` and `rewardHistory` already exist and must be empty, so Milestone 5
  only relaxes their guards.
- Stages are still limited to `map` and `encounter`, each tier has one center
  node, and Resume still launches the current encounter immediately. Map
  selection, completion-pending retry, and persistence-first launch remain
  Milestone 3 work.
- Rules and pitfalls for contributors are in
  [`docs/agent/state-and-persistence.md`](../agent/state-and-persistence.md#adventure-run-schema-version-2).

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

**Delivery notes**

- `src/app/adventure-map.ts` is a leaf module. It owns the opponent pools and
  decks, map types, node IDs, map validation, seed derivation, the branching
  generator, and the route rules. It imports only `game/cards`, `game/types`,
  and `app/validators`. `adventure.ts` imports it and re-exports the names
  other modules already used, so their imports did not change.
- The map kinds are `linear`, `legacy-linear`, and the new `branching`.
  Linear kinds keep the Milestone 1 rules and have no forks. A branching map
  forks exactly three of tiers 1–6 into `[left, right]`, on tiers {1,3,5},
  {1,3,6}, {1,4,6}, or {2,4,6}, and ends with one shared mono boss. No mono
  opponent appears earlier, and opponent IDs never repeat. Maps with one or
  two forks are rejected because nothing generates them.
- The run guard still accepts only `linear` and `legacy-linear` maps. A stored
  run on a valid branching map is unavailable, like an unknown kind, and is
  never rewritten. New runs stay linear and transitions still use clock seeds,
  so live behavior is unchanged.
- `deriveAdventureSeed` mixes a fixed purpose tag, explicit lane numbers
  (center 0, left 1, right 2), and both 32-bit halves of the base seed into a
  32-bit unsigned seed with integer-only operations. It never uses string
  hashes, labels, object-key order, `Math.random`, or the clock. The generator
  draws the fork pattern, deck order, non-boss picks, and boss from separate
  purposes through the existing `shuffle` and `lcg`. `adventureAttemptSeed`
  gives every attempt at a node its own seed. The `rewardOffer` purpose is
  reserved for Milestone 4.
- The route rules (`adventureRouteNodes`, `selectAdventureNode`,
  `retryAdventureNode`, `completeAdventureNode`) work on every map kind and
  return fresh route fields for the caller to apply. Selection rejects
  untrusted node IDs without throwing; retry and completion throw when the
  state is not an active encounter.
- Milestone 3 handoff:
  - Remove the gate in the same change that switches `createAdventureRun` to
    `generateBranchingAdventureMap`. Saved runs then grow from seven to ten
    opponent decks.
  - Move the start and result transitions onto the route rules and derived
    seeds. `completeAdventureNode` also resets the attempt number after the
    boss, where today's final-win transition keeps it.
  - Make `deckPairForAdventureGame` reject a missing node instead of falling
    back to a starter deck.
  - Replace the view model's `nodes[0]` projection, and add the map UI and a
    controller command to start a node.
  - Decide whether a branching run must have no seed before a node is
    selected. Selection keeps any stored seed, as linear runs need today.
- Rules and pitfalls for contributors are in
  [`docs/agent/state-and-persistence.md`](../agent/state-and-persistence.md#adventure-run-schema-version-2).

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

**Delivery notes**

- **Run model.** `createAdventureRun` now calls `generateBranchingAdventureMap`,
  and `isAdventureRunState` accepts `branching` maps, so the Milestone 2 gate is
  gone. A new run starts `active` at the `map` stage with no selected node and
  no attempt seed. A fresh tier stores no seed until a node is chosen. The guard
  still allows a seed at the `map` stage because retries and saved linear runs
  keep theirs. Saved runs now hold ten opponent decks.
- **Transitions use the route rules.**
  - `startAdventureEncounter(run, nodeId)` replaces `beginAdventureEncounter`.
    It validates the untrusted node ID with `selectAdventureNode` and returns
    null when the choice is rejected.
  - `applyAdventureEncounterResult` completes or retries the selected node with
    derived attempt seeds. A non-terminal result returns the run `active` at
    the `map` stage. After the boss, the attempt number resets to 0.
  - `openAdventureMap` and `resumeAdventureEncounter` serve Resume.
  - `deckPairForAdventureGame` throws when no node is selected instead of
    using another opponent's deck.
- **Controller.** `ControllerApi` adds `startAdventureNode(nodeId)` and
  `retryAdventureCompletion()`. Every transition saves first, in this order:
  - **Start:** write the new run, clear the game slot, then open the hub with
    no game.
  - **Node start:** write the run with the committed node, attempt number and
    seed, clear the game slot, then call
    `createInitialGame(attemptSeed, deckPair)`.
  - A refused write leaves the previous state, the same controls and the
    attempt number unchanged, and shows the storage warning as the status.
  - Repeated or stale activations are ignored once an encounter has started.
- **Completion.**
  - A non-terminal result writes the next run.
  - A terminal result writes the highest of the stored, in-memory and new
    scores, then removes the run key.
  - If any write fails, memory keeps the run from before the result, the
    game-over board and the exact outcome as pending. **Retry Saving Result**
    applies that outcome again to a fresh copy of the same run, so counters
    and the score change only once.
  - While a result is pending, Back to Lobby, Pause, Start, Resume, other modes
    and recording import show "Save the encounter result first". Reset still
    works.
- **Resume.** Resume restores a mid-game save only when all of these hold:
  - the run is paused at its encounter;
  - the save's envelope matches the run, node, attempt number and seed;
  - the saved game has not finished;
  - the run write succeeds.

  Otherwise Resume opens the map without writing. The committed node, attempt
  number and seed are kept, so the encounter restarts without using a chance.
  A lost mid-encounter game shows a recovery warning.
- **View model.** `AdventureUiState` replaces `currentRound`, `opponentLineup`
  and `currentOpponentIndex` with:
  - a 1-based `currentTier`;
  - frozen `tiers` of node summaries: ID, tier, lane, derived status, boss flag,
    opponent label, kind and lands, but never decks;
  - `pendingCompletion`, `lastResult` and `decisionKey`.

  Tier summaries are cached per run object and route position.
  `describeNextAdventureOpponent` names both fork choices.
- **Browser.** Adventure mode with no game shows the Adventure map hub:
  - **Layout:** the last result, progress statistics and an ordered seven-tier
    route.
  - **Actions:** Pause and Reset while the run is open; **Start New Adventure**
    and **Back to Lobby** after it ends.
  - **Nodes:** only `current` and `available` nodes are buttons. Each node shows
    an icon and status text, and the current tier has `aria-current="step"`.
  - **Focus:** moves to the result heading after a result and to the current
    tier when the hub opens. A refused write keeps focus in place.
  - **Pending result:** during an encounter, Retry Saving Result replaces Pause
    in the menu, HUD and dock.
- **Linear runs.** Saved Milestone 2 `linear` runs and converted
  `legacy-linear` runs use the same hub and stay linear. Tiers after their
  stored first seed use derived attempt seeds.

**Deviations from the contract above**

- A pending completion is kept in memory only, because storage just refused
  it. After a reload, the stored run is still at its encounter, so Resume
  restarts that encounter without using a chance.
- A terminal completion writes the high score and then removes the run key.
  It does not save a terminal run, so the lobby shows no saved run, as before.
  If the high score was saved but removing the run failed, the result stays
  pending. Retrying rewrites the same highest score.
- Back to Lobby, other modes and recording import never write Adventure
  progress. The stored run stays `active` and is shown as paused. Back to Lobby
  or closing the tab mid-encounter loses the live game but keeps the committed
  attempt. Resume warns and restarts it without using a chance. Only Pause
  saves the live game.
- Because Start saves first, an Adventure cannot start without working
  storage.
- After a saved result, the hub replaces the game-over board. The finished
  encounter's recording stays exportable from the hub's Recording page.
  Rematch is refused in Adventure. While an Adventure is open, replay is
  refused and the replay control is hidden.
- The lobby's Adventure mode button still starts a new run and replaces a saved
  run once the write succeeds. **Resume Adventure** remains a separate button.
- After a loss or draw, the fork stays committed and its sibling stays
  `bypassed`. The hub labels the node **Retry encounter**.

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

**Delivery notes**

- **Modules.** Two new leaf modules hold the rules. Nothing calls them yet, and
  the run guard still requires empty `relics` and `rewardHistory`.
  - `src/app/adventure-rewards.ts` owns the catalog, the guards, eligibility,
    offers, choose and skip, charges, and loss protection. It imports only
    `game/cards`, `game/types`, `adventure-map`, `card-catalog`, and
    `validators`.
  - `src/app/adventure-setup.ts` owns opening-hand setup. It imports only
    `game/engine`, `game/types`, `adventure-rewards`, and `validators`.
  - `adventure-map.ts` adds `parseAdventureNodeId` and `adventureRewardSeed`,
    which uses the reserved `rewardOffer` purpose. It now owns
    `AdventureEncounterOutcome`, which `adventure.ts` re-exports.
- **Engine.** `createInitialGame(seed, decks?, options?)` accepts
  `{ openingHandSizes: [player0, player1] }`. Each count is an integer from 0
  to that player's deck size; anything else throws `RangeError`. Without the
  option the output is byte-for-byte unchanged, which
  `src/test/fixtures/engine-initial-game.characterization.json` pins.
- **Rules version 1.** `ADVENTURE_REWARD_RULES_VERSION` covers the catalog
  order in the table above, the offer seed words (tier index, lane number,
  reward ordinal), and every effect. Changing any of them changes what a seed
  offers, so bump the version and repin the offer tests.
- **Offers.**
  - The reward ordinal is the number of resolved offers, so a skip counts.
  - The offer ID is `reward-<ordinal + 1>-<sourceNodeId>`.
  - Generation shuffles all ten IDs with the reward seed, keeps the eligible
    ones, and takes the first three.
  - A search over every reachable inventory proves that at least three rewards
    stay eligible for all six offers.
- **Holding rewards.**
  - Each pick of a charged relic adds one charge, up to two. A charged relic
    is offered while it holds fewer than two charges.
  - A charged relic is removed when its last charge is used and can be chosen
    again later.
  - A skip is recorded as `{ sourceNodeId, rewardId: null }`.
  - Choose and skip return only `remainingChances`, `relics`, and
    `rewardHistory`. Second Wind raises the real chances, never the
    score-eligible ones. A rejected choice returns null and changes nothing.
- **Protection.** Effects come from the catalog. On a loss, Guardian Sigil
  uses a charge only when a chance would be lost, and Streak Anchor only when
  a positive streak would reset. A win, a draw, or an unknown outcome changes
  nothing.
- **Setup.** The opening hand is 5 cards, plus 1 with Prepared Pack and 2 with
  Scout's Cache, capped at 8. The opponent always draws 5, so
  `openingHandSizes` is `[playerHandSize, 5]`.
  - Charms reorder a copy of the player's deck. Each guaranteed creature
    already in the opening window keeps its first copy there.
  - Each missing creature, in `BASIC_LANDS` order, swaps its first later copy
    with the unclaimed window card nearest the end of the window.
  - Charm rules text names each creature with `displayCardName`.
- Milestone 5 handoff:
  - Add `pendingReward` and a per-attempt `encounterSetup` to the run, add the
    `reward` stage, and relax the `relics` and `rewardHistory` guards to the
    Milestone 4 guards plus run-level checks.
  - Call `planAdventureEncounterSetup` once when an attempt is committed and
    save the setup with it. Restarts reuse the saved setup, so Scout's Cache
    uses one charge per attempt. A result clears it.
  - Launch games with `adventureEncounterGameSetup(encounterSetup, deckPair)`
    and pass its decks and options to `createInitialGame`.
  - On a loss, apply `applyAdventureLossProtection` to the real counters and
    keep the score-eligible counters unconditional. A non-boss win enters the
    `reward` stage with `generateAdventureRewardOffer`.
  - Save choose and skip before changing state, check the offer ID against
    the decision key, and set any storage warning last.
- Rules and pitfalls for contributors are in
  [`docs/agent/state-and-persistence.md`](../agent/state-and-persistence.md#adventure-run-schema-version-2).

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

**Delivery notes**

- **Reward stage.** `AdventureRunStage` adds `reward`. A non-boss win
  completes its node at once: the tier advances, and the selection, attempt
  number and seed clear. The run then waits at `reward` with the offer that
  node earned. Choose and Skip resolve only the offer and open the `map`
  stage at the new tier. `isAdventureRouteState` accepts `reward` only after
  a completed node, with nothing selected, attempt 0 and no seed.
  `selectAdventureNode` still requires `map`, so no node starts while a
  reward waits.
- **Run fields.** Runs gain `pendingReward` and `encounterSetup`, and
  `relics` and `rewardHistory` may now hold rewards. `isAdventureRunState`
  applies the Milestone 4 holdings guard plus run-level checks:
  - The history names the latest resolved offers' source nodes in route
    order, with no gaps. Runs saved before Milestone 5 may lack entries for
    their earliest tiers.
  - An offer is pending exactly at `reward`. Its source is the last completed
    node, its ordinal is the history length, and every choice is still
    eligible, so a hand-edited offer cannot hold a no-op reward.
  - A setup is required at `encounter` and allowed at `map` only while a
    node and its seed are kept for a restart. Reward and terminal stages
    have none.
- **Saves from before rewards.** Milestones 1–4 wrote version 2 runs without
  the two new fields. On read, `backfillPreRewardAdventureRun` fills them in
  memory when both are missing and the run holds no rewards: no offer, and
  at `encounter` the five-card setup those games were dealt with. A run
  missing only one field is unavailable. The schema version stays 2, and the
  next commit writes the full shape.
  `src/test/fixtures/adventure-v2-pre-reward-saves.json` holds six saves
  captured before this change.
- **Results.** `resolveAdventureEncounterResult(run, outcome)` returns the
  next run and whether Guardian Sigil or Streak Anchor acted.
  `applyAdventureEncounterResult` remains a wrapper that returns the run.
  - A non-boss win creates the offer with `generateAdventureRewardOffer`. The
    offer depends only on the run, so Retry Saving Result offers the same
    choices.
  - A boss win completes the run with no offer.
  - A loss applies `applyAdventureLossProtection` to the real chances and
    streak. The score-eligible counters take the unprotected result, and the
    run fails only when the real chances reach zero.
  - A draw retries without using a protection charge.
  - Every result clears the attempt's setup, and nothing refunds a Scout's
    Cache charge.
- **Setup.** When the run has no setup, `startAdventureEncounter` plans one
  with `planAdventureEncounterSetup`. The node-start write saves the setup and
  any Scout's Cache charge it used. Restarting the same attempt after a lost
  mid-encounter game reuses the setup and uses no charge.
  `adventureEncounterLaunch(run)` returns the seed, the arranged decks and
  `openingHandSizes: [H, 5]` for `createInitialGame`. The engine is unchanged.
- **Choose and skip.** `chooseAdventureRunReward(run, offerId, rewardId)` and
  `skipAdventureRunReward(run, offerId)` treat both IDs as untrusted. Unless
  the run is resumable at `reward` and the IDs match its offer, they return
  null. Otherwise they apply the Milestone 4 choose or skip, clear the offer
  and open the map.
- **Controller.** `ControllerApi` adds `chooseAdventureReward(offerId,
  rewardId)` and `skipAdventureReward(offerId)`. Both re-read the latest
  state. They do nothing unless Adventure is open with no game, no replay and
  no pending result, and the same offer is pending. They save first:
  - **Success** replaces the run and clears the last result. The status
    names the claimed reward, or the skip, and the next tier.
  - **A refused write** keeps the offer, the controls and focus. The status
    ends "The reward was not claimed." or "… skipped."
  - **An unoffered reward ID** writes nothing and shows "That reward is not
    available. Choose an offered reward or skip it."
  - **Other commands:**
    - `startAdventureNode` refuses while a reward waits and writes nothing.
    - Pause saves the run at `reward`, and Resume reopens the offer without a
      write.
    - Back to Lobby never writes.
  - **Relic status copy.** The status names Guardian Sigil or Streak Anchor
    when either kept a chance or a streak. It names Scout's Cache when a node
    start used a charge.
- **View model.** `AdventureUiState` adds:
  - frozen `relics`, each with its catalog name, rules text, charges and
    maximum charges;
  - `pendingReward`: the offer ID, the source tier, and three choices, each
    with catalog copy and its cap or charge context.

  Copy comes from the reward catalog, never from saved data. `lastResult`
  adds `chanceLossPrevented` and `streakResetPrevented`. `decisionKey` ends
  with the offer ID, or `-` when none is pending.
- **Browser.**
  - **Reward panel.** At `reward`, the hub replaces the route with a
    **Choose a reward** panel. Each choice shows its name, exact rules text,
    and cap or charge context, with a **Choose <name>** button. A distinct
    **Skip reward** button follows. Every button carries `data-offer-id`, and
    choices also carry `data-reward-id`. The click handler checks both
    against the latest view, and the controller checks again.
  - **Relics.** The progress section lists owned relics with charges and
    rules text. For a saved run, the lobby lists relics and says when a
    reward is waiting.
  - **Focus.**
    - After a win, focus goes to the result heading.
    - After a reload at `reward`, it goes to the reward heading.
    - After Choose or Skip, it goes to the current tier.
    - A refused write keeps focus on the activated control.
- **Recordings.** A relic-modified encounter records the initial `GameState`
  it dealt. The recording holds no reward data and replays like any other.
- **Tests.**
  - `src/test/adventure-run-rewards.test.ts` covers:
    - the run guards and the back-fill;
    - each catalog effect, compared with skipping the same offer;
    - the score shadows and Scout's Cache;
    - every route of every fork pattern, claiming and skipping six rewards.
  - Controller, persistence, map, lobby, view-model and Three-interface tests
    cover:
    - claiming each catalog entry;
    - offers, reloads, and stale and duplicate input;
    - refused writes, focus, and recording replay.

**Deviations from the contract above**

- The controller table advances the tier on Choose or Skip. Instead, the
  tier advances when the win is saved, and the reward waits between tiers.
  This keeps one completed node per finished tier and makes the offer's
  source the last completed node. After Choose or Skip the map opens at the
  same next tier, so players see the same flow.
- Saves from Milestones 1–4 are back-filled on read, as described above,
  rather than requiring a schema bump. An older cached bundle finds a run
  unavailable once it waits on or has resolved a reward. Reading it never
  deletes it.
- Relic use gets one status sentence and result-panel lines. Milestone 6 owns
  the full status copy.
- A stale or mismatched offer ID is ignored silently, like a stale node
  button. Only an unoffered reward ID for the current offer shows a notice.

**Milestone 6 handoff**

- Extend the stateful UI regression matrix to the Choose and Skip controls.
  Cover synchronous notification, a rejected retry, cancellation and
  disposal, and Pause or Reset while a reward waits.
- Write the full status copy for automatic relic use: Guardian Sigil and
  Streak Anchor on losses, and Scout's Cache at node start. Include retry
  outcomes and how screen readers announce the copy.
- Check the reward panel and relic list in a production browser at narrow
  portrait, short landscape, coarse pointer, safe areas and 200% text.
- Add malformed version 2 fixtures for offers, relics, history and setup
  beyond the current guard tests. Measure validation cost and payload size
  with six rewards and a full relic inventory.
- Verify reloads at a pending reward, at a committed encounter with a used
  Scout's Cache charge, and after a protected loss.

Rules and pitfalls for contributors are in
[`docs/agent/state-and-persistence.md`](../agent/state-and-persistence.md#adventure-run-schema-version-2).

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

**Delivery notes**

- **Pause and reload boundaries.** `adventure-controller.test.ts` pins
  these behaviors:
  - If storage refuses the snapshot write or the run write, the next Pause
    writes `[game, run]` exactly once. A repeated Pause writes nothing, and
    Resume restores the game once.
  - If the run write and then the envelope removal are both refused, the
    game never restores, even after a reload. The stored run stays
    `active`, and Resume restores only a run that is `paused` at
    `encounter`.

  Reloads are pinned at these points:
  - the map after a fork win;
  - a pending reward;
  - a committed encounter that used a Scout's Cache charge, with and
    without Pause;
  - after a protected loss;
  - after a loss retry;
  - after the boss is beaten, including a stale boss save and a win still
    waiting to be saved.
- **Storage boundary.**
  - A mid-game save keeps the latest 1,000 `log` entries and `events`
    (`ADVENTURE_GAME_LOG_CAP`).
  - Each player may hold at most 50 cards across zones.
  - Turn and instance counters must be safe integers.
  - Run counters, seeds and attempt numbers must pass the new
    `isNonNegativeSafeInteger`. Counters stop at `Number.MAX_SAFE_INTEGER`
    instead of growing past it, and the score is clamped to the safe
    integers.
  - An opponent may list at most five lands.
  - The high score reads back only as the decimal digits the app writes.
- **Malformed saves.** `src/test/fixtures/adventure-malformed-v2.ts` builds
  14 bases through real transitions. It holds 60 curated cases, each
  breaking one rule, in six categories (map, offer, relic, history, attempt
  and counter), plus variants that must still be accepted.
  `adventure-fuzz.test.ts` reads 2,000 edited runs and 400 edited mid-game
  saves from fixed seeds. Reading never throws or writes. Every accepted
  run plays on through Resume, a reward, a node start and a result, and its
  high score reads back. Every resumable base also plays on with all six
  counters at the limit, for a win, a loss and a draw.
- **Measurements.** These were taken with Node 26 in a development
  container.
  - The largest run, a won route with six claimed rewards, is 33,364 bytes.
  - The largest saved finished AI game is 18,296 bytes.
  - Reading and validating them takes about 0.17 ms and 0.07 ms.
  - The fuzzers accept 244 of 2,000 runs in about 1.5 seconds, and restore
    64 of 400 saves in about 0.3 seconds.
  - A budget test keeps both slots under 64 KiB and seeded AI game logs
    under half the cap.
- **Status copy.** Each used relic charge gets a sentence from the reward
  catalog: its name, what the charge did, and the charges left. Results
  carry a frozen `relicsUsed` list, which the result panel shows.
  - A restart of the same attempt says it deals the same opening, and that
    no relic charge was used when the run holds a charged relic.
  - A draw says no chance was used.
  - A successful Retry Saving Result starts with "Result saved."
  - A refusal straight after the same refusal says "still". This applies to
    start, node, reward, Pause, Resume, result and Reset.
- **Announcer and focus.**
  - One persistent, visually hidden `role="status"` region speaks lobby,
    hub and HUD status. The rebuilt status paragraphs lose their live
    roles. While a modal dialog is open, the region sits inside it, because
    `showModal()` makes the rest of the page inert. Each move clears it.
  - A retried Adventure command announces an unchanged status again.
    During replay playback only the step status stays quiet. Any other
    status, such as a refused recording save, is announced.
  - Pause, Reset and Back to Lobby move focus to the lobby heading.
  - A node start or a restoring Resume moves focus to the Game Menu button.
  - Hub transitions follow the Milestone 5 focus order.
  - A refused write keeps focus on the activated control.
  - The result heading is described by its detail paragraph.
- **Stateful UI matrix.** The node, Choose and Skip controls run through
  the matrix in [`docs/agent/testing.md`](../agent/testing.md#adventure-decision-controls),
  against a real controller and tracked storage. The cases are:
  synchronous notification, rejected retry, stale input, duplicate
  activation, and disposal with the disposing subscriber before and after
  the interface. A waiting reward is also tested through Pause, Resume and
  Reset.
- **Markup and motion.**
  - A test plays a real run through the map, reward, paused lobby, result
    and completion, and finds no opponent card IDs, deck order or seeds in
    the markup.
  - The hub's tab order is pinned.
  - The Adventure CSS has no transitions, animations or keyframes, so
    reduced motion needs no override.
- **Browser evidence.** A production preview was checked at the four
  viewports, each at 100% and 200% text. The run covered the paused lobby,
  the map, a pending reward, a protected loss, Retry Saving Result, the
  completed run and a fresh run, plus reloads and keyboard transitions from
  scrolled pages. The pull request records the interaction, capture,
  inspection and attachment stages. The check found four defects, each now
  fixed with a test:
  - With the result unsaved, the narrow dock read "Winner: Player 1 The
    result is not saved yet." The winner text now ends as a sentence
    before the note.
  - The wide HUD, a fixed-height row that scrolls, showed Retry Saving
    Result and Reset Adventure Run below its fold at every wide viewport.
    Both now sit in its header row beside Menu. They use the narrow dock's
    short labels, Retry and Reset, and keep the full labels as accessible
    names.
  - Pause from a scrolled map focused the lobby heading above the fold.
    The lobby heading and the Game Menu button are now focused without
    `preventScroll`, so the browser scrolls them into view.
  - After Guardian Sigil used its last charge, the relic list said
    "Relics: none yet." It now says "Relics: none.", and still points to
    winning an encounter while a reward can be earned.

**Deviations from the contract above**

- Rules version and schema stay unchanged. Copy and caps alone needed no
  `ADVENTURE_REWARD_RULES_VERSION` or schema bump. The caps apply on read,
  and `relicsUsed` lives only in memory.
- The fuzzer found that a hand-edited counter of `1e308` made the score
  infinite. Counters, seeds and attempt numbers are therefore limited to
  safe integers, which every app-written run meets. A version 1 run holding
  an unsafe value converts to null, so it is unavailable. A stored high
  score outside the safe range reads as 0. Review then found that a counter
  already at the limit made the next result fail the guard, so counters
  now stop at the limit and the score is clamped.
- Transition focus applies to Adventure commands only. Back to Lobby moves
  focus only in Adventure mode, and starting other modes is unchanged.
  Focus also moves when a command removes the activated control, such as a
  successful lobby Reset. Focus stays put when nothing was focused before
  the command.
- Desktop emulation cannot show safe-area insets, a coarse pointer, reduced
  motion or real devices. They are covered by CSS and unit tests, and stay
  pending maintainer device verification.

**Milestone 7 handoff**

- Verify safe-area insets, coarse pointer and reduced motion on real phones
  and tablets, and record which devices were used.
- Update the README's Adventure rules: the map, rewards, relic copy and
  retry outcomes.
- Run the compatibility matrix with the malformed-save fixture and the
  fuzzers in place.

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
