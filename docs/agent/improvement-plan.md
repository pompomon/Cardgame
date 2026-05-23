# Codebase improvement plan

A backlog of incremental improvements derived from the rules in
[`AGENTS.md`](../../AGENTS.md), the topic guides under
[`docs/agent/`](.), and observable hotspots in the repo (large modules,
duplicated patterns, recurring reviewer feedback).

Use this document as a paste-source for GitHub Issues, **or** track work
directly here by ticking checkboxes. Each child issue below is scoped to a
single, reviewable PR.

## How to use this document

1. Create the **tracking issue** below (Issue T-0). Paste its body
   verbatim; keep the child-issue task list in the body so the parent
   shows live progress.
2. Create each child issue. Suggested labels are listed; create any
   missing labels first (`area:phaser`, `area:dom`, `area:controller`,
   `area:state`, `area:ai`, `area:service-worker`, `area:tests`,
   `area:docs`, `type:refactor`, `type:bug`, `type:tech-debt`,
   `type:perf`, `good first issue`).
3. Link each child issue back to T-0 with `Part of #<T-0 number>`.
4. When closing a child issue, tick its checkbox in T-0's task list.

> Conventions: every PR ends with the validation block from
> [`docs/agent/pr-workflow.md`](pr-workflow.md):
> `Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔`.

---

## T-0 — Tracking issue: codebase improvement plan

**Title:** `Tracking: codebase improvement plan (Q3)`

**Labels:** `tracking`, `type:tech-debt`

**Body:**

