# Urban-fantasy creature terminology migration plan

## Status and approved decisions

This is an implementation plan only. It does not change game behavior, persisted
data, card artwork, or player-facing copy by itself.

The following decisions are approved and are requirements for implementation:

1. Existing saved games, Adventure state, and recordings remain compatible.
2. The first migration changes player-facing terminology while retaining the
   current serialized and internal identifiers.
3. The player-facing name of the battlefield zone is **Board**.
4. New creature artwork is part of the migration, but lands in a separately
   reviewable phase and PR.
5. The app title is **Urban Creatures** and its subtitle/description is
   **“Urban-fantasy 2-player card game with local AI and optional P2P mode.”**

## Goals

- Present the game as an approachable urban-fantasy creature game without
  requiring Magic: The Gathering terminology.
- Give each current mechanical card identity one stable display name, ability
  name, rules text, asset slug, and visual/color role through a centralized
  catalog.
- Make the DOM, Phaser, Three.js, accessibility, CLI, tutorial, action prompts,
  logs, effects, and documentation use the same player-facing vocabulary.
- Preserve deterministic gameplay, AI behavior, P2P actions, saved Adventure
  runs, imported recordings, and replay behavior.
- Ship complete creature artwork and graceful fallbacks for every existing
  visual style in a dedicated, reviewable change.

## Non-goals

- Do not change card effects, win conditions, deck composition, turn structure,
  legal actions, AI policy, or hidden-information rules.
- Do not rename `BasicLand`, `Card.type: 'land'`, `GamePhase`, engine helpers, or
  legacy `Forest`/`Island`/`Mountain`/`Plains`/`Swamp` values in the initial
  release.
- Do not rename action discriminants such as `play_land`, `counter_land`,
  `pass_response`, `resolve_plains_reuse`, or `resolve_swamp_discard`.
- Do not rename event discriminants such as `ability_forest_return` or persisted
  fields such as `battlefield`, `graveyard`, `pendingLandPlay`,
  `pendingPlainsReuse`, `pendingSwampDiscard`, and `landsPlayedThisTurn`.
- Do not bump the recording schema merely to change presentation.
- Do not rewrite existing saved JSON or mutate historical recording contents.
- Do not include broader internal schema modernization in the initial migration.
  A future project may introduce neutral mechanical identifiers after an
  explicit, versioned migration design.

## Approved card catalog

The first column remains the stable legacy mechanical and serialized key. It is
not player-facing after the migration.

| Serialized key | Display name | Asset slug | Ability | Rules text | Response ability |
| --- | --- | --- | --- | --- | --- |
| `Forest` | **Gravebloom Dryad** | `gravebloom-dryad` | **Reclaim** | Return one creature from your discard pile to your hand. | — |
| `Island` | **Signal Siren** | `signal-siren` | **Listen In** | Draw one card. | **Intercept** — Discard Signal Siren and one other card to cancel an opponent's summon. |
| `Mountain` | **Rooftop Gargoyle** | `rooftop-gargoyle` | **Banish** | Choose an opposing creature on the board and send it to its owner's discard pile. | — |
| `Swamp` | **Memory Vampire** | `memory-vampire` | **Drain Memory** | Choose one card from your opponent's hand for them to discard. | — |
| `Plains` | **Echo Doppelgänger** | `echo-doppelganger` | **Mimic** | Repeat the ability of one of your other creatures. | — |

`Echo Doppelgänger` deliberately uses Unicode in display copy. File names, URLs,
texture keys derived from file names, and generator arguments use the ASCII slug
`echo-doppelganger`; code must never derive the asset path by lowercasing or
otherwise transforming the display name. CLI choices remain numbered and show
catalog display names.

## Approved terminology

| Current player-facing term | Approved term |
| --- | --- |
| Land | Creature |
| Play land/card | Summon creature |
| Battlefield | Board |
| Graveyard | Discard pile |
| Destroy | Banish — always state that the creature goes to its owner's discard pile |
| Counter | Intercept |
| Response phase/window | Interception window |
| Pass Response | Let It Through |
| Return from graveyard | Reclaim |
| Plains reuse | Mimic ability |
| Swamp discard | Drain Memory |
| Main phase | Action phase |
| End Turn | **End Turn** (unchanged) |
| Deck | **Deck** (unchanged) |
| Hand | **Hand** (unchanged) |
| Draw | **Draw** (unchanged) |

Internal identifiers may continue to contain `land`, `battlefield`, `graveyard`,
`counter`, `response`, `plains`, and `swamp`. New player-facing strings must not.
Developer-facing documentation may use a legacy term when explaining the
compatibility boundary, but should pair it with the new display term.

## Compatibility and determinism strategy

### Stable wire and storage contracts

- Keep `BasicLand` and `BASIC_LANDS` in `src/game/types.ts` as
  `Forest | Island | Mountain | Plains | Swamp`.
