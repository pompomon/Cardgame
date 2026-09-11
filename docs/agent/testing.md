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
an unchanged view. Cover affected DOM, Phaser, and Three.js consumers when shared
behavior changes. Check keyboard/focus and pointer paths where relevant. Do not
introduce a new DOM/GPU test stack to replace existing focused tests; mocked
coverage remains separate from real-browser verification.

## Browser-API tests

- Mock `window.matchMedia`, `beforeinstallprompt`, `appinstalled`,
  `MediaQueryList.addListener` etc. The patterns in
  `src/test/install-support.test.ts` are the reference.
- Vitest runs in Node by default in this repo (no global jsdom setup). For
  DOM-related tests, follow existing patterns: assert string-rendered HTML
  and manually stub the minimal `window`/`navigator` surface when needed
  (see `src/test/dom-lobby.test.ts`).

## Build-behavior tests

For correctness that depends on Vite's bundler behavior (e.g.
`import.meta.env.BASE_URL` static replacement), add a test that actually
invokes `vite build`. See `src/test/card-art-base-path.test.ts`:

- Runs `vite build` with a custom `VITE_BASE_PATH`.
- Asserts the configured base is baked into the built bundle.
- Asserts that no `import.meta.env` reference survives the build.

These tests are slower but catch failures that source-level checks miss.

## Asset tests

`src/test/card-art-assets.test.ts` validates the shipped PNGs:

- Strictly square (`width === height`).
- ≥ 256×256.
- HD art is typically 1024×1024 but not required by the test.

Replacement assets must satisfy those constraints; the
`public/cards/README.md` docs match the test expectations.

## Phaser tests

The Phaser scenes are exercised through targeted tests under
`src/test/phaser-*.test.ts`. The renderer falls back to procedural
pixel icons when card-art textures aren't preloaded, which keeps tests
green without bundling real PNGs at test time. When changing
preload/fallback paths, keep that property — tests should not need
network access.

## Three.js tests

`three-*.test.ts` exercises pure layout/quality policies, pointer capture,
retained resources, native UI actions, event playback, and renderer lifecycle.
`renderer-host.test.ts` covers asynchronous loading and same-controller DOM
fallback. Graphics tests use injected or mocked browser/GPU surfaces, not
network assets.

The production card-art base-path test also checks Vite's generated manifest:
both graphics renderers must remain dynamic entries outside the initial
DOM dependency graph. A source-only assertion cannot establish this.

GPU mocks cannot prove visual correctness or device performance. Check a
production preview in actual WebGL2 browsers: mouse, touch/pen, orientation
changes, target pickers, overlapping card rows, reduced motion, offline loads, and
context loss. Record which browsers/devices were actually exercised; do not
claim Android/iOS coverage from desktop emulation.

## Browser verification and evidence

1. Complete the [production build](validation-and-build.md#validation-evidence-and-production-preview)
   before smoke-testing its output. Verify preview-server readiness, the
   configured base path, and renderer selection. Keep the built output unchanged
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
