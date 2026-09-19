# AGENTS.md

Canonical guide for AI agents and human contributors working on this repository.
Keep this file short; the depth lives in `docs/agent/`.

## Project at a glance

A simplified Magic-style 2-player card game shipped as an offline-capable SPA.

- **Build / bundler:** Vite + TypeScript
- **Browser renderer:** Three.js / WebGL2 with a native HTML interface
- **Tests:** vitest (`npm run test`)
- **Lint:** `tsc --noEmit` (`npm run lint`)
- **Engine:** pure TypeScript in `src/game/` (no browser or renderer imports)
- **Persistence:** browser `localStorage` for adventure runs, recordings, settings
- **Deploy:** GitHub Pages via `.github/workflows/deploy-pages.yml`
  (project site at a non-root base path)

## Before you change code

Use Node 24 and the committed lockfile for a clean baseline:

```bash
npm ci
npm run lint     # tsc --noEmit
npm run test     # vitest run
npm run build    # tsc && vite build && npm run build:cli
```

Then run `codeql_checker` and address every alert. Record baseline and
post-change results separately, with the tested revision and actual exit codes.
Deployment reproduction also requires `npm run test:bench` before build.
Dependency updates, docs-only exceptions, and the exact sequence are covered in
[`docs/agent/validation-and-build.md`](docs/agent/validation-and-build.md).

**Triage failures before editing:** identify the failing workflow/job/step and
first meaningful error; distinguish code failures from browser, artifact, and
agent-service failures. Use the [bounded recovery procedure](docs/agent/validation-and-build.md#failure-triage-and-recovery),
not speculative code fixes or permission changes. Checkpoint verified work
before image handling; blocked visual verification stays pending maintainer
review under the [evidence procedure](docs/agent/pr-workflow.md#screenshots).

## Hard rules (non-negotiables)

1. **Vite base URL.** Always access `import.meta.env.BASE_URL` as a literal
   member expression. Aliasing defeats Vite's static replacement and breaks
   `/cards/*` and `/boards/*` on non-root deployments.
2. **Catalog presentation boundary.** Source player-facing creature names,
   abilities, rules text, and asset slugs from `src/app/card-catalog.ts`; use
   shared app presentation helpers for labels. Preserve `BasicLand`,
   `BASIC_LANDS` order, engine/action/event fields, saves, recordings, and P2P
   payloads. Never parse or serialize display names or slugs as identity.
   Until their copy is migrated, `src/app/tutorial.ts` and event framing in
   `src/app/log-presentation.ts` are explicit exceptions whose embedded
   creature and ability wording must be kept in sync with the catalog.
3. **No string-to-enum casts on untrusted input.** Validate with the
   `isXxx` guards (`isAiLevel`, `isCardVisualStyle`, …) before assigning.
4. **Sanitize and cap every array from `localStorage` or imported JSON.**
   Reject `Infinity`, `NaN`, negatives, fractions, and unknown discriminants.
   Keep the most recent tail when capping logs/events.
5. **Every exhaustive `switch` over a discriminated union needs a `default:`.**
   Unknown values must return the contract's safe placeholder or documented
   sentinel, never accidental `undefined`.
6. **View-model projects immutable snapshots.** Never leak internal controller
   state (`state.adventure`, `state.game`, …) by reference.
7. **WebGL2 failure is explicit.** Route load, initialization, render, and
   context-loss failures through `RendererHost`'s accessible recovery screen.
   Runtime failures preserve controller state for in-page retry; failed dynamic
   imports require reload. Do not add a hidden renderer fallback.
8. **No `structuredClone(GameState)` in hot loops.** AI evaluation and render
   paths must not deep-clone the full game state per candidate action.
9. **Reuse shared helpers and constants.** Use `DEFAULT_CARD_VISUAL_STYLE`,
   `src/renderers/shared/math.ts`, `src/renderers/shared/image-fit.ts`,
   `isBasicLand`, and the canonical app option lists.
10. **Status-message ordering.** A later unconditional status assignment can
   hide a storage-unavailable warning. Set warnings last or guard success
   messages when persistence may have failed.

## Topic index (`docs/agent/`)

- [`architecture.md`](docs/agent/architecture.md) — module map and layering.
- [`validation-and-build.md`](docs/agent/validation-and-build.md) — validation.
- [`state-and-persistence.md`](docs/agent/state-and-persistence.md) — state,
  localStorage, and recording invariants.
- [`three-renderer.md`](docs/agent/three-renderer.md) — GPU lifecycle,
  interaction, effects, and failure recovery.
- [`three-interface.md`](docs/agent/three-interface.md) — native HTML and CSS.
- [`service-worker-and-pwa.md`](docs/agent/service-worker-and-pwa.md) — caching,
  base path, and PWA installation.
- [`testing.md`](docs/agent/testing.md) — vitest and browser verification.
- [`pr-workflow.md`](docs/agent/pr-workflow.md) — review-loop conventions.