- Keep cards serialized as the existing `Card` shape, including
  `name: BasicLand` and `type: 'land'`.
- Keep `GamePhase`, `GameAction`, and `LogEvent` discriminants unchanged.
  Continue accepting and emitting the current action payloads through
  `src/app/action-validation.ts`, `src/app/controller.ts`, and `src/net/p2p.ts`.
- Keep the current persisted field names and storage keys. In particular, do not
  rename the Adventure snapshot fields validated by `src/app/adventure.ts` or
  the recording fields validated by `src/app/game-recording.ts`.
- Keep `GAME_RECORD_VERSION` unchanged for this presentation-only migration.
  Version 1 upgrades and version 2 recordings must continue to import.
- Add display metadata only at the app/presentation boundary. Never serialize
  display names or asset slugs in place of the legacy mechanical key.
- Preserve hidden-hand behavior. `players[].handCards` must remain redacted with
  `HIDDEN_HAND_CARD_NAME`; only the existing narrowly scoped Drain Memory
  decision projection may reveal the opponent's real hand.

This means old and new clients continue to exchange the same P2P `action`
packets. Mixed-version peers can play the same deterministic match even though
their local labels differ.

### Stable identity ordering

The order of the current card identity array is a compatibility constraint:

```ts
['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']
```

Do not alphabetize, reorder, or rebuild this sequence from object keys. The
order feeds deck construction before the seeded shuffle in
`src/game/cards.ts`; changing it changes seeded shuffles, deterministic games,
test fixtures, AI-vs-AI results, and recording timelines. Prefer one canonical
ordered tuple from `src/game/types.ts`, and have catalog iteration explicitly
follow that tuple. Add a regression assertion for the exact order.

### Old text logs

Structured `LogEvent` values retain legacy discriminants and card keys but are
formatted through the new catalog. Existing snapshots and recordings may also
contain pre-structured `log: string[]` entries with old English text. Do not
rewrite those persisted arrays. If the legacy fallback log is shown, pass only
the finite set of known engine-generated, parameterized templates through a
conservative, viewer-aware presentation adapter. The adapter must recognize the
template shape, map interpolated legacy card keys through the catalog, translate
verbs/zones such as `destroys` and `graveyard`, and redact an opponent's drawn
card name when that card is hidden from the viewer. Structured-event formatting
must apply the same draw redaction instead of rendering `LogEvent.draw.cardName`
or card art. Unknown or user-edited strings remain unchanged. Test structured
and legacy draw redaction separately. This preserves data while minimizing
legacy terminology in the UI.

## Proposed centralized card catalog

Create `src/app/card-catalog.ts` as a pure app-layer module. It may import the
stable `BasicLand`/`BASIC_LANDS` contract from `src/game/types.ts`, but
`src/game/` must not import the catalog.

Proposed model:

```ts
export interface CardAbilityCopy {
  readonly name: string
  readonly rulesText: string
}

export interface CardCatalogEntry {
  readonly serializedKey: BasicLand
  readonly displayName: string
  readonly assetSlug: string
  readonly primaryAbility: CardAbilityCopy
  readonly responseAbility?: CardAbilityCopy
  readonly visualRole: 'green' | 'blue' | 'red' | 'white' | 'black'
}

export const CARD_CATALOG: Readonly<Record<BasicLand, CardCatalogEntry>>

export function cardCatalogEntry(key: BasicLand): CardCatalogEntry
export function displayCardName(key: BasicLand): string
export function cardAssetSlug(key: BasicLand): string
```

Implementation requirements:

- Freeze every nested `primaryAbility`/`responseAbility` object before freezing
  each entry and the exported record; `Object.freeze` is shallow, so freezing
  only the entries does not satisfy the runtime immutability contract. Make all
  five keys exhaustive at compile time with
  `satisfies Readonly<Record<BasicLand, CardCatalogEntry>>`.
- Keep visual/color roles attached to serialized identity so the existing
  Forest/green, Island/blue, Mountain/red, Plains/white, and Swamp/black
  mechanics and contrast palettes remain stable. `visualRole` documents that
  invariant for art/generator consumers; existing runtime palettes remain keyed
  by `BasicLand` unless a concrete consumer justifies the extra indirection.
- Do not expose a reverse display-name-to-key parser. Display names are copy,
  not identifiers or trusted input.
- Make `src/app/game-presentation.ts` the primary translation boundary for
  action labels and projected card names. Renderers should consume catalog-backed
  display data or catalog helpers rather than maintain their own maps.
- Keep mechanical branching on `BasicLand` keys. For example, target selection
  in `src/app/action-resolution.ts` still branches on `Forest`/`Mountain`/
  `Swamp`/`Plains`; only its returned labels use catalog display copy.
- Preserve literal `import.meta.env.BASE_URL` access in `src/app/card-art.ts`.
  Change only the final filename component from legacy key to catalog asset
  slug.
