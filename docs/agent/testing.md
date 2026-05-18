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

- **Always pair `vi.useFakeTimers()` with `afterEach(() => vi.useRealTimers())`.**
  Vitest fake timers can leak across tests *and across files* in the same
  worker, causing unrelated tests to hang or behave nondeterministically.
- If a test installs interval/timeout handlers, clear them in `afterEach`
  too.

## AI / engine tests

- **Asserted actions must be legal under the engine's exact equality
  rule.** `AppController` enforces actions through `isLegalActionForState`,
  which compares fields like `effectTargetId` exactly. When the opponent
  hand is non-empty, `getLegalActions` produces one action per target
  card; an "untargeted" Swamp play is not legal and will be rejected.
  Assert against an action shape that `getLegalActions` actually emits.
- **Don't assert on internal AI tie-breaking.** Heuristics evolve. Assert
  that the chosen action is in the legal set and matches the strategic
  intent (e.g. disrupts a near-win opponent), not that it equals a
  specific card.

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