> Umbrella tracking issue for the improvement plan described in
> [`docs/agent/improvement-plan.md`](https://github.com/pompomon/Cardgame/blob/main/docs/agent/improvement-plan.md).
> Each child issue is scoped to a single PR. Tick its checkbox when the
> corresponding PR merges.
>
> - [ ] **T-1** (phaser) — Extract button/typography helpers from `phaser/index.ts`
> - [ ] **T-2** (phaser) — Extract scene-depth constants and z-order map
> - [ ] **T-3** (phaser) — Split menu-overlay rendering into its own module
> - [ ] **T-4** (phaser) — Centralise `setCrop`/culling helpers and add tests
> - [ ] **T-5** (controller) — Split `controller.ts` adventure persistence into a module
> - [ ] **T-6** (controller) — Audit status-message ordering vs. storage warnings
> - [ ] **T-7** (state) — Add structural fuzz tests for `localStorage` validators
> - [ ] **T-8** (state) — Document and test the view-model redaction contract
> - [ ] **T-9** (ai) — Add a benchmark gate for AI hot-loop allocations
> - [ ] **T-10** (dom/css) — Audit `id` vs. `class`/`data-action` for menu+lobby buttons
> - [ ] **T-11** (dom/css) — Verify `image-rendering` ordering across all card styles
> - [ ] **T-12** (sw) — Add a service-worker integration test for `/cards/*` 404 fallback
> - [ ] **T-13** (sw) — Bump `CACHE_VERSION` checklist + release-notes lint
> - [ ] **T-14** (tests) — Migrate ad-hoc `vi.useFakeTimers` to a shared helper
> - [ ] **T-15** (tests) — Replace remaining string→enum casts with `isXxx` guards
> - [ ] **T-16** (docs) — ADR: when to extract from `phaser/index.ts`
>
> See the plan doc for scope, acceptance criteria, and ordering notes.

**Suggested ordering:** T-1 → T-2 → T-4 → T-3 (Phaser split is the
biggest lever); in parallel T-7/T-8 (state safety); T-9 once T-1..T-4
land; T-12/T-13 last so they ride on the cache version bump.

---

## Phaser renderer

`src/renderers/phaser/index.ts` is **~3400 lines** with only a handful of
top-level functions; most logic is nested. The file already has siblings
(`effects.ts`, `layout.ts`, `log-events.ts`, `log-scroll.ts`,
`in-scene-log-policy.ts`) — the pattern is to keep extracting.

### T-1 — Extract button/typography helpers

- **Title:** `phaser: extract button + typography helpers from index.ts`
- **Labels:** `area:phaser`, `type:refactor`, `good first issue`
- **Why:** Reduce `index.ts` size; create a stable surface for visual
  polish PRs.
- **Scope:** Move button factory functions (label, padding, hover/press
  states) and any shared text-style constants into
  `src/renderers/phaser/button.ts`. Re-export from `index.ts` only if
  needed by tests.
- **Out of scope:** Behavior changes, scene-depth changes, any
  `setCrop`/mask work.
- **Acceptance:**
  - `src/renderers/phaser/button.ts` exists; `index.ts` imports from it.
  - No call sites change semantically (visual snapshot/manual smoke OK).
  - `npm run lint && npm run test && npm run build` green.

### T-2 — Extract scene-depth constants and z-order map

- **Title:** `phaser: centralise scene depth/z-order constants`
- **Labels:** `area:phaser`, `type:refactor`
- **Why:** Magic depth numbers are scattered through `index.ts`; the
  Phaser guide already documents an intended ordering.
- **Scope:** New `src/renderers/phaser/depth.ts` exporting named
  constants (e.g. `DEPTH_BOARD`, `DEPTH_EFFECTS`, `DEPTH_MENU_OVERLAY`,
  …). Replace inline `setDepth(N)` calls.
- **Acceptance:** No numeric `setDepth(...)` literals left in
  `phaser/index.ts` (grep-asserted in a new lightweight test or
  reviewer-verified).

### T-3 — Split menu-overlay rendering into its own module

- **Title:** `phaser: split menu-overlay rendering into menu-overlay.ts`
- **Labels:** `area:phaser`, `type:refactor`
- **Depends on:** T-1, T-2.
- **Scope:** Move the menu-overlay scene-graph construction (including
  the replay log viewport that already uses fully-contained culling per
  memory note) into its own module. Keep wiring in `index.ts`.
- **Acceptance:** `index.ts` shrinks by at least ~400 lines; menu
  overlay test(s) still pass; manual smoke of in-game + adventure
  overlays unchanged.

### T-4 — Centralise `setCrop`/culling helpers and add tests

- **Title:** `phaser: shared viewport-culling helper + tests`
- **Labels:** `area:phaser`, `type:tech-debt`
- **Why:** AGENTS rule #6 — `GeometryMask` is a no-op under WebGL; today
  we have two slightly different culling implementations (in-scene log
  uses overlap, menu overlay uses fully-contained). Standardise the
  helper signatures and unit-test both modes.
- **Scope:** Promote a small `cullRowsToViewport({mode: 'overlap' |
  'contained'})` helper alongside `log-scroll.ts`. Add unit tests for
  both modes. Replace existing inline cull loops.
- **Acceptance:** Both call sites use the helper; new tests cover the
  boundary cases (row exactly on viewport edge, partial overlap, fully
  outside).

---

## Controller and adventure state

`src/app/controller.ts` is **~1200 lines** with ~90 methods; adventure
persistence, status messaging, and game-flow orchestration are all
co-located.

### T-5 — Split adventure persistence into its own module

- **Title:** `controller: extract adventure-run persistence`
- **Labels:** `area:controller`, `area:state`, `type:refactor`
- **Scope:** Move `setAdventureRun` / read+write of the adventure-run
  storage key into `src/app/adventure-persistence.ts`, layered on
  `safe-storage.ts` and `validators.ts`. Controller calls the new
  module.
- **Acceptance:** Controller no longer touches `localStorage` for
  adventure state directly; new module has unit tests covering invalid
  JSON, missing keys, and storage-unavailable warnings.

### T-6 — Audit status-message ordering vs. storage warnings

- **Title:** `controller: audit status ordering after setAdventureRun`
- **Labels:** `area:controller`, `type:bug`
- **Why:** AGENTS rule #9 — a later unconditional `state.status = …`
  overwrites the "storage unavailable" warning. We've fixed this once;
  let's make sure it doesn't regress.
- **Scope:** Grep every `state.status =` and `this.state.status =`
  assignment following `setAdventureRun(...)` or other persistence
  calls. Add a regression test that drives the controller through a
  flow with storage disabled and asserts the warning survives.
- **Acceptance:** New test fails on a reverted fix; passes on `main`.

---

## State, persistence, view-model

### T-7 — Structural fuzz tests for `localStorage` validators

- **Title:** `state: fuzz tests for validators (Infinity/NaN/negatives)`
- **Labels:** `area:state`, `area:tests`, `type:tech-debt`
- **Scope:** For each `isXxx` validator in `src/app/validators.ts` and
  consumers (recording, adventure, game-state), add a small property /
  table-driven test that throws `Infinity`, `NaN`, `-1`, `1.5`,
  oversized arrays (cap-tail check), unknown discriminants, and
  deeply-mutated nested objects. Use plain table tests — no new
  dependency.
- **Acceptance:** Validators continue to reject all bad cases; cap-tail
  retains the **tail** (most recent), not the head, on every cap point.

### T-8 — Document + test the view-model redaction contract

- **Title:** `view-model: regression tests for hidden-hand redaction`
- **Labels:** `area:state`, `area:tests`
- **Why:** Memory note records `HIDDEN_HAND_CARD_NAME` sentinel
  behavior; only thin tests exist today.
- **Scope:** Add tests that assert (a) AI cards in opposing human's view
  are projected as the sentinel; (b) real card names *never* leak in
  the snapshot returned from the view-model for that viewer; (c)
  controller-owned `state.game`/`state.adventure` references are not
  shared by identity into the snapshot (AGENTS rule #5).
- **Acceptance:** Tests pass; doc paragraph added to
  `docs/agent/state-and-persistence.md`.

---

## AI

### T-9 — Benchmark gate for AI hot-loop allocations

- **Title:** `ai: add allocation/timing micro-benchmark and gate`
- **Labels:** `area:ai`, `type:perf`
- **Why:** AGENTS rule #7 already statically forbids `structuredClone`
  in hot loops (enforced by `ai-no-state-clone.test.ts`). Add a
  complementary runtime benchmark to catch *new* hot-path regressions
  (e.g., per-candidate object literals, large array spreads).
- **Scope:** New `src/test/ai-perf.bench.ts` (vitest `bench`) running a
  fixed seeded scenario at the highest AI level for N iterations.
  Record a baseline in the same file; fail if 50% slower.
- **Acceptance:** Benchmark runs in CI within a sensible time budget;
  baseline documented in the test file's comment.

---

## DOM / CSS

### T-10 — Audit `id` vs. `class`/`data-action` for menu+lobby buttons

- **Title:** `dom: audit duplicated button ids across lobby + in-game`
- **Labels:** `area:dom`, `type:bug`
- **Why:** AGENTS rule (DOM section) — unique element `id`s; same
  logical button in lobby + in-game menu must use `class` /
  `data-action` (the `abandon-adventure` pattern).
- **Scope:** Sweep `src/renderers/dom.ts` for duplicated `id="…"`
  literals; convert the duplicated ones to the `data-action` pattern;
  add a tiny string-rendering test asserting each `id` appears at most
  once across lobby + in-game shells.
- **Acceptance:** New test fails on a regression; passes today.

### T-11 — Verify `image-rendering` ordering across card styles

- **Title:** `css: verify image-rendering ordering for pixelated styles`
- **Labels:** `area:dom`, `type:tech-debt`
- **Scope:** Confirm CSS declaration order in `src/style.css`:
  `image-rendering: pixelated` must follow `crisp-edges` for raster
  styles (HD, Monochrome). Add a snapshot/string test or a comment-only
  guard if no test infra is appropriate.
- **Acceptance:** Reviewer-confirmed or test in place.

---

## Service worker & PWA

### T-12 — Service-worker integration test for `/cards/*` 404 fallback

- **Title:** `sw: integration test for /cards/* network-first fallback`
- **Labels:** `area:service-worker`, `area:tests`
- **Scope:** Drive `public/sw.js` with a small mocked `fetch` to assert
  network-first for `/cards/*` and cache-first for `/assets/*`. Cover
  the "network 404, no cache entry" path so a missing land PNG does not
  poison the cache.
- **Acceptance:** New test in `src/test/`; existing SW behavior
  unchanged.

### T-13 — `CACHE_VERSION` checklist + release-notes lint

- **Title:** `sw: enforce CACHE_VERSION bump when /cards/* changes`
- **Labels:** `area:service-worker`, `type:tech-debt`
- **Scope:** A `npm run test`-time check that, if any file under
  `public/cards/` changed against `origin/main`, `CACHE_VERSION` in
  `public/sw.js` must have changed too. Keep it as a soft warning (not a
  hard fail) initially.
- **Acceptance:** Warning prints on a synthetic test; doc note added to
  `docs/agent/service-worker-and-pwa.md`.

---

## Test infrastructure

### T-14 — Shared fake-timers helper

- **Title:** `tests: shared useFakeTimers/restore helper`
- **Labels:** `area:tests`, `type:tech-debt`
- **Why:** AGENTS rule (Tests) — fake timers leak across files in the
  same worker.
- **Scope:** Add `src/test/helpers/timers.ts` exposing
  `withFakeTimers(fn)` (and a `beforeEach`/`afterEach` pair). Migrate
  existing `vi.useFakeTimers()` call sites in one PR.
- **Acceptance:** Grep shows no bare `vi.useFakeTimers()` without a
  matching `vi.useRealTimers()` in the same file.

### T-15 — Replace remaining string→enum casts with `isXxx` guards

- **Title:** `tests+app: eliminate remaining string→enum casts`
- **Labels:** `area:state`, `area:tests`, `type:bug`
- **Scope:** Grep for `as AiLevel`, `as CardVisualStyle`, etc.; replace
  with the corresponding `isXxx` guard + `DEFAULT_*` fallback. Most
  hits will be in tests or older controller code paths.
- **Acceptance:** Zero `as AiLevel|as CardVisualStyle|as RendererName`
  in `src/` (test-only escape hatches allowed with an inline comment).

---

## Docs

### T-16 — ADR: when to extract from `phaser/index.ts`

- **Title:** `docs: ADR — when to extract a Phaser module`
- **Labels:** `area:docs`
- **Depends on:** T-1, T-2.
- **Scope:** Short ADR under `docs/agent/adr/` codifying the trigger
  (e.g., > 200 LOC cohesive block, or third repeat of a pattern). Links
  to T-1..T-3 as worked examples.

---

## Notes on scope discipline

- Each child PR sticks to AGENTS rule "minimal-change": no drive-by
  reformatting, no unrelated dependency bumps.
- Hard rules in AGENTS.md (1–9) are non-negotiable; every PR must keep
  them green and may not regress an existing regression test.
- Validation block on every PR:
  `Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔`.