- Decide one explicit projection shape before implementation. The preferred
  option is to keep a `serializedKey: BasicLand` alongside a catalog-derived
  `displayName` on visible UI card snapshots. Do not replace the key with a
  display string, because renderer legality, effects, targeting, and artwork
  still need stable identity.

## Suggested player-facing copy

These strings are a copy baseline. Implement them through shared helpers where
the same action appears in more than one renderer.

### Tutorial

1. **Listen In / Intercept:** “Summon Signal Siren. Your opponent has a Signal
   Siren and will intercept your first summon.”
2. **Interception window:** “Your opponent may intercept now by discarding
   Signal Siren and one other card. If they do, your Signal Siren goes to your
   discard pile.”
3. **Reclaim:** “Summon Gravebloom Dryad to reclaim Signal Siren from your
   discard pile.”
4. **Draw:** “Summon Signal Siren again. Listen In draws one card.”
5. **Banish:** “Summon Rooftop Gargoyle, then choose an opposing creature to
   banish to its owner's discard pile.”
6. **Drain Memory:** “Summon Memory Vampire, then choose one card from your
   opponent's hand for them to discard.”
7. **Mimic:** “Summon Echo Doppelgänger, then choose one of your other creatures
   whose ability it should mimic.”
8. **Win:** “You won by summoning all five creature types to your board.
   Tutorial complete!”

The tutorial conditions and deterministic tutorial decks in
`src/app/tutorial.ts` and `src/game/cards.ts` remain keyed by legacy identities.

### Actions and response instructions

- `Summon Gravebloom Dryad`
- `Summon Rooftop Gargoyle (Banish Signal Siren to its owner's discard pile)`
- `Mimic Signal Siren — Listen In`
- `Drain Memory — choose a card for your opponent to discard`
- `Intercept with Signal Siren (discard Signal Siren + Memory Vampire)`
- `Let It Through`
- `End Turn`
- Interception prompt: “Intercept the summon of Rooftop Gargoyle? Discard
  Signal Siren and one other highlighted card, or choose Let It Through.”
- Required-card hint: “Signal Siren is included automatically; choose the other
  card to discard.”

### Target prompts

- Reclaim: “Choose a creature in your discard pile to return to your hand.”
- Banish: “Choose an opposing creature to send to its owner's discard pile.”
- Drain Memory: “Choose a card from your opponent's hand for them to discard.”
- Mimic: “Choose one of your other creatures whose ability Echo Doppelgänger
  should repeat.”
- Generic summon target: “Choose a target for this creature's ability.”

### Logs and effect feedback

- `P1 summons Gravebloom Dryad`
- `P1 reclaims Signal Siren from their discard pile`
- `P1 listens in and draws a card`
- `P1 drains a memory; P2 discards Memory Vampire`
- `P1 banishes P2's Signal Siren to its owner's discard pile`
- `P1's Echo Doppelgänger mimics Rooftop Gargoyle — Banish`
- `P2 may intercept P1's summon of Signal Siren`
- `P2 intercepts Signal Siren by discarding Signal Siren and another card`
- Compact effect captions: `Summoned`, `Reclaimed`, `Drew a card`,
  `Memory drained`, `Banished to discard pile`, `Ability mimicked`,
  `Intercepted`.

Never use “destroyed” as a shortened Banish message. The visible text or
adjacent accessible description must say that the creature goes to its owner's
discard pile.

### Zone and phase labels

- Full labels: `Action phase`, `Interception window`, `Board`, `Discard pile`,
  `Deck`, `Hand`.
- Compact mobile visual labels: `Action`, `Intercept`, `Board`, `Discard`,
  `Deck`, `Hand`. Their `aria-label`/accessible text must retain the full terms
  `Action phase`, `Interception window`, and `Discard pile`.
- Empty states: `No creatures on the board.` and `Discard pile empty.`

### App and Adventure copy

- App title: `Urban Creatures`
- App subtitle/description: `Urban-fantasy 2-player card game with local AI and
  optional P2P mode.`
- Tutorial start status: `Tutorial started. Follow the hint panel to learn each
  creature ability.`
- Adventure opponent labels are derived for display from the validated `kind`
  and `lands`, not from persisted `label`: `Balanced roster (10 of each
  creature)`, `Duo: Gravebloom Dryad + Signal Siren`, `Mystery roster`, and
  `Boss: Gravebloom Dryad specialist` are the standard, example dual, random,
  and example mono forms.

## Phased file-by-file implementation plan

### Phase 0 — Baseline and contract tests

- Use Node 24 and run `npm ci`; record Node/npm versions and the baseline
  revision.
- Capture baseline results for `npm run lint`, `npm run test`,
  `npm run test:bench`, and `npm run build`. Although the benchmark is not
  expected to change, run it for final migration/deployment parity.
