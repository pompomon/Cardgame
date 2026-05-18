# AGENTS.md

Canonical guide for AI agents and human contributors working on this repository.
Keep this file short; the depth lives in `docs/agent/`.

## Project at a glance

A simplified Magic-style 2-player card game shipped as an offline-capable SPA.

- **Build / bundler:** Vite + TypeScript
- **Renderers:** DOM (default) and Phaser 4 (`?renderer=phaser`)
- **Tests:** vitest (`npm run test`)
- **Lint:** `tsc --noEmit` (`npm run lint`)
- **Engine:** pure TypeScript in `src/game/` (no DOM/Phaser imports)
- **Persistence:** browser `localStorage` for adventure runs, recordings, settings
- **Deploy:** GitHub Pages via `.github/workflows/deploy-pages.yml`
  (project site at a non-root base path)

## Before you change code

```bash
npm install
npm run lint     # tsc --noEmit
npm run test     # vitest run
npm run build    # tsc && vite build
```

Then run `codeql_checker` and address every alert. The exact sequence and
"what good looks like" are documented in
[`docs/agent/validation-and-build.md`](docs/agent/validation-and-build.md).

## Hard rules (non-negotiables)

These come straight from recurring reviewer findings. Violating them blocks
review.

1. **Vite base URL.** Always access `import.meta.env.BASE_URL` as a literal
   member expression — never through an alias such as `meta.env?.BASE_URL`.
   Aliasing defeats Vite's static replacement and 404s every `/cards/*` on
   non-root deploys (e.g. GitHub Pages project sites). See
   [`docs/agent/service-worker-and-pwa.md`](docs/agent/service-worker-and-pwa.md).
2. **No string-to-enum casts on untrusted input.** Validate with the
   `isXxx` guards (`isAiLevel`, `isCardVisualStyle`, …) before assigning.
3. **Sanitize and cap every array from `localStorage` or imported JSON.**
   Reject `Infinity`, `NaN`, negatives, fractions, and unknown discriminants.
   When capping logs/events, keep the **tail** (most recent), not the head.
4. **Every exhaustive `switch` over a discriminated union needs a `default:`.**
   Unknown `kind` values must degrade gracefully (safe placeholder), never
   fall through to `undefined`.
5. **View-model projects immutable snapshots.** Never leak internal
   controller state (`state.adventure`, `state.game`, …) by reference.
6. **Phaser 4 `GeometryMask` is a no-op under WebGL.** For scrollable/clipped
   viewports use `setCrop` on Images or manual viewport culling
   (`cullLogRowsToViewport` pattern).
7. **No `structuredClone(GameState)` in hot loops.** AI evaluation and render
   paths must not deep-clone the full game state per candidate action.
8. **Reuse shared helpers and constants.** Use `DEFAULT_CARD_VISUAL_STYLE`,
   the shared `clamp` in `src/renderers/phaser/layout.ts`, `isBasicLand`, etc.
   Do not re-declare or hardcode their values.
9. **Status-message ordering.** A later unconditional
   `this.state.status = …` will silently overwrite an earlier "storage
   unavailable" warning set by `setAdventureRun(...)`. Set warnings last, or
   guard the success message when persistence may have failed.

## Topic index (`docs/agent/`)

- [`architecture.md`](docs/agent/architecture.md) — module map and layering rules.
- [`validation-and-build.md`](docs/agent/validation-and-build.md) — canonical
  lint/test/build/CodeQL sequence.
- [`state-and-persistence.md`](docs/agent/state-and-persistence.md) —
  controller, view-model, localStorage, and recording invariants.
- [`phaser-renderer.md`](docs/agent/phaser-renderer.md) — Phaser 4 pitfalls,
  scene depth, mask/culling, effects queue, log rendering.
- [`dom-and-css.md`](docs/agent/dom-and-css.md) — DOM/CSS pitfalls.
- [`service-worker-and-pwa.md`](docs/agent/service-worker-and-pwa.md) —
  caching strategy, base path, PWA install.
- [`testing.md`](docs/agent/testing.md) — vitest patterns and gotchas.
- [`pr-workflow.md`](docs/agent/pr-workflow.md) — review-loop conventions.
