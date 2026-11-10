# Testing

Tests live in `src/test/`, named after the module or behavior under test
(most modules have a single `<module>.test.ts`, but focused behaviors may
get their own files, e.g. `controller.test.ts` + `controller-ai-level.test.ts`,
`engine.test.ts` + `engine-log-events.test.ts`).
Runner: [vitest](https://vitest.dev/). Invocation:

```bash
npm run test    # vitest run
```

## Conventions

- **Co-locate by module or behavior under test.** A new module
  `src/app/foo.ts` typically gets `src/test/foo.test.ts`; if a single
  behavior is large or independently interesting, give it its own
  `foo-<behavior>.test.ts` (see `controller-ai-level.test.ts`,
  `engine-log-events.test.ts`). Keep names aligned with what's being
  exercised.
- **Use top-level `describe`/`it`/`test` from `vitest`.** Don't import
  jest-style globals.
- **Type stubs go in `src/test/node-shims.d.ts`.** The project intentionally
  avoids `@types/node` — when a test needs a Node API (e.g.
  `child_process.spawnSync`, additional `fs`/`path` members,
  `os.tmpdir`), extend the ambient shims rather than installing
  `@types/node`.

## Fake-timer hygiene

- Use `withFakeTimers(...)` from `src/test/helpers/timers.ts` for a single
  test, or `installFakeTimerHooks()` for a whole `describe` block. Do not
  open-code `vi.useFakeTimers()` / `vi.useRealTimers()` pairs in individual
  test files.
- Vitest fake timers can leak across tests *and across files* in the same
  worker, causing unrelated tests to hang or behave nondeterministically. The
  shared helper clears pending timers before restoring real timers.

## AI / engine tests

- **Asserted actions must be legal under the engine's exact equality
  rule.** `AppController` enforces actions through `isLegalActionForState`,
  which compares fields like `effectTargetId` exactly. When the opponent
  hand is non-empty in `swamp_target`, `getLegalActions` produces one
  `resolve_swamp_discard` action per target card. Assert against an action
  shape that `getLegalActions` actually emits.
- **Don't assert on internal AI tie-breaking.** Heuristics evolve. Assert
  that the chosen action is in the legal set and matches the strategic
  intent (e.g. disrupts a near-win opponent), not that it equals a
  specific card.

### Seeded AI and the Hard search

- **Seeding contract.** AI choices depend only on the state, the seat, the
  game seed, and the budget. AI modules take randomness from
  `src/game/ai-random.ts` only; `ai-randomness-sources.test.ts` bans
  `Math.random`, clocks, and crypto in `src/game/ai*.ts`. Tests pass an
  explicit seed and may assert that a decision repeats for the same inputs,
  after a JSON round trip, and with a reordered deck or zone.
- **Critical vs calm.** In critical positions (`decisionCriticality` of 1)
  Hard must choose identically for every seed, so tests may assert the exact
  action across many seeds (`criticalFixtures()` in `ai-hard.test.ts`). In
  calm positions assert only legality, membership in the reported
  candidates, and a variety floor over fixed states and seeds, never one
  particular class.
- **Budgets.** Default-suite tests use small budgets such as
  `{ determinizations: 4, rolloutTurns: 2 }`. The strength smoke test in
  `ai.test.ts` plays pinned mirrored seeds against the frozen pre-search
  Hard (`LEGACY_HARD` in `src/test/helpers/ai-baselines.ts`); the seeds are
  fixed, so it cannot flake.
- **Opt-in tools.** Full-budget measurements are not part of `npm run test`.
  `npm run ai:tournament` plays mirrored matches between entrant specs (see
  `src/test/helpers/ai-entrants.ts`) and, with
  `AI_TOURNAMENT_DIAGNOSTICS=1`, reports seed variety in calm and critical
  positions and a blunder audit against a 4×-budget search.
  `npm run ai:tune` refits the evaluator weights on self-play and reports
  the held-out log-loss of the fit and of the frozen weights, overall and per
  deck kind. Both document their environment variables in
  `src/test/tools/`. Run no more tools in parallel than there are CPUs, or
  the latency columns are inflated. Paste results into the PR.
- **Promoting weights or settings.** Promote a refit only if it beats the
  frozen weights on held-out log-loss and the `search-candidate` entrant
  (`AI_CANDIDATE_WEIGHTS` set to the report) beats `search` in mirrored
  tournaments on the starter, mono and dual decks, with the pooled 95%
  interval above 50%. Copy the weights into `src/game/ai-weights.ts` and
  bump `HARD_AI_WEIGHTS_VERSION`. Any change to
  the weights, `HARD_AI_DEFAULT_BUDGET`, `HARD_AI_DEFAULT_SELECTION`, or the
  personas changes Hard's choices: regenerate the CLI characterization with
  `npx vitest run src/test/cli-session.test.ts -u` and confirm that only
  `ai-hard-seed-77.characterization.json` changed. The Basic and Advanced
  fixtures must stay byte-identical.

## Stateful UI regression matrix

For target pickers, response controls, and submission changes, exercise the
[reentrant submission contract](state-and-persistence.md#reentrant-ui-submissions)
with deterministic fixtures and existing Vitest helpers:

| Scenario | Required assertion |
| --- | --- |
| Accepted action with synchronous notification | The next decision remains usable; cleanup cannot dismiss its picker. |
| Unchanged-decision rejection or status-only update | Still-legal selection survives and retry works. |
| Decision/session/legality advances before input is handled | Stale buttons, hits, and callbacks cannot submit, even when ids are reused. |
| Duplicate native/board activation or pointer release | At most one accepted submission; rejection does not permanently lock input. |
| Escape/cancel, reset, or disposal during notification | No accidental action, stale state restoration, or rendering after disposal. |
| Empty, single, multiple, or duplicate-name target choices | Correct existing selection behavior and exact legal target identity are preserved. |

Reuse the controller and `three-interface.test.ts` harness patterns, but include
notifications that synchronously update the interface, not only mocks that return
an unchanged view. Cover both the native HTML and battlefield consumers when
shared behavior changes. Check keyboard/focus and pointer paths where relevant.
Do not introduce a new browser/GPU test stack to replace existing focused tests;
mocked coverage remains separate from real-browser verification.

### Adventure decision controls

`three-interface.test.ts` runs the node, Choose and Skip controls through
the matrix with `setupRealAdventure()`. This helper drives a real
`AppController` over tracked storage and adds these controls:

- `hold()` and `release()` delay presenting views, so the controller can
  move on before the interface does.
- `subscribe(listener, first)` adds a subscriber that runs before or after
  the interface's own.

For each control:

- **Synchronous notification:** one dispatch, one run write, then the next
  decision is focused and announced.
- **Rejected retry:** a refused write keeps the decision key and focus, and
  each repeated refusal is announced again. Once storage recovers, the retry
  writes the run once.
- **Stale input:** a control whose decision moved on behind the interface
  dispatches nothing and refreshes the interface.
- **Duplicate activation:** a repeat before or after the re-render dispatches
  once.
- **Disposal during notification:** with the disposing subscriber either
  before or after the interface, nothing throws, the command applies once,
  and nothing moves focus, rebuilds markup or writes the announcer after
  disposal.

A pending reward is also tested through Pause, Resume and Reset. Target
cardinality does not apply, because each control has exactly one target.
Adventure tests that refuse writes use `src/test/helpers/tracked-storage.ts`:

- `calls` records each `set:<key>` and `remove:<key>`.
- `failingSets`, `failingRemoves` and `failingGets` refuse operations per
  key.

## Malformed Adventure saves

- **Fixture.** `src/test/fixtures/adventure-malformed-v2.ts` builds 14
  valid schema version 2 bases from a fixed seed through the real run
  transitions, and deep-freezes them. It also holds:
  - 60 curated cases, each breaking one rule, in six categories: map,
    offer, relic, history, attempt and counter;
  - variants that must still be accepted.
- **Fuzzer.** `src/test/adventure-fuzz.test.ts` reads 2,000 randomly edited
  runs and 400 edited mid-game saves from fixed `lcg` seeds. For each one:
  - Reading never throws or writes.
  - An accepted run passes the guard, survives a JSON round trip, and keeps
    a finite score.
  - An accepted run plays on through Resume, a reward, a node start and a
    result.
  - A mid-game save restores only when its identity matches and the game
    can continue.
- **Reproducing a failure.** Each problem is reported with its case number,
  base and edits, and the seeded stream repeats exactly on every run. Turn a
  failure into a curated case in the fixture, then fix the guard. Do not
  change the seed to get past it.
- **Cost.** The suite takes about 2 seconds. Keep case counts bounded.

## Browser-API tests

- Mock `window.matchMedia`, `beforeinstallprompt`, `appinstalled`,
  `MediaQueryList.addListener` etc. The patterns in
  `src/test/install-support.test.ts` are the reference.
- Vitest runs in Node by default in this repo (no global jsdom setup). For
  native-interface tests, follow existing patterns: assert escaped HTML and
  manually stub the minimal `window`/`navigator` surface when needed (see
  `src/test/three-interface.test.ts`).

## Build-behavior tests

For correctness that depends on Vite's bundler behavior (e.g.
`import.meta.env.BASE_URL` static replacement), add a test that actually
invokes `vite build`. See `src/test/card-art-base-path.test.ts`:

- Runs `vite build` with a custom `VITE_BASE_PATH`.
- Asserts the configured base is baked into the built bundle.
- Asserts that no `import.meta.env` reference survives the build.

These tests are slower but catch failures that source-level checks miss.

## Creature catalog and terminology release matrix

The player-facing creature migration intentionally leaves legacy mechanical
identifiers in engine and compatibility code. Do not add a repository-wide
assertion that legacy words never occur. For a release audit, classify each
match as player-facing (must use approved copy), compatibility/internal (must
remain stable), or historical (leave under `docs/history/`, with context when
linked or quoted).

| Surface | Focused coverage | Release invariant |
| --- | --- | --- |
| Catalog and deterministic identity | `card-catalog.test.ts`, `game-types.test.ts`, `cards.test.ts` | Exact names, rules, slugs, frozen entries, and `Forest, Island, Mountain, Plains, Swamp` order; Mimic excludes Echo Doppelgänger, not merely the current instance |
| Shared projection and browser copy | `game-presentation.test.ts`, `view-model.test.ts`, `action-resolution.test.ts`, `three-interface.test.ts`, `three-battlefield-controls.test.ts`, `tutorial.test.ts` | Catalog-backed tutorial and nested Mimic prompts; immutable snapshots; inline rules for visible Hand/Board/Discard pile and full preview rules including Intercept; Banish names the owner's discard pile; hidden hands stay redacted |
| Logs and CLI | `log-presentation.test.ts`, `three-native-html.test.ts`, `cli-session.test.ts` | Structured and known legacy logs use the same viewer-aware catalog copy; generic draws do not claim a Listen In source; CLI vocabulary remains aligned without adding rule/Discard pile inspection |
| Browser metadata and art | `browser-metadata.test.ts`, `card-art.test.ts`, `card-art-assets.test.ts`, `card-art-base-path.test.ts`, `card-art-generator.test.ts`, `service-worker.test.ts` | Approved title/description, exact ASCII-slug inventory, non-root URLs, fallback order, and network-first public art |
| Persistence and P2P | `game-recording.test.ts`, `adventure-persistence.test.ts`, `view-model.test.ts`, `action-validation.test.ts`, `p2p-compatibility.test.ts` | Existing saves and v1/v2 recordings load unchanged; persisted Adventure labels are not rendered; packets contain no display copy |

The browser Adventure label **Summons attempted (both players)** must preserve
the existing `totalCardsPlayed` count, including intercepted submissions.
Presentation-grouping or resource-cache keys may use display metadata; tests
must forbid display-based mechanical identity, not all display-keyed objects.

When a compact visual label is necessary, its accessible name must retain the
full term: **Action phase**, **Interception window**, or **Discard pile**.
Verify Gravebloom Dryad and Echo Doppelgänger, plus long Intercept and Banish
instructions, at narrow portrait, short landscape, and 200% browser text. Text
must wrap without clipping, controls remain at least 44 CSS pixels, and
stage-level prompts must not resize card rows or cancel an active drag.
`css-image-rendering.test.ts`, Three.js layout/interface tests, and mocked GPU
tests guard the underlying contracts; only a production-browser check can
establish actual zoom, font, and viewport behavior.

## Asset tests

`src/test/card-art-assets.test.ts` validates the shipped PNGs:

- Strictly square (`width === height`).
- ≥ 256×256.
- Every Cats and Anime file differs byte-for-byte from its deterministic
  geometric fallback.

Replacement assets must satisfy those constraints; the
`public/cards/README.md` docs match the test expectations.

`src/test/card-art-generator.test.ts` keeps the fast 256×256 two-run
repeatability check and separately generates at the shipping 1024×1024 size.
It compares all five generated slugs byte-for-byte with the committed
`classic` and `hd-fallback` inventories. Output is isolated in
project-local scratch directories and removed after the suite; tracked PNGs
are never overwritten by this check:

```bash
npm run test -- src/test/card-art-generator.test.ts
```

Classic intentionally renders procedural art. Deterministic PNG parity,
dimensions, provenance hashes, or primary/fallback inequality do not establish
visual acceptance. Use `cmp`, file metadata, or hashes to report asset identity
without claiming image inspection. The Cats and Anime files still require browser
verification as described below.
Hosted-generation credentials matter only if an operator deliberately generates
new replacements; they are not required to restore verified repository objects.
Record actual browser visual verification separately, following the checkpoint
and image-evidence procedure below.

## Three.js tests

`three-*.test.ts` exercises pure layout/quality policies, pointer capture,
retained resources, native UI actions, event playback, and renderer lifecycle.
`renderer-host.test.ts` covers asynchronous loading, latest-view buffering,
stale-load rejection, accessible retry, and same-controller recovery. Graphics
tests use injected or mocked browser/GPU surfaces, not network assets.

The production card-art base-path test also checks Vite's generated manifest:
Three.js must remain a dynamic entry outside the initial application graph, no
Phaser entry may be emitted, and public asset URLs must keep the configured
non-root base. A source-only assertion cannot establish these properties.

`browser-renderer-architecture.test.ts` guards the consolidation boundary: no
Phaser dependency/import, standalone `DomRenderer`, renderer kind, or removed
renderer directory may return.

GPU mocks cannot prove visual correctness or device performance. Check a
production preview in actual WebGL2 browsers: mouse, touch/pen, orientation
changes, target pickers, overlapping card rows, reduced motion, offline loads, and
context loss. Record which browsers/devices were actually exercised; do not
claim Android/iOS coverage from desktop emulation.

## Browser verification and evidence

1. Complete the [production build](validation-and-build.md#validation-evidence-and-production-preview)
   before smoke-testing its output. Verify preview-server readiness, the
   configured base path, legacy URL normalization, and Three.js startup. Keep the built output unchanged
   throughout the check; record browser/version, viewport, build revision, and
   any console or asset-loading errors.
2. Use the supported browser tools for navigation, interaction, and screenshots.
   On failure, inspect the actual tool error. If it explicitly reports a missing
   browser, use its supported browser-install operation; if it reports an
   unavailable server or incorrect URL, correct that evidenced condition.
   Retry the failed operation at most once when safe. Do not substitute ad hoc
   ChromeDriver/Python scripts, add browser dependencies, or bypass network
   restrictions merely to obtain a screenshot.
3. Record interaction results and checkpoint code/check results before image
   handling. Record **interaction completed**, **screenshot captured**,
   **screenshot inspected**, and **evidence attached** separately. A capture
   result proves neither visual correctness nor successful attachment.
4. Before inspection/upload, confirm the returned screenshot path exists and
   contains a non-empty, decodable image using supported image/file tools.
   Keep it until inspection and upload finish; do not reuse a path from an
   earlier session without checking it. Inspect the actual captured state, not
   just the image's existence. Perform inspection separately from collection
   of final automated-check results.
5. Follow the [PR evidence procedure](pr-workflow.md#screenshots) for a
   reviewer-accessible reference. If browser, image, or upload tooling remains
   unavailable, stop that operation, preserve textual observations and
   automated results, and mark the affected stages **blocked**. Request
   maintainer visual verification; do not claim coverage from mocks or silently
   waive screenshots. Do not retry an operation whose side effects are uncertain.

### Adventure hub check

Use the production preview with the base path. Check each Adventure state
at four viewports, each at 100% and 200% root font size:

- **States:** the paused-run lobby, the map, a pending reward, an encounter
  result, Retry Saving Result (refuse the write in storage), and a completed
  run.
- **Viewports:**
  - 390×844 (narrow portrait);
  - 844×390 and 720×360 (short landscape);
  - 1280×800 (wide).

In each state, check that:

- the page has no horizontal overflow;
- every control is at least 44 CSS pixels in both dimensions;
- every control can be reached: it is in view, or the page or its own
  scroll container scrolls to it, and no other element covers it;
- Tab reaches the controls in the documented hub order;
- focus lands where [the focus rules](three-interface.md#adventure-hub)
  say, and stays in view when the command starts from a scrolled page
  (Pause, Reset, Back to Lobby, a node start);
- the announcer's text matches the visible status, and nearby copy agrees
  with it, such as the relic list after a relic uses its last charge.
  Opening or closing a dialog moves the announcer and empties it, so it
  stays empty until the next status. A status that arrives with the move
  appears about 100 ms later.

`document.elementFromPoint` skips elements with `pointer-events: none`, so
the board's focusable labels look covered by the canvas. Confirm those by
their visible focus outline instead.

Desktop emulation cannot show safe-area insets, a coarse pointer, reduced
motion, or real phones and tablets. Record the CSS and unit coverage for
those, and mark them pending maintainer device verification. Do not waive
them.