- In `src/test/game-types.test.ts`, preserve the exact `BASIC_LANDS` order
  assertion.
- Add catalog contract tests before changing consumers: exact five-key coverage,
  exact approved copy, unique ASCII slugs matching
  `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, and the Unicode-display/ASCII-slug distinction
  for Echo Doppelgänger. Assert that the exported record, every entry, and every
  nested ability object are frozen at runtime.

### Phase 1 — Catalog and engine/presentation boundary

- **`src/app/card-catalog.ts` (new):** add the exhaustive immutable catalog and
  lookup helpers described above.
- **`src/game/types.ts`:** retain all types, discriminants, persisted names, and
  canonical order. Add no display copy here.
- **`src/game/cards.ts`:** preserve deck and tutorial order exactly. If its
  duplicate `BASIC_LANDS` array is replaced with the canonical export, verify
  seeded deck snapshots before and after.
- **`src/game/engine.ts`:** keep mechanics, structured event payloads, and
  persisted `state.log` strings unchanged. Do not import the app catalog into
  the engine. Format structured events and legacy text only at the
  app/presentation boundary.
- **`src/app/types.ts`:** add separate stable identity and display fields to UI
  projections as needed; retain the current legacy-named legal-action fields
  during this release.
- **`src/app/view-model.ts`:** project immutable catalog-backed display
  snapshots, translate pending-card display names, and preserve scoped
  opponent-hand redaction.
- **`src/app/game-presentation.ts`:** centralize visible card names, summon
  labels, Mimic/Drain Memory labels, Banish destination wording, Intercept,
  Let It Through, and viewer-aware structured/legacy-log presentation. Keep
  duplicate-action disambiguation behavior.
- **`src/app/action-resolution.ts`:** retain legacy mechanical comparisons and
  target modes, but return catalog-backed target names and approved prompts.
- **`src/app/response-options.ts`:** continue selecting the required mechanical
  `Island` card, but return Signal Siren/Intercept instructions and accessible
  labels.
- **`src/app/visual-effects.ts`:** preserve event kinds and anchor identities;
  source card names and effect copy from the catalog.

Acceptance gate: identical seeds produce identical card IDs, deck order, legal
actions, state transitions, and structured event payloads before and after this
phase; only projected display copy differs.

### Phase 2 — Shared copy, tutorial, logs, and CLI

- **`src/app/tutorial.ts`:** replace every hint with the suggested creature
  wording while leaving condition IDs, phases, keys, and tutorial sequencing
  stable.
- **`src/app/controller.ts`:** replace the tutorial-start status with the
  approved creature wording while leaving game setup, persistence, and packets
  unchanged.
- **`src/renderers/phaser/log-events.ts`:** format structured events with
  catalog display names and approved verbs, but omit an opponent's hidden draw
  name and card art. Keep the defensive unknown-event fallback.
- **`src/renderers/phaser/log-tiles.ts` and
  `src/renderers/three/interface-log.ts`, plus the Replay Log drawer in
  `src/renderers/dom.ts`:** display new labels/art through the shared
  viewer-aware formatter/adapter while retaining bounded structured-log and
  legacy-text fallback behavior.
- **`src/cli/session.ts`:** render `Board`, `Discard pile`, and `Action phase`/
  `Interception window`; use catalog names in Hand/Board/target lists and shared
  action labels. Preserve hidden AI-hand redaction and the narrowly scoped
  Drain Memory reveal.
- **`README.md`:** update the game description, controls, examples, card-style
  documentation, CLI text, and renderer guidance after behavior lands. Explain
  legacy identifiers only in contributor-facing compatibility notes.

Acceptance gate: tutorial, browser action labels, structured logs, legacy-log
fallback, and terminal output all use one catalog and agree on exact names.

### Phase 3 — DOM, Phaser, Three.js, and accessibility parity

#### DOM

- **`src/renderers/dom-utils.ts`:** update card tile and log helpers to accept a
  serialized key plus catalog display metadata; use the approved app
  title/subtitle in the lobby; retain escaped output and staged raster failure
  handling.
- **`src/renderers/dom.ts`:** change headings, Board/Discard pile counts,
  drop-zone labels, action tray, Interception window, Let It Through, target
  sheets, status messages, empty states, preview labels, drag instructions, and
  route the Replay Log drawer through the shared viewer-aware legacy adapter.
- **`src/style.css`:** accommodate Gravebloom Dryad and Echo Doppelgänger at
  supported phone widths and text zoom without reducing tap targets or clipping
  focus indicators.

#### Phaser

- **`src/renderers/phaser/card-factory.ts`,
  `card-view.ts`, `card-rendering.ts`, and `theme.ts`:** use legacy identity for
  mechanics/palette and catalog display name/slug for labels and art.
- **`src/renderers/phaser/lobby-scene.ts`:** use the approved app title/subtitle,
  retaining the renderer designation as secondary copy.
- **`src/renderers/phaser/battlefield-view.ts` and `drop-zone-view.ts`:** render
  `Board` labels and summon/drop guidance without changing geometry ownership.
- **`src/renderers/phaser/hand-controls.ts`,
  `response-controls.ts`, `battlefield-targets.ts`, and `target-picker.ts`:**
  update Intercept, Let It Through, Banish, Reclaim, Drain Memory, and Mimic
  prompts. Target labels must use catalog names and Banish must name the
  discard-pile destination.
- **`src/renderers/phaser/interaction-feedback.ts`,
  `effects.ts`, and `effect-controller.ts`:** update player-visible captions
  while retaining existing event recipes, queueing, anchors, and cleanup.
- **`src/renderers/phaser/a11y-navigation.ts`:** mirror every visible action and
  target with the same approved accessible label, including `Let It Through`.
- Keep `src/renderers/phaser/index.ts` a composition root and within its existing
  architecture line-count guard.

#### Three.js

- **`src/renderers/three/assets.ts` and `card-registry.ts`:** resolve art by
  catalog slug but retain serialized identity, palette role, stable card IDs,
  texture fallback order, and resource ownership.
- **`src/renderers/three/board.ts`:** replace play/response instructions,
  row/count labels, pending summon caption, and Board/Discard pile copy. Keep
  prompts in the existing stage-level overlay so long text does not resize card
  lanes or cancel active drags.
- **`src/renderers/three/interface-model.ts`:** update lobby description,
  approved app title, primary action, target dialogs, native card actions,
  response explanation, empty states, and compact labels.
- **`src/renderers/three/interface.ts`:** retain revalidation, decision keys,
  focus restoration, cancellation, and duplicate-submission safeguards while
  consuming the new model copy.
- **`src/renderers/three/effect-visual.ts`:** retain effect recipes and lifecycle;
  update only visible/accessibility descriptions where exposed.
- **`src/renderers/three/interface.css` and `graphics.css`:** test wrapping for
  long names and instructions at narrow/short viewports and 200% text zoom.
- **`index.html` and `public/manifest.webmanifest`:** use the approved title and
  subtitle/description for browser and installed-app metadata; preserve relative
  manifest/icon URLs and the non-root deployment base path.

Acceptance gate: all three renderers expose identical game meaning and legal
actions; keyboard and screen-reader routes do not reveal hidden cards or retain
old visible terms.

### Phase 4 — Creature artwork, layout, and cache (separate PR)

Use these exact paths:

```text
public/cards/
├── classic/
│   ├── gravebloom-dryad.png
│   ├── signal-siren.png
│   ├── rooftop-gargoyle.png
│   ├── memory-vampire.png
│   └── echo-doppelganger.png
├── hd/
│   └── (the same five slugs)
├── hd-fallback/
│   └── (the same five slugs)
└── monochrome/
    └── (the same five slugs)
