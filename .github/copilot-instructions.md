# Copilot instructions for `pompomon/Cardgame`

The canonical contributor and agent guide is [`AGENTS.md`](../AGENTS.md) at
the repo root, with topic deep-dives under [`docs/agent/`](../docs/agent/).
Read those before making non-trivial changes.

This file inlines the highest-signal rules so Copilot has them in every prompt.

## Stack

Vite + TypeScript SPA. Phaser 4 optional renderer. vitest. Service worker.
Deployed to GitHub Pages under a non-root base path.

## Validation sequence (always)

Use Node 22 and `npm ci` for a clean, lockfile-based baseline. Keep intentional
dependency updates separate from environment recovery.

1. `npm run lint` (= `tsc --noEmit`)
2. `npm run test` (= `vitest run`)
3. `npm run build` (= `tsc && vite build && npm run build:cli`)
4. `codeql_checker` — after secret scanning and committing; address every alert

For deployment reproduction or AI hot-loop changes, run `npm run test:bench`
after tests and before build. Record actual exit codes, observed test counts,
and tested revisions; keep baseline and post-change results separate.
Finish the production build before previewing its configured non-root base path.

Docs-only changes still run lint, secret scanning, and `codeql_checker` (declare
trivial); tests/build/browser checks may be not run with a reason. Report skipped
analysis as skipped, not "0 alerts". `tsc --noEmit` only typechecks `src/`,
so check Markdown links and command descriptions separately.
See [`docs/agent/validation-and-build.md`](../docs/agent/validation-and-build.md).

## Failure recovery

Classify the first meaningful error before editing: application, dependency/
environment, browser, artifact transport, or agent service. Use Actions run/job
logs, not the overall red status alone. Permit at most one safe, supported retry;
otherwise record the blocker and request maintainer help. Do not weaken tests,
change game logic, improvise browser automation, or expand network permissions
for an unexplained tool failure. On resume, inspect saved commits and outstanding
work before repeating actions; recreate missing temporary evidence.
See [failure triage](../docs/agent/validation-and-build.md#failure-triage-and-recovery).

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
- **Switches over discriminated unions need a `default:`** that returns a
  value matching the function's contract — a safe placeholder for
  formatter/rendering paths (never let `formatLogEventTile`/similar return
  `undefined`), or a documented sentinel like `null` for selector paths
  where "no result" is normal (e.g. `effectDescriptorForEvent`).
- **View-model returns immutable snapshots.** Do not pass
  `state.adventure`/`state.game` by reference into renderers.
- **No string→enum casts.** Use `isAiLevel`, `isCardVisualStyle`, etc.
- **Phaser 4 masks don't clip in WebGL.** Use `setCrop` on Images and manual
  viewport culling (`cullRowsToViewport`) for scrollable regions.
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

- Use `withFakeTimers(...)` or `installFakeTimerHooks()` from
  `src/test/helpers/timers.ts`; do not open-code timer setup/teardown.
- AI-policy assertions must use actions that pass `isLegalActionForState`
  (include `effectTargetId` when the opponent hand is non-empty).
- Use the build-invocation pattern from `card-art-base-path.test.ts` when
  correctness depends on bundler behavior.
- Stateful UI tests cover synchronous notifications, rejected retries, stale
  input, duplicate activation, cancellation/disposal, and target cardinality;
  see the [regression matrix](../docs/agent/testing.md#stateful-ui-regression-matrix).

## PR conventions

Start the PR template's checks pending. End every PR description with actual
validation outcomes; use this form only when all four checks passed:

```
Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔
```

Otherwise report failed, blocked, or not-run outcomes with reasons. Keep code
validation, visual verification, and agent-run status separate. Checkpoint code
and textual results before image inspection/upload. Track browser interaction,
capture, inspection, and reviewer-accessible attachment separately; a temporary
path is not an attachment. Blocked visual verification stays pending maintainer
review, not silently waived.

Use checklists; add a new "PR review feedback (round N)" sub-checklist for each
round. When addressing a reviewer comment, reply with the commit hash, a short
summary, and actual validation outcomes. See
[`docs/agent/pr-workflow.md`](../docs/agent/pr-workflow.md).

## Code review skill

For pull request reviews, use the repository-scoped `code-review` skill (defined in `.github/skills/code-review/`) when available. It provides review-specific
guidance for Cardgame performance, user experience, and implementation
correctness.
