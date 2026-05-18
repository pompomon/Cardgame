# Copilot instructions for `pompomon/Cardgame`

The canonical contributor and agent guide is [`AGENTS.md`](../AGENTS.md) at
the repo root, with topic deep-dives under [`docs/agent/`](../docs/agent/).
Read those before making non-trivial changes.

This file inlines the highest-signal rules so Copilot has them in every prompt.

## Stack

Vite + TypeScript SPA. Phaser 4 optional renderer. vitest. Service worker.
Deployed to GitHub Pages under a non-root base path.

## Validation sequence (always)

1. `npm run lint` (= `tsc --noEmit`)
2. `npm run test` (= `vitest run`)
3. `npm run build` (= `tsc && vite build`)
4. `codeql_checker` — address every alert

See [`docs/agent/validation-and-build.md`](../docs/agent/validation-and-build.md).

## Non-negotiable rules

- **Vite `BASE_URL`:** access `import.meta.env.BASE_URL` as a literal member
  expression. Aliasing it (e.g. `meta.env?.BASE_URL`) defeats Vite's static
  replacement and breaks card art on GitHub Pages. There is a regression test
  (`src/test/card-art-base-path.test.ts`) — do not paper over it.
- **Validate JSON from `localStorage` or imports.** Use the existing `isXxx`
  guards. Reject `Infinity`/`NaN`/negatives/fractions for counters
  (`turn`, `nextInstanceId`, `landsPlayedThisTurn`). Validate deck length (50)
  where required. Validate discriminated unions element-by-element. **Cap**
  arrays, keeping the **tail** (most recent).
- **Switches over discriminated unions need a `default:`** that returns a safe
  placeholder. Never let `formatLogEventTile`/similar return `undefined`.
- **View-model returns immutable snapshots.** Do not pass
  `state.adventure`/`state.game` by reference into renderers.
- **No string→enum casts.** Use `isAiLevel`, `isCardVisualStyle`, etc.
- **Phaser 4 masks don't clip in WebGL.** Use `setCrop` on Images and manual
  viewport culling (`cullLogRowsToViewport`) for scrollable regions.
- **No `structuredClone(GameState)` in hot loops** (AI evaluation, render).
- **Reuse shared helpers/constants:** `DEFAULT_CARD_VISUAL_STYLE`, shared
  `clamp` from `src/renderers/phaser/layout.ts`, `isBasicLand`. Do not
  hardcode `'classic'` as a fallback.
- **Status messages:** a later unconditional `state.status = …` overwrites
  the storage-unavailable warning emitted by `setAdventureRun(...)`. Either
  surface the warning last or guard the success message.

## DOM / CSS

- Unique element `id`s; use `class`/`data-action` when the same logical
  button appears in lobby + in-game menu (`abandon-adventure` pattern).
- Strip raster classes immediately in `onerror` and track failed raster URLs
  in module state so the next render skips them.
- CSS declaration order matters: `image-rendering: pixelated` must come after
  `crisp-edges` if it's the preferred value. Place override selectors after
  the equally-specific base rule.
- Provide plain-value fallbacks before `env(safe-area-*)`. `@supports
  (padding: max(0px))` is invalid — `max()` needs ≥ 2 args.

## Service worker and base path

- Network-first for `/cards/*` (unhashed), cache-first for `/assets/*`
  (hashed). Bump `CACHE_VERSION` when same-path PNGs are replaced.
- Do not precache `404.html` into the SPA shell slot.
- In `index.html`, use `%BASE_URL%…` or `./…` — not absolute `/…` paths.
- `joinBasePath` / `404.html` must normalize to exactly one leading `/` and
  not redirect to a scheme-relative URL.

## Tests

- Pair `vi.useFakeTimers()` with `afterEach(vi.useRealTimers)` — they leak
  across files in the same worker.
- AI-policy assertions must use actions that pass `isLegalActionForState`
  (include `effectTargetId` when the opponent hand is non-empty).
- Use the build-invocation pattern from `card-art-base-path.test.ts` when
  correctness depends on bundler behavior.

## PR conventions

End every PR description with a validation block:

```
Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔
```

Use checklists; add a new "PR review feedback (round N)" sub-checklist for
each round. When addressing a reviewer comment, reply with the commit hash
and a short summary. See
[`docs/agent/pr-workflow.md`](../docs/agent/pr-workflow.md).