```

- **`src/app/card-art.ts`:** build base-path-safe URLs from
  `entry.assetSlug`, not `BasicLand` or display name. Preserve literal
  `import.meta.env.BASE_URL` access and the `hd -> hd-fallback -> procedural`
  chain.
- **`src/app/card-visuals.ts`:** key mechanics and palettes by legacy identity,
  but replace the per-land `TEMPLATE_*` procedural pixel icons with
  creature-appropriate fallbacks. Retain raster-failure suppression and cached
  data URLs; retain `DEFAULT_CARD_VISUAL_STYLE` in
  `src/app/card-visual-styles.ts`.
- **`src/renderers/phaser/card-art-loader.ts`,
  `src/renderers/phaser/card-rendering.ts`, and
  `src/renderers/three/assets.ts`:** preload and resolve slugged assets through
  shared helpers; attempt each failed URL at most once and end on a playable
  procedural fallback.
- **`scripts/generate-card-art.mjs`:** generate deterministic,
  creature-appropriate `classic`, `hd-fallback`, and `monochrome` files under
  the approved slugs. The `classic` PNGs and procedural classic fallback must
  use the same creature-specific visual recipes rather than the existing
  palette swatches. Keep output byte-stable and execution Node-stdlib-only.
- **`scripts/generate-photoreal-card-art.mjs`:** replace land prompts and
  `--land` selection with catalog-aligned creature subjects and a slug/key
  selector; continue atomic writes and manual credential use. Never commit API
  keys or generated temporary files.
- **`public/cards/README.md`:** document the new layout, exact slugs, dimensions,
  generation commands, review workflow, and fallback order.
- Retain legacy-named PNGs only while a tested fallback or rollback path needs
  them; runtime code must request the new slug paths. Remove obsolete assets in
  the artwork PR only after confirming no source/docs references remain.
- **`public/sw.js`:** keep network-first handling for unhashed `/cards/*` and
  bump `CACHE_VERSION` with the artwork change so stale same-path assets and old
  cache entries are retired.

Artwork acceptance includes human review for readable silhouettes, urban-fantasy
cohesion, absence of embedded text/logos, correct creature-to-ability mapping,
color-role continuity, square crop safety, and contrast in all three selectable
styles plus the internal `hd-fallback` assets.

### Phase 5 — Persistence, recording, P2P, and compatibility verification

- **`src/app/game-recording.ts`:** keep accepted versions, validators, legacy
  upgrade logic, action/event shapes, and BasicLand values unchanged. Test that
  imported v1/v2 records render new names without changing reserialized
  mechanical state.
- **`src/app/adventure.ts` and `src/app/adventure-persistence.ts`:** load current
  localStorage snapshots unchanged. Preserve `opponentLineup[].label` as a
  legacy serialized field, but have `src/app/view-model.ts` derive each visible
  opponent label from the validated `kind` and `lands` through shared
  catalog-backed presentation copy. Never render the persisted label verbatim.
  Keep validation, caps, and backfills intact, and test a pre-migration snapshot
  containing `Standard Deck (10 of each land)` and `Boss: Mono Forest Deck`.
- **`src/app/action-validation.ts`, `src/app/controller.ts`, and
  `src/net/p2p.ts`:** retain current action packets and validation. Add a
  mixed-version contract test or fixture showing that the wire payload contains
  legacy keys/discriminants only.
- Verify replay at the first step, mid-response, pending Reclaim/Banish/Drain
  Memory/Mimic targets, and game over. Confirm structured events use new display
  copy and legacy text does not crash or mutate the recording.
- Compare deterministic fixtures for representative seeds, tutorial decks, and
  AI-vs-AI action transcripts before and after the presentation migration.

### Phase 6 — Documentation audit and release verification

- **`README.md`:** complete the player-facing terminology update and document
  all three renderers and CLI consistently.
- **`AGENTS.md` and `docs/agent/architecture.md`:** add a concise contributor
  rule that player-facing card copy comes from the catalog while serialized
  identities remain stable.
- **`docs/agent/state-and-persistence.md`:** document the display/serialized
  boundary, legacy recording expectations, and P2P compatibility.
- **`docs/agent/testing.md`:** add catalog/copy parity and mobile long-label
  checks to the relevant matrices.
- **`docs/agent/service-worker-and-pwa.md` and
  `docs/agent/dom-and-css.md`:** document slugged art/cache behavior and
  long-label/accessibility requirements.
- Do not revise historical documents under `docs/history/` to pretend they used
  the new vocabulary. Label links or quotations as historical where needed.
- Run the repository-wide terminology audit below and attach actual validation
  outcomes to the PR.

## Testing matrix

| Area | Relevant tests | Required additions/checks |
| --- | --- | --- |
| Stable identity and determinism | `src/test/game-types.test.ts`, `engine.test.ts`, `ai.test.ts`, `ai-perf.bench.ts`, `tutorial.test.ts` | Exact `BASIC_LANDS` order; unchanged seeded deck/action snapshots; unchanged legal actions and tutorial conditions |
| Catalog and presentation | new catalog test, `game-presentation.test.ts`, `view-model.test.ts`, `action-resolution.test.ts`, `action-validation.test.ts` | Exact names/rules/slugs; record, entries, and nested abilities frozen; immutable snapshots; no display names in action payloads; Banish destination wording; hidden-hand redaction |
| Engine events and logs | `engine-log-events.test.ts`, `phaser-log-events.test.ts`, `phaser-log-tiles.test.ts`, `visual-effects.test.ts`, DOM tests | Stable event discriminants and payload keys; new structured copy; safe unknown events; conservative legacy-text rendering; viewer-aware redaction of opponent draw names and art for structured and legacy logs |
| Response/interception | `phaser-response-options.test.ts`, `controller.test.ts`, `three-interface.test.ts`, DOM tests | Signal Siren remains the mechanical Island cost; another card is required; Let It Through parity; rejection/retry and duplicate activation |
| DOM | `dom-card-rendering.test.ts`, `dom-effects.test.ts`, `dom-lobby.test.ts` | Approved app title/subtitle, catalog names, slugged asset URLs/fallbacks, Board/Discard pile labels, escaped copy, no stale raster retry |
| Phaser | `phaser-card-rendering.test.ts`, `phaser-battlefield-view.test.ts`, `phaser-battlefield-targets.test.ts`, `phaser-drag-accessibility.test.ts`, `phaser-effects.test.ts`, `phaser-lobby-actions.test.ts`, `phaser-module-architecture.test.ts` | Approved app title/subtitle, long-name layout, action/a11y parity, target copy, effect feedback, lifecycle unchanged |
| Three.js | `three-assets.test.ts`, `three-interface.test.ts`, `three-battlefield-controls.test.ts`, `three-interaction.test.ts`, `three-effects.test.ts`, `three-renderer.test.ts` | Approved app title/subtitle, slug/fallback order, overlay wrapping, native controls, focus/retry/cancellation, compact labels, resource cleanup |
| CLI | `cli-session.test.ts` | Creature names and zones; Action/Interception phases; hidden hand remains hidden except during Drain Memory |
| Saves and replay | `game-recording.test.ts`, `adventure-persistence.test.ts`, `adventure.test.ts`, `view-model.test.ts`, `controller.test.ts` | Existing fixtures load unchanged; legacy Adventure labels are not rendered verbatim; pending target states resume; v1/v2 recording compatibility; no schema/version churn |
| Assets and offline | `card-art.test.ts`, `card-art-base-path.test.ts`, `card-art-assets.test.ts`, `card-visuals.test.ts`, `service-worker.test.ts`, `cache-version-check.test.ts` | Exact slug inventory in four directories; deterministic classic/HD-fallback/monochrome generation; square/dimension checks; non-root base URLs; fallback order; network-first cards; required cache bump |
| P2P | controller/action-validation/P2P-related tests | Legacy action JSON remains accepted and emitted; mixed-version peers stay deterministic; no display copy enters packets |

Final validation follows `AGENTS.md` and `docs/agent/validation-and-build.md`:

```bash
# Node 24
npm ci
npm run lint
npm run test
npm run test:bench
npm run build
```

Run `npm run generate:card-art` when its recipes change and verify the committed
output is reproducible. After changed-file secret scanning and committing, run
CodeQL checking with the repository-required triviality declaration, investigate
every result, and rerun after any fix. Record actual exit codes, test count,
benchmark result, tested revision, and any skipped/blocked checks separately.

## Manual verification matrix

- DOM, Phaser, and Three.js at desktop and narrow mobile widths, portrait and
  short landscape, normal and 200% text size.
- Browser tab and installed-app metadata plus every renderer lobby use the exact
  approved app title and subtitle/description.
- Keyboard-only and screen-reader traversal of Hand, Board, Discard pile,
  summon actions, all four target flows, Intercept, Let It Through, and End Turn.
- Human-vs-AI hidden hand before, during, and after Drain Memory, including a
  Mimic of Drain Memory; verify names are revealed only during the legal choice.
- Tutorial from first summon through completion.
- Recording export/import/replay using a pre-migration fixture and a new
  recording, including legacy text-log fallback.
- Resume a saved Adventure round in each pending phase and complete it without
  state loss.
- P2P between matching builds and, where practical, one old-copy client and one
  new-copy client; compare state/action JSON after each move.
- Every card visual style with online load, failed primary image, failed
  fallback, offline reload, and the configured non-root GitHub Pages base path.
- Inspect console/network output for legacy asset requests, repeated failed
  requests, missing slug files, and stale service-worker cache entries.

## Recommended PR breakdown

1. **Player-facing terminology and catalog**
   - Add the centralized catalog, app projection, shared labels, tutorial/log/CLI
     copy, renderer and accessibility updates, compatibility tests, and
     deterministic-order guards.
   - No new creature PNGs; existing procedural/legacy art remains a temporary
     visual fallback until PR 2.
2. **Creature artwork, layout, and cache**
   - Add all approved slugged assets, update art generators and loaders, verify
     long-name layout and fallback paths, update `public/cards/README.md`, and
     bump `public/sw.js` `CACHE_VERSION`.
   - Keep this PR independently reviewable for visual quality and generated
     binary changes.
3. **Documentation audit**
   - Update `README.md`, contributor deep-dives, player instructions, examples,
     and the final terminology audit after the UI/art behavior is settled.

Treat neutral internal/schema renames as optional future work in a separately
designed, versioned migration. Do not combine them with these PRs.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Long creature/ability labels overflow mobile cards or controls | Test Gravebloom Dryad and Echo Doppelgänger at narrow portrait, short landscape, and 200% text; wrap or use approved compact labels without shrinking tap targets or accessible names |
| Legacy text logs expose old terms | Format structured events from catalog keys; conservatively translate only exact known legacy templates at render time; never mutate recordings; retain safe fallback for unknown strings |
| Drain Memory exposes the opponent's hidden hand | Preserve `HIDDEN_HAND_CARD_NAME` in normal projections; keep the reveal in the existing dedicated field, only for the acting local human and only during the target decision; test direct and Mimic paths plus replay |
| Mixed-version P2P clients disagree | Keep action discriminants, payload fields, BasicLand values, card IDs, seed handling, and mechanics unchanged; ensure display strings never enter packets |
| Catalog iteration changes deterministic ordering | Iterate only the canonical `BASIC_LANDS` tuple in its current order; never use sorted display names or object-key order for deck creation |
| Unicode display name leaks into asset paths | Store `Echo Doppelgänger` and `echo-doppelganger` independently; validate ASCII slugs and exact URLs |
| Stale artwork remains offline | Use network-first `/cards/*`, bump `CACHE_VERSION` in the artwork PR, test activation/cache cleanup and offline fallback, and suppress repeated failed URLs |
| Legacy terms leak from one renderer or accessibility tree | Centralize copy, add parity assertions, and run the repository-wide source/DOM/accessibility/CLI audit below |
| Engine imports presentation catalog | Keep catalog in `src/app/`; engine emits stable mechanical events and app/renderers format them |
| Banish sounds like deletion rather than zone movement | Every rule, prompt, log, and accessible description states that the target goes to its owner's discard pile |
| Old saves are rejected by renamed validators | Do not rename or narrow current accepted keys/fields; keep recording version and Adventure guards stable and test current fixtures before changing copy |
| Art generator output or hosted generation introduces bad assets/secrets | Keep deterministic fallback generation local, photoreal generation manual and atomic, review binaries, scan changed files, and never commit credentials or temporary responses |

## Acceptance criteria

- All five approved display names, abilities, exact rules text, and ASCII slugs
  exist once in a centralized catalog and are consumed by all presentation
  surfaces.
- No initial-release save, Adventure, recording, action/event, P2P, or engine
  schema identifier changes.
- Existing supported recordings and Adventure snapshots load, resume, replay,
  and reserialize successfully.
- Legacy persisted Adventure opponent labels are retained in storage but never
  shown; catalog-backed labels are derived from validated mechanical fields.
- The canonical identity order remains
  `Forest, Island, Mountain, Plains, Swamp`, and deterministic seed/action
  fixtures are unchanged.
- DOM, Phaser, Three.js, accessibility mirrors, CLI, tutorial, logs, effects,
  prompts, status messages, lobbies, installed-app metadata, compact labels, and
  README use the approved player-facing terms.
- The player-facing zone is **Board** everywhere. No visible “Battlefield”
  remains.
- Every Banish explanation says that the creature goes to its owner's discard
  pile.
- Hidden opponent cards, including names and art in structured or legacy draw
  logs, remain redacted except during the existing legal Drain Memory target
  decision.
- Each approved slug exists under `classic`, `hd`, `hd-fallback`, and
  `monochrome`; missing/failed art reaches a playable fallback.
- Artwork is delivered in a separate reviewable PR and the service-worker cache
  version is bumped with the asset change.
- All automated and manual checks above are recorded with actual outcomes.

## Repository-wide final terminology audit

Run case-insensitive searches across source, tests, public documentation, and
generated UI output. Classify every match as **player-facing (must change)**,
**compatibility/internal (must remain)**, or **historical (may remain with
context)**.

- [ ] Card faces, previews, menus, actions, status text, tutorial hints, target
      pickers, logs, effect captions, empty states, and winner text use catalog
      names.
- [ ] DOM visible text and ARIA labels use Creature, Summon, Board, Discard
      pile, Banish, Intercept, Interception window, Let It Through, Reclaim,
      Drain Memory, Mimic, and Action phase.
- [ ] Phaser canvas text and native accessibility navigation use the same terms.
- [ ] Three.js canvas/HTML interface, native card dialog, prompts, logs, and
      accessible controls use the same terms.
- [ ] CLI state, phase, zone, action, target, and transcript output use the same
      terms.
- [ ] README and current contributor docs describe the shipped UI accurately.
- [ ] “Destroy” has no player-facing occurrence; each Banish description names
      the owner's discard pile destination.
- [ ] “Battlefield”, “Graveyard”, “Pass Response”, “Main phase”, “Play land”,
      and bare “Counter” have no unintended player-facing occurrence.
- [ ] Legacy `Forest`, `Island`, `Mountain`, `Plains`, and `Swamp` appear only in
      mechanical logic, serialization/validation, compatibility tests, or
      explicitly marked contributor documentation.
- [ ] `BasicLand`, `Card.type`, `GamePhase`, `GameAction`, `LogEvent`, pending
      fields, Adventure snapshots, recording versions, and P2P packets retain
      their current values.
- [ ] `BASIC_LANDS` remains in its original order everywhere that order affects
      deck construction or fixtures.
- [ ] No display name is used as an identifier, parser input, object key, file
      name, URL segment, or wire value.
- [ ] Every asset path uses an approved ASCII slug and works under a non-root
      `BASE_URL`.
- [ ] All four asset directories contain exactly one current file per catalog
      entry, with documented fallback behavior and no accidental runtime
      references to obsolete names.
- [ ] Hidden-hand tests prove no catalog lookup or target label unredacts an
      opponent's hand outside Drain Memory.
- [ ] Existing-save, Adventure, recording/replay, P2P, deterministic-seed,
      service-worker, renderer, accessibility, mobile-layout, CLI, and build
      checks pass.
