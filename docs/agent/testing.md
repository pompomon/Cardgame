# Testing

Conventions for Vitest tests in `src/test/` (`npm run test`), the AI and
stateful UI test contracts, and browser verification.

## Rules

- Use `withFakeTimers(...)` or `installFakeTimerHooks()` from
  `src/test/helpers/timers.ts`; never open-code fake-timer setup or teardown.
- AI-policy assertions use actions that pass `isLegalActionForState`,
  including `effectTargetId` when the opponent hand is non-empty.
- When correctness depends on bundler behavior, invoke `vite build` with the
  pattern of `src/test/card-art-base-path.test.ts`.
- Changes to target pickers, response controls or submission paths pass the
  [stateful UI regression matrix](#stateful-ui-regression-matrix).
- AI tests pass an explicit seed and a small budget, and assert legality and
  intent, not tie-breaks; only Hard's critical positions pin an exact action.
- Turn a fuzzer failure into a curated fixture case before fixing the guard;
  never change a seed to get past it.
- Don't replace focused tests with a new browser or GPU test stack, and never
  claim visual or device coverage from mocks.

## Conventions

- Name a test after its module or behavior: `src/app/foo.ts` gets
  `src/test/foo.test.ts`, and a large behavior may get
  `foo-<behavior>.test.ts` (e.g. `controller-ai-level.test.ts`).
- Import `describe`, `it` and `test` from `vitest`; no jest-style globals.
- The project avoids `@types/node`; declare the Node APIs a test needs in
  `src/test/node-shims.d.ts`.
- `withFakeTimers(...)` wraps one test, `installFakeTimerHooks()` a
  `describe` block. Fake timers leak across tests and files in a worker and
  hang unrelated tests; the helpers clear pending timers before restoring
  real ones.
- Vitest runs in Node without jsdom. Stub the minimal `window` and
  `navigator` surface and assert escaped HTML, as `three-interface.test.ts`
  does; mock `matchMedia` and install events as `install-support.test.ts`
  does.
- The `innerHTML` stub in `three-interface.test.ts` treats only `INPUT`,
  `IMG`, `BR`, `HR`, `META` and `LINK` as void and ignores `/>`, so renderer
  markup closes every other element, inline SVG included (`<line …></line>`),
  or later siblings nest inside it. The route map test checks this.
- Narrow board geometry tests take stage sizes from `narrowStage()` in
  `three-layout.test.ts` (viewport minus top bar, dock, gaps, safe-area
  padding and borders, at 100% and 200% text), not raw viewport sizes;
  `unfoldedStage()` does the same for `dock` and `rail`.
- `src/test/docs-links.test.ts` fails on dangling relative Markdown links or
  anchors and on stale `docs/...md#anchor` citations in source comments, so
  update referrers when renaming headings.

## AI / engine tests

- `AppController` accepts only an action that `isLegalActionForState` finds
  among `getLegalActions`, comparing fields such as `effectTargetId` exactly.
  In `swamp_target` with a non-empty opponent hand, each target card gets its
  own `resolve_swamp_discard`; assert a shape `getLegalActions` emits.
- Heuristics evolve: check that a choice serves its intent (e.g. disrupts a
  near-win opponent) instead of naming the card a tie-break picks.

### Seeded AI and the Hard search

- **Seeding.** AI choices depend only on the state, seat, game seed and
  budget ([Seeded AI randomness](../../AGENTS.md#seeded-ai-randomness));
  `ai-randomness-sources.test.ts` bans `Math.random`, clocks and `crypto` in
  `src/game/ai*.ts` and `src/game/ai-policies/`. Tests may assert that a
  decision repeats for the same inputs, after a JSON round trip, and with a
  reordered deck; with reordered zones, assert its action class.
- **Critical vs calm.** In critical positions (`decisionCriticality` of 1)
  Hard chooses identically for every seed, so tests may assert the exact
  action across many seeds (`criticalFixtures()` in `ai-hard.test.ts`). In
  calm positions assert only legality, membership in the reported candidates
  and a variety floor over fixed states and seeds.
- **Budgets.** The default suite uses budgets such as
  `{ determinizations: 4, rolloutTurns: 2 }`. The strength smoke test in
  `ai.test.ts` plays pinned mirrored seeds against the frozen pre-search Hard
  (`LEGACY_HARD` in `src/test/helpers/ai-baselines.ts`), so it cannot flake.
- **Opt-in tools.** Not part of `npm run test`; `src/test/tools/` documents
  their environment variables. `npm run ai:tournament` plays mirrored matches
  between entrants from `src/test/helpers/ai-entrants.ts`, and
  `AI_TOURNAMENT_DIAGNOSTICS=1` adds seed variety in calm and critical
  positions and a blunder audit. `npm run ai:tune` refits the evaluator
  weights and reports the held-out log-loss of the fit and the frozen
  weights. Run no more tools in parallel than there are CPUs, or latencies
  inflate. Paste results into the PR.
- **Promoting weights or settings.** Promote a refit only if it beats the
  frozen weights on held-out log-loss and `search-candidate`
  (`AI_CANDIDATE_WEIGHTS` set to the tune report) beats `search` in mirrored
  tournaments on the starter, mono and dual decks, with the pooled 95%
  interval above 50%. Copy the weights into `src/game/ai-weights.ts` and bump
  `HARD_AI_WEIGHTS_VERSION`. Changing the weights, `HARD_AI_DEFAULT_BUDGET`,
  `HARD_AI_DEFAULT_SELECTION` or the personas changes Hard's choices:
  regenerate with `npx vitest run src/test/cli-session.test.ts -u` and
  confirm that only `ai-hard-seed-77.characterization.json` changed. The
  Basic and Advanced fixtures stay byte-identical.

## Stateful UI regression matrix

Exercise the
[reentrant submission contract](state-and-persistence.md#reentrant-ui-submissions)
with deterministic fixtures and the existing Vitest helpers:

| Scenario | Required assertion |
| --- | --- |
| Accepted action with synchronous notification | The next decision stays usable; cleanup cannot dismiss its picker. |
| Unchanged-decision rejection or status-only update | A still-legal selection survives and retry works. |
| Decision, session or legality advances before input is handled | Stale buttons, hits and callbacks cannot submit, even with reused ids. |
| Duplicate native or board activation, or pointer release | At most one accepted submission; a rejection does not lock input. |
| Escape or cancel, reset, or disposal during notification | No accidental action, stale state restoration or rendering after disposal. |
| Empty, single, multiple or duplicate-name target choices | Existing selection behavior and exact legal target identity are preserved. |

- Reuse the controller and `three-interface.test.ts` harness patterns, with
  notifications that update the interface synchronously, not only mocks that
  return an unchanged view.
- When shared behavior changes, cover both the native HTML and battlefield
  consumers, and keyboard, focus and pointer paths where relevant.

### Adventure decision controls

`three-interface.test.ts` runs the hub's node, Choose and Skip controls
through the matrix with `setupRealAdventure()`: a real `AppController` over
tracked storage, plus `hold()` and `release()`, which delay presenting views
so the controller moves on first, and `subscribe(listener, first)`, which adds
a subscriber before or after the interface's own. For each control:

- **Synchronous notification:** one dispatch and one run write; the next
  decision is focused and announced.
- **Rejected retry:** a refused write keeps the decision key and focus, and
  each repeated refusal is announced again. Once storage recovers, the retry
  writes the run once.
- **Stale input:** a control whose decision moved on behind the interface
  dispatches nothing and refreshes the interface.
- **Duplicate activation:** a repeat before or after the re-render
  dispatches once.
- **Disposal during notification:** with the disposing subscriber before or
  after the interface, nothing throws, the command applies once, and nothing
  moves focus, rebuilds markup or writes the announcer after disposal.

A pending reward is also tested through Pause, Resume and Reset. Target
cardinality does not apply: each control has one target. Tests that refuse
writes use `src/test/helpers/tracked-storage.ts`: `calls` records each
`set:<key>` and `remove:<key>`, and `failingSets`, `failingRemoves` and
`failingGets` refuse operations per key.

## Malformed Adventure saves

- `src/test/fixtures/adventure-malformed-v2.ts` builds 14 deep-frozen schema
  version 2 bases from a fixed seed through real run transitions, 60 curated
  cases that each break one rule (map, offer, relic, history, attempt or
  counter), and variants that must still be accepted.
- `src/test/adventure-fuzz.test.ts` reads 2,000 edited runs and 400 edited
  mid-game saves from fixed `lcg` seeds. Reading never throws or writes. An
  accepted run passes the guard, survives a JSON round trip, keeps a finite
  score, and plays on through Resume, a reward, a node start and a result. A
  mid-game save restores only when its identity matches and the game can
  continue.
- Each failure reports its case number, base and edits, and repeats exactly.
  Keep case counts bounded so the suite stays fast.

## Build-behavior tests

`src/test/card-art-base-path.test.ts` runs `vite build` with a custom
`VITE_BASE_PATH`, then asserts that the base is baked into the bundle and no
`import.meta.env.BASE_URL` lookup survives
([Vite base URL](../../AGENTS.md#vite-base-url)). Vite's manifest must keep
Three.js a dynamic entry outside the initial graph and the only renderer
entry, with every manifest file under `assets/`. Source-level checks cannot
establish these properties.

## Asset tests

`card-art-assets.test.ts` and `card-art-generator.test.ts` enforce the
[card art](../../public/cards/README.md#deterministic-assets) constraints:
square PNGs of at least 256×256, Cats and Anime files that differ from their
deterministic fallbacks, and byte-identical deterministic output, generated
in scratch directories that never touch tracked PNGs. They are not visual
acceptance ([Artwork acceptance](../../AGENTS.md#artwork-acceptance)): report
asset identity with `cmp`, metadata or hashes without claiming image
inspection, and verify Cats and Anime art in a browser.

## Three.js tests

- `three-*.test.ts` cover layout and quality policies, pointer capture,
  retained resources, native UI actions, event playback and renderer
  lifecycle, using injected or mocked browser and GPU surfaces, never network
  assets.
- `renderer-host.test.ts` covers asynchronous loading, latest-view
  buffering, stale-load rejection, accessible retry and same-controller
  recovery.
- `browser-renderer-architecture.test.ts` keeps Three.js the only renderer:
  no Phaser dependency or import, `DomRenderer`, `RendererKind` or removed
  renderer directory may return.

## Browser verification and evidence

1. Finish the production build before previewing its configured non-root
   base path; keep the output unchanged and record what
   [Validation evidence and production preview](validation-and-build.md#validation-evidence-and-production-preview)
   lists. Confirm that the server is ready, the base path loads, a legacy
   `?renderer=` query is stripped and Three.js starts.
2. Exercise the change in real WebGL2 browsers: mouse, touch or pen,
   orientation changes, target pickers, overlapping card rows, reduced
   motion, offline loads and context loss. Record the browsers and devices
   actually used; desktop emulation is not Android or iOS coverage.
3. Use the supported browser tools. On failure, read the tool's actual
   error: install a reported missing browser with its supported operation, or
   fix an evidenced server or URL problem, then retry once if safe, never when
   side effects are uncertain. Don't substitute ad hoc ChromeDriver or Python
   scripts, add browser dependencies or bypass network restrictions.
4. Before inspecting a screenshot, confirm that the returned file exists and
   decodes (recheck any path from an earlier session); then inspect the
   captured state, not just the file.
5. Report each evidence stage, the attachment and any blocked stage as
   [Screenshots](pr-workflow.md#screenshots) requires.

Feature sweeps live in [browser-checks.md](browser-checks.md).
