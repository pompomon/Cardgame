# Implement retained-mode rich Phaser board renderer

## Implementation checklist

- [x] Phase 0 — Establish branch, validation baseline, and acceptance criteria
- [x] Phase 1 — Add persisted board-theme and render-quality settings
- [x] Phase 2 — Add base-path-safe HD board and sprite asset pipeline
- [x] Phase 3 — Implement persistent board background and adaptive ambience
- [x] Phase 4 — Replace rebuild-heavy card rendering with retained `CardView` objects
- [x] Phase 5 — Add dedicated mouse/touch drag-and-drop controller
- [x] Phase 6 — Add drop-zone visuals and contextual interaction feedback
- [x] Phase 7 — Implement adaptive desktop/mobile performance policy
- [ ] Phase 8 — Audit scene lifecycle, cleanup, and texture/resource eviction
- [ ] Phase 9 — Add regression, lifecycle, and performance verification
- [ ] Subagent verification — Architecture and ownership review
- [ ] Subagent verification — Lifecycle, memory, and listener-cleanup review
- [ ] Subagent verification — Input safety, accessibility, and rule-parity review
- [ ] Subagent verification — Asset, GitHub Pages, and service-worker review
- [ ] Subagent verification — Performance review and final merge gate

## Objective

Evolve the existing Phaser 4 renderer into a retained-mode, visually richer board renderer while preserving the current application architecture and game-rule behavior. The target experience includes HD themed board backgrounds, sprite and atlas support, smooth mouse/touch/pen drag-and-drop, adaptive desktop/mobile performance, and robust fallbacks for GitHub Pages and offline use.

This work must not change engine rules or card legality. The Phaser renderer must keep consuming the immutable `AppViewModel` snapshots produced by `src/app/` and must keep submitting existing `GameAction` objects back to the controller. DOM accessibility flows, non-canvas controls, renderer selection, P2P overlays, recordings, import/export, and replay behavior must remain available and semantically equivalent.

## Architecture constraints

- Preserve the dependency direction: `src/renderers/phaser/ → src/app/ → src/game/`.
- Keep `src/game/` renderer-independent. Do not import Phaser, DOM, browser storage, assets, or renderer settings into engine modules.
- Keep shared settings, persistence, validation, URL construction semantics, visual-effect descriptors, and cross-renderer presentation rules in `src/app/`.
- Keep Phaser-specific display objects, textures, pooling, input wiring, drag proxies, culling, and scene lifecycle ownership in `src/renderers/phaser/`.
- Consume immutable `AppViewModel` data only. Do not retain references to mutable controller internals.
- Submit existing `GameAction` values through the current controller boundary. Do not bypass legality checks or duplicate game rules in Phaser.
- Preserve DOM renderer parity and accessibility alternatives. Canvas interactions may be richer, but keyboard/screen-reader/non-canvas workflows must keep working.
- Follow repository guardrails: access `import.meta.env.BASE_URL` as a direct literal member expression, use crop/manual culling instead of Phaser `GeometryMask` for WebGL clipping, validate persisted settings with guards, and keep shared visual semantics out of Phaser-only modules.

## Retained-mode target flow

The current Phaser renderer should move away from broad scene reconstruction on each view-model update. The target flow is a stable scene graph with small, keyed reconciliation steps:

1. `BoardBackgroundView.sync(viewModel, layout, quality)` updates persistent background layers, crop rectangles, ambience intensity, and theme-dependent textures without recreating the whole scene.
2. `CardViewRegistry.sync(viewModel.game, layout, visibility, quality)` creates card views only for newly visible stable view keys, updates existing card positions and textures in place, pools removed views, and schedules move tweens where appropriate.

The view model does not currently expose one identity that survives zone moves: `UiCard` (hand, graveyard) carries `id`, while `UiBattlefieldCard` (`src/app/types.ts`) carries only `instanceId`. Before reconciliation can track a card across hand → battlefield → graveyard, extend the view-model projection in `src/app/view-model.ts` to also emit the underlying `Card.id` on battlefield entries (for example `UiBattlefieldCard { instanceId, cardId, name }`), keeping `instanceId` as the targeting key used by `GameAction` payloads. Until that projection exists, the registry key is `cardId` for hand/graveyard entries and `instanceId` for battlefield entries.
3. `DropZoneView.sync(viewModel.game, legalActions, dragState, layout)` updates reusable battlefield, hand, target, and action-zone highlights based on current legality and pointer state.
4. HUD sync updates persistent text, panels, buttons, overlays, menus, and accessibility mirrors independently from board/card object reconciliation.
5. Queued effects consume shared app-level effect descriptors and play bounded Phaser animations without modifying game state. Effects should be deduplicated, interrupt-safe, and cleaned up on scene transitions.

## Phase 0 — Establish branch, validation baseline, and acceptance criteria

### Tasks

- Create the feature branch before implementation work, for example `copilot/rich-phaser-renderer`.
- Read `AGENTS.md` and the relevant deep dives under `docs/agent/`, especially architecture, Phaser renderer, state/persistence, service worker, DOM/CSS, testing, validation, and PR workflow notes.
- Inspect the current Phaser renderer entry points, layout helpers, quality controls, effects handling, drag behavior, service worker, app settings, controller persistence, and tests.
- Record a baseline by running:
  - `npm run lint`
  - `npm run test`
  - `npm run build`
- Define measurable acceptance criteria before code changes land.

### Suggested modules to inspect

- `src/renderers/phaser/index.ts`
- `src/renderers/phaser/layout.ts`
- `src/renderers/phaser/*quality*` or existing quality policy helpers
- `src/app/controller.ts`
- `src/app/view-model.ts`
- `src/app/settings` or current settings modules
- `public/sw.js`
- `src/test/card-art-base-path.test.ts`
- Existing Phaser renderer tests under `src/test/`

### Requirements

- No runtime behavior changes in this phase except branch setup and documentation of acceptance criteria.
- Baseline failures must be captured with command output, affected tests, and whether the failure is pre-existing.
- Initial acceptance criteria must cover retained objects, drag correctness, mobile responsiveness, fallback assets, quality limits, accessibility parity, and validation commands.

### Tests

- Run the full baseline sequence: `npm run lint`, `npm run test`, `npm run build`.
- If baseline failures exist, add a note to the implementation issue before proceeding.

### Definition of done

- Branch exists.
- Baseline validation result is known.
- Acceptance criteria and implementation scope are documented.
- No production code has changed yet.

### Phase 0 implementation notes (2026-08-08)

#### Selection and baseline

- Phase 0 was selected because it was the first unchecked phase in the
  authoritative checklist. No earlier phase exists to verify.
- The task branch, `copilot/implement-first-unchecked-phase`, existed before
  this documentation change. The baseline commit was `89cc4f1`.
- The required pre-change baseline passed:

  | Command | Result |
  | --- | --- |
  | `npm run lint` | Passed (`tsc --noEmit`). |
  | `npm run test` | Passed: 57 files, 600 tests. |
  | `npm run build` | Passed. Vite emitted its existing chunk-size advisory for the 1,545.61 kB JavaScript bundle (403.32 kB gzip); this was not a build failure. |

#### Inspected baseline and scope

- `src/renderers/phaser/index.ts`, `scene-host.ts`, and
  `cardgame-scene.ts` own renderer/scene lifecycle. `renderView` keeps the
  scene-level root container, status text, and active effect objects, but
  clears and reconstructs the root's gameplay children; selected transient
  effect targets and an unchanged menu overlay are retained across passes.
- `layout.ts` and `viewport-resize.ts` already provide safe-area-aware,
  orientation-responsive layout and coalesced resize cleanup.
  `quality.ts` defines phone classification and DPR caps, but
  `resolveGameResolution` is not yet connected to `scene-host.ts`. Current
  runtime adaptations use reduced effect recipes on phone-sized viewports and
  suppress effects when animation speed resolves to `off`; with no stored
  preference, reduced-motion initializes that setting to `off`.
- Dragging currently uses Phaser's built-in draggable containers plus scene
  `drag`, `dragend`, and `drop` listeners. Drop actions are resolved through
  shared app projections, but there is no dedicated pointer-type-aware drag
  controller or Phaser drag integration suite.
- Shared card-style and animation-speed options, guards, persistence, and
  view-model projection already live in `src/app/`. DOM, visible Phaser
  settings, and the native Phaser accessibility mirror consume those shared
  options. At the Phase 0 baseline, board-theme and render-quality preferences
  did not yet exist; Phase 1 now adds them.
- Card art already uses direct `import.meta.env.BASE_URL` access and degrades
  from primary HD art to geometric fallback art to procedural rendering.
  The Phaser loader logs a failed texture key once, but does not yet provide
  the failed-URL suppression and tiered board/sprite fallback required by
  later phases.
- `public/sw.js` is at cache version `v7`, uses network-first behavior for
  unhashed `/cards/*`, and cache-first behavior for hashed `/assets/*` and
  fixed static files. No `/boards/*` or `/sprites/*` policy exists yet.
- The relevant architecture, layout, quality, resize, effects, settings,
  storage, action-resolution, card-art, base-path, and service-worker tests
  were inspected. The later-phase board/theme, retained-card, dedicated-drag,
  drop-zone, asset-loader, and lifecycle test modules do not yet exist.

#### Measurable acceptance criteria for Phases 1–9

| Area | Required result | Verification |
| --- | --- | --- |
| Architecture and ownership | Dependency direction remains `renderers/phaser/ → app/ → game/`; renderer settings and validation live in `src/app/`; Phaser objects and input/resource ownership live in `src/renderers/phaser/`; no game rule changes or renderer imports enter `src/game/`. | Architecture guards plus diff review of imports and changed modules. |
| Retained objects | After warm-up, 100 consecutive syncs of an unchanged view model, layout, theme, and quality profile create or destroy zero board-background, card, or drop-zone display objects. A card keeps one `CardView` identity across visible zone moves, and pooled views expose no prior card text, texture, input, or hidden-hand data. | Instrumented registry/pool tests assert object identity and creation/destruction counters. |
| Drag correctness | Mouse, touch, and pen sequences submit only an action present in the app-provided legal actions. A valid completed drag submits exactly once; movement below the touch/pen threshold, invalid drops, pointer cancellation/loss, visibility changes, resize, menu/route transitions, and scene shutdown submit zero actions and restore the source view. A duplicate release after valid completion submits no additional action. | Pointer/state-machine tests cover every completion and cancellation path, including release outside the source bounds. |
| Mobile responsiveness | The board, hand, overlays, and controls remain inside safe-area bounds at 390×844 portrait, 844×390 landscape, 720×360 short landscape, and a high-DPR phone viewport. Portrait → landscape → portrait restores the original layout without duplicate objects/listeners; collapsed mobile controls retain the existing 44 CSS-pixel target-height contract. | Pure layout/resize tests plus the documented Chromium mobile smoke matrix. |
| Asset and offline fallback | A Vite build with `VITE_BASE_PATH=/regression-base/` places that base in every board/sprite URL and leaves no runtime `import.meta.env.BASE_URL` lookup. Missing HD assets try each declared tier once in order and end on a playable placeholder; a failed URL is not retried during repeated syncs. Unhashed public assets have an explicit tested runtime-cache/offline policy. | Build-invocation, manifest-order, loader-failure, failed-URL, and service-worker tests; offline reload smoke check. |
| Quality limits | Unknown/automatic selection resolves to the balanced profile. Phone DPR is capped at 2 and non-phone DPR at 2.5 or lower; every profile has finite particle/object limits. Low quality, reduced motion, and hidden-page state disable ambience and unnecessary effects, while profile changes update retained objects in place. | Profile-selection tests assert each cap and override; object counters assert live ambience/effect objects never exceed the selected profile. |
| Performance and lifecycle | 1,000 pointer-move updates allocate zero Phaser display objects. Twenty-five theme/profile switches retain at most the active large texture plus one in-flight transition texture. Twenty mount/unmount or scene-restart cycles leave no active drag, tween, delayed call, effect, or added global/scene listener. Desktop and mobile traces record p95 frame time against 16.7 ms and 33.3 ms budgets respectively; a miss requires an approved documented follow-up. | Allocation/object/texture/listener instrumentation, lifecycle tests, and recorded desktop/mobile performance notes. |
| Accessibility and parity | Every visible Phaser action and new setting has a native keyboard/screen-reader alternative. DOM, visible Phaser, and the accessibility mirror expose the same setting values, labels, and selected value; alternative gameplay controls submit the same `GameAction` values and remain unavailable behind modals. Existing DOM, P2P, recording/replay, import/export, and renderer-selection behavior remains unchanged. | Cross-surface row/action tests, keyboard-only smoke checks, hidden-hand regression tests, and the full suite. |
| Validation gate | Each implementation phase runs its targeted tests followed by `npm run lint`, `npm run test`, `npm run build`, and `codeql_checker`. Final verification also records the desktop/mobile, reduced-motion, offline, fallback, renderer-switch, and non-root-base smoke matrix. | Command output, exact passing test count, CodeQL result, and independent subagent report are recorded in the PR. |

Phase 0 intentionally changed documentation only. At its conclusion, Phases
1–9 remained deferred and unchecked. Phase 1 has since been completed; Phases
2–9, the manual smoke matrix, performance measurements, and all independent
final-verification checklist items remain deferred and unchecked.

## Phase 1 — Add persisted board-theme and render-quality settings

### Tasks

- Add shared app-level setting modules for `BoardTheme` and renderer quality preferences.
- Define immutable option tuples, labels, defaults, and type unions in `src/app/`, not inside Phaser-only code.
- Add guards such as `isBoardTheme` and `isRenderQualityPreference` for untrusted input.
- Persist settings safely in `localStorage`, rejecting unknown values and falling back to defaults.
- Ensure corrupted or absent storage does not throw during app startup.
- Expose the options through the existing settings/view-model flow.
- Add UI parity so DOM and Phaser can both view and change the setting, or so Phaser-specific quality controls have an accessible DOM/settings equivalent.

### Suggested modules

- New `src/app/board-theme.ts`
- New or extended `src/app/render-quality.ts`
- Existing app settings/persistence module
- DOM settings/menu renderer
- Phaser menu/settings overlay
- View-model projection module

### Requirements

- Keep settings validation shared in `src/app/`.
- Do not cast strings to setting unions.
- Use existing storage warning behavior and avoid overwriting storage-unavailable warnings with later unconditional success messages.
- Keep option tuples immutable with `as const` and derive types from them.
- Preserve current defaults for existing users.

### Tests

- Unit tests for option guards and default fallback behavior.
- Storage tests for missing, valid, invalid, and malformed persisted values.
- UI/view-model tests that verify DOM and Phaser receive equivalent option labels and selected values.
- Regression tests ensuring corrupted settings do not prevent app initialization.

### Definition of done

- Board theme and quality preferences are shared app settings.
- Invalid persisted values are rejected safely.
- DOM and Phaser expose equivalent user-facing choices.
- `npm run lint`, `npm run test`, and `npm run build` pass.

### Phase 6 implementation notes (2026-08-09)

- Added retained Phaser feedback owners:
  - `src/renderers/phaser/drop-zone-view.ts` keeps one battlefield outline,
    contextual label, and reusable target-ring pool outside the transient
    gameplay root.
  - `src/renderers/phaser/interaction-feedback.ts` maps drag state and shared
    app visual-effect descriptors to feedback labels with a safe unknown-kind
    fallback.
- `CardgameScene` owns and cleans up the feedback view. `DragController`
  reports retained drag-state and pointer updates so move handling only updates
  existing visual properties; it does not create Phaser display objects.
  Legal playability remains projected from `GameUiState.legal`, and
  `visualEffectForEvent` remains the shared app-level semantic source.
- Highlighted playable hand cards and battlefield targets now provide clear
  visual affordances alongside the existing native accessibility controls and
  target picker.
- Added `src/test/phaser-drop-zone-view.test.ts` and
  `src/test/phaser-interaction-feedback.test.ts`; expanded the Phaser module
  architecture guard. Coverage includes valid/invalid feedback, target rings,
  1,000 pointer updates without new Phaser objects, cleanup, known effect
  labels, and unknown-descriptor fallback.
- Validation passed: `npm run lint`, `npm run test` (73 files / 690 tests),
  and `npm run build` (with the existing non-failing chunk-size advisory).
  CodeQL is recorded with the implementation validation.

### Phase 1 implementation notes (2026-08-08)

- Added shared app settings modules:
  - `src/app/board-theme.ts`
  - `src/app/render-quality.ts`
  Both define immutable option tuples, labels, defaults, guards, and safe
  localStorage persistence/fallback behavior.
- Wired settings through app state, controller API, and immutable view-model:
  - `src/app/types.ts`
  - `src/app/controller.ts`
  - `src/app/view-model.ts`
- Added DOM + Phaser settings parity for visible controls and a11y navigation:
  - `src/renderers/dom-utils.ts`
  - `src/renderers/dom.ts`
  - `src/renderers/phaser/lobby-actions.ts`
  - `src/renderers/phaser/lobby-scene.ts`
  - `src/renderers/phaser/a11y-navigation.ts`
- Added/updated tests:
  - `src/test/board-theme.test.ts`
  - `src/test/render-quality.test.ts`
  - `src/test/controller-renderer-settings.test.ts`
  - `src/test/dom-lobby.test.ts`
  - `src/test/phaser-lobby-actions.test.ts`
  - `src/test/view-model.test.ts`
  - `src/test/action-resolution.test.ts`
- Validation performed:
  - Targeted: `npm run test -- src/test/board-theme.test.ts src/test/render-quality.test.ts src/test/controller-renderer-settings.test.ts src/test/phaser-lobby-actions.test.ts src/test/dom-lobby.test.ts src/test/view-model.test.ts src/test/action-resolution.test.ts`
  - Full: `npm run lint`, `npm run test` (60 files / 610 tests), `npm run build`, `codeql_checker` (0 alerts)
- Independent subagent review completed (`code-review` agent). No merge-blocking
  issues were found. Non-blocking follow-up suggestions (additional DOM/a11y
  interaction wiring tests) were deferred.

## Phase 2 — Add base-path-safe HD board and sprite asset pipeline

### Tasks

- Define a public asset layout under `public/boards/<theme>/` with separate variants for HD, balanced, low, and fallback assets.
- Keep large board backgrounds separate from UI/effect atlases so the renderer can load only the needed quality tier.
- Add sprite/atlas manifest definitions for repeated UI, zone, effect, and interaction visuals.
- Add URL helpers that use direct literal `import.meta.env.BASE_URL` access so Vite replaces the value for GitHub Pages builds.
- Add loader error handling that falls back from HD to balanced, low, and placeholder assets without crashing the scene.
- Track failed runtime asset URLs to avoid retry loops during repeated render syncs.
- Update runtime cache and service worker behavior for new same-path assets and unhashed public assets. Bump the cache version when required.

### Suggested asset layout

```text
public/boards/<theme>/
  background-hd.png
  background-balanced.png
  background-low.png
  background-fallback.png
  ambience-atlas.png
  ambience-atlas.json
public/sprites/
  board-ui-atlas.png
  board-ui-atlas.json
  effects-atlas.png
  effects-atlas.json
```

### Suggested modules

- New `src/app/board-assets.ts` for shared manifest names and base-path-safe URLs
- New `src/renderers/phaser/asset-manifest.ts`
- New `src/renderers/phaser/texture-loader.ts`
- Existing service worker module
- Existing base-path/card-art tests as a pattern

### Requirements

- Never build asset URLs through an alias of `import.meta.env.BASE_URL`.
- Large backgrounds should be independently loadable and evictable.
- Atlases should be used for repeated sprites and effects.
- Asset failures must be visible in diagnostics but non-fatal for gameplay.
- GitHub Pages non-root base path must work for all assets.
- Offline/runtime cache behavior must match existing `/cards/*` and `/assets/*` expectations: network-first for unhashed public content where appropriate, cache-first for hashed build assets.

### Tests

- Build-invocation regression test following `src/test/card-art-base-path.test.ts` to verify board URLs include the configured base path.
- Unit tests for URL normalization and fallback ordering.
- Service worker tests for board asset caching strategy and cache-version changes.
- Phaser loader tests or adapter tests for error-to-fallback transitions.

### Definition of done

- Board and sprite manifests exist with HD/balanced/low/fallback variants.
- URL generation is base-path safe.
- Loader failures fall back without breaking gameplay.
- Service worker/runtime cache updates are complete.
- `npm run lint`, `npm run test`, and `npm run build` pass.

### Phase 2 implementation notes (2026-08-08)

- Phase 2 was selected because it was the first unchecked phase. The Phase 0
  baseline/acceptance criteria and Phase 1 shared theme/quality settings,
  persistence, view-model projection, renderer parity, and tests were verified
  in the current tree before implementation.
- Added renderer-neutral paths, direct-literal Vite `BASE_URL` URL generation,
  and immutable asset locations in `src/app/board-assets.ts`.
- Added independently loadable HD/balanced/low/fallback backgrounds for all
  three themes under `public/boards/`, per-theme ambience atlases, and shared
  board UI/effect atlases under `public/sprites/`. Asset dimensions, PNG
  validity, atlas metadata, and required frame names are covered by tests.
- Added `src/renderers/phaser/asset-manifest.ts` and
  `src/renderers/phaser/texture-loader.ts`. The loader queues one background
  tier at a time, advances through ordered fallbacks during transport or image
  processing failure, treats malformed atlas JSON/frame data as non-fatal,
  removes partial atlases, remembers failed URLs, and cleans up listeners
  idempotently. `CardgameScene` preloads the selected theme/quality manifest;
  rendering the retained background remains Phase 3 work.
- Updated `public/sw.js` to cache unhashed `/boards/*` and `/sprites/*`
  network-first, await best-effort runtime cache writes, preserve valid network
  responses when cache storage fails, and bump `CACHE_VERSION` from `v7` to
  `v8`. Cache-version checks now cover cards, boards, and sprites.
- Added `board-assets`, `board-asset-files`, `phaser-asset-manifest`,
  `phaser-texture-loader`, and production-build base-path tests, and extended
  service-worker/cache-version/architecture coverage. The targeted asset,
  loader, service-worker, and base-path tests passed.
- Required validation passed: `npm run lint`; `npm run test` (65 files / 635
  tests); `npm run build` (with the existing non-failing chunk-size advisory);
  and `codeql_checker` (0 alerts).
- Independent `code-review` subagents inspected the actual diff and Phaser
  internals. Reported blockers around cache-write lifetime, decode/parse
  fallback, scene-create timing, required atlas frames, and last-child atlas
  assembly were fixed in focused commits and re-reviewed. The final review
  reported no blockers.
- Deferred as planned: retained background rendering/ambience (Phase 3), large
  texture eviction (Phase 8), and manual offline/mobile smoke and performance
  measurement (Phase 9). The independent final-verification checklist remains
  unchecked.

## Phase 3 — Implement persistent board background and adaptive ambience

### Tasks

- Add `BoardBackgroundView` as a retained Phaser object owner.
- Create persistent background image layers once per scene/theme and update them in place.
- Implement cover-fit crop math so HD backgrounds fill the viewport without relying on `GeometryMask`.
- Add optional foreground/ambience layers using bounded sprite or particle counts.
- Respect reduced-motion and low-quality settings by disabling or simplifying ambience.
- Ensure resize updates crop, scale, position, and depth without reallocating all background objects.
- Add theme-switch handling that transitions textures safely and frees no-longer-needed large textures.

### Suggested modules

- New `src/renderers/phaser/board-background.ts`
- Existing `src/renderers/phaser/layout.ts`
- New or extended Phaser quality module
- Shared app theme/quality setting modules from Phase 1

### Requirements

- Do not use Phaser `GeometryMask` for clipping under WebGL.
- Use `setCrop` or manual culling for large images and scrollable regions.
- Bound ambience by quality profile and device class.
- Pause or reduce ambience when the page is hidden.
- Keep background rendering independent from game rules.

### Tests

- Unit tests for cover-fit crop calculations across portrait, landscape, narrow, wide, and high-DPR sizes.
- Lifecycle tests that theme switches do not leak stale texture keys or duplicate layers.
- Reduced-motion tests verifying ambience is disabled or minimized.
- Manual smoke tests in desktop and mobile viewport sizes.

### Definition of done

- Board background persists across view-model syncs.
- Resize and theme changes update retained objects in place.
- Ambience is bounded, reduced-motion aware, and quality aware.
- `npm run lint`, `npm run test`, and `npm run build` pass.

### Phase 3 implementation notes (2026-08-09)

- Phase 3 was selected because it was the first unchecked phase in the
  authoritative checklist. Phase 0 acceptance criteria, Phase 1 shared
  board-theme/render-quality settings, and Phase 2 board/sprite asset pipeline
  were verified in the current tree before implementation.
- Added `src/renderers/phaser/board-background.ts` as the retained
  scene-level owner for background fallback fill, loaded board image, cover-fit
  `setCrop` math, bounded ambience sprites/tweens, hidden-page reduction, and
  stale large-background texture eviction.
- Integrated board background asset preloading and retained sync into
  `src/renderers/phaser/cardgame-scene.ts` without changing game rules or app
  controller internals. The board background lives outside the rebuild-heavy
  gameplay root container and is destroyed on scene shutdown.
- Updated Phaser depth/module documentation and guards for the new
  `DEPTH_BACKGROUND` layer and `board-background.ts` module.
- Added `src/test/phaser-board-background.test.ts` for cover-fit crop math,
  retained image identity, theme-switch texture eviction, and quality,
  reduced-motion, hidden-page, and phone-sized ambience bounds. Updated depth
  and module-architecture tests for the new layer/module.
- Validation performed:
  - Targeted:
    `npm run test -- src/test/phaser-board-background.test.ts src/test/phaser-depth.test.ts src/test/phaser-module-architecture.test.ts`
    (37 tests).
  - `npm run lint`.
  - `npm run test` (66 files / 642 tests).
  - `npm run build` (with the existing non-failing chunk-size advisory).
  - `codeql_checker` (0 alerts).
- Independent `code-review` subagent review inspected the actual diff and
  relevant Phaser code. It found one merge-blocking lifecycle issue: the active
  large board texture was not evicted on scene shutdown. The blocker was fixed
  by removing tracked background textures in `BoardBackgroundView.destroy()`
  and adding a regression test; a focused follow-up `code-review` reported no
  remaining blockers.
- Known limitations/deferred work: manual desktop/mobile smoke, broader
  performance traces, retained cards, dedicated drag, drop-zone visuals, and
  full final-verification subagent checklist items remain deferred to later
  phases as planned.

## Phase 4 — Replace rebuild-heavy card rendering with retained `CardView` objects

### Tasks

- Introduce a `CardView` abstraction that owns the Phaser containers/images/text associated with one visible card.
- Extend the view-model card projection first so one stable identity exists across zones: add the underlying `Card.id` to `UiBattlefieldCard` in `src/app/types.ts`/`src/app/view-model.ts` while keeping `instanceId` for targeting.
- Introduce `CardViewRegistry` keyed by that stable `cardId` value from the view model.
- Reconcile card zones by creating views for new cards, updating existing views in place, and pooling/removing views for cards that leave visibility.
- Add move tweens for zone/slot changes while preserving deterministic final positions after sync.
- Keep hidden-hand and privacy behavior exactly equivalent to the current renderer: do not reveal opponent hidden card identities, textures, names, or metadata.
- Add texture fallback behavior for cards whose raster or atlas art fails to load.
- Ensure pooled views are fully reset before reuse, including text, texture, tint, alpha, interactivity, listeners, depth, and drag state.

### Suggested modules

- New `src/renderers/phaser/card-view.ts`
- New `src/renderers/phaser/card-view-registry.ts`
- New `src/renderers/phaser/card-view-pool.ts`
- Existing card-art helpers
- Existing app-level card visual style settings
- Existing hand/battlefield layout helpers

### Requirements

- Key by the stable `cardId` projected by the view model, not array index and not the Phaser object order. Keep `instanceId` as the identifier submitted in `GameAction` targeting payloads.
- Preserve immutable view-model consumption.
- Do not use `structuredClone(GameState)` in render or AI hot loops.
- Do not hardcode card visual style defaults; reuse shared constants such as `DEFAULT_CARD_VISUAL_STYLE` where applicable.
- Reconciliation must be idempotent: two syncs with the same view model should not allocate new card objects or submit actions.

### Tests

- Registry reconciliation tests for create/update/remove/reorder cases.
- Pool reset tests that verify no stale hidden/private data leaks after reuse.
- Snapshot or structural tests for hidden opponent hand rendering.
- Movement tests using fake timer helpers to verify tween completion reaches expected layout.
- Regression tests for texture fallback after raster load failure.

### Definition of done

- Broad card reconstruction is replaced by keyed retained card views.
- Hidden-information behavior is unchanged.
- Repeated syncs are allocation-light and idempotent.
- `npm run lint`, `npm run test`, and `npm run build` pass.

### Phase 4 implementation notes (2026-08-09)

- Phase 4 was selected because it was the first unchecked phase in the
  authoritative checklist. Phase 0 acceptance criteria, Phase 1 shared
  renderer settings, Phase 2 asset loading/fallbacks, and Phase 3 retained
  background ownership were verified in the current tree before completion.
- Extended immutable battlefield projections with stable `cardId` values while
  preserving targeting-only `instanceId` values in `src/app/types.ts` and
  `src/app/view-model.ts`.
- Added retained `CardView`, `CardViewPool`, and `CardViewRegistry` ownership
  under `src/renderers/phaser/`, then routed hand and battlefield descriptors
  through the registry from `GameplayPresenter`. The scene preserves the card
  layer across transient root rebuilds and resets it on game/scene lifecycle
  boundaries.
- Reconciliation retains outer card identity across visible zone moves,
  updates faces and interactions only when signatures change, bounds the pool,
  completes movement tweens at deterministic targets, falls back from failed
  raster art, and fully clears hidden-hand data before reuse.
- Hardened retained input lifecycle after review: pool cleanup preserves
  Phaser's parent `destroy` listener, pointer-out clears click latches, and
  canceled clicks or drag/drop releases cannot submit or animate an action.
- Added or extended `view-model`, retained-card registry, card-rendering,
  battlefield-target, card-preview, and module-architecture tests. Targeted
  validation passed (6 files / 80 tests); required validation passed:
  `npm run lint`, `npm run test` (67 files / 661 tests), `npm run build`
  (with the existing non-failing chunk-size advisory), and `codeql_checker`
  (0 alerts).
- Independent `code-review` inspected the actual implementation and surrounding
  Phaser input internals. Its canceled/outside pointer-release blocker was
  fixed in `f3611c6`; focused re-review reported no remaining blockers.
- Deferred as planned: the dedicated pointer-type-aware drag controller and
  drag proxy (Phase 5), later drop-zone/quality/lifecycle/performance phases,
  and real-browser mobile/WebGL smoke coverage. The independent final
  verification checklist remains unchecked.

## Phase 5 — Add dedicated mouse/touch drag-and-drop controller

### Tasks

- Create a Phaser-specific drag controller that owns pointer state, drag thresholds, drag proxies, cancellation, and action submission.
- Use a movement threshold for touch and pen input so tap/preview behavior does not accidentally become a drag.
- Render a high-depth drag proxy while dimming or marking the original retained card view.
- Submit at most one action for a completed drag, and only through the existing controller action boundary.
- Implement valid drop, invalid drop, pointer-cancel, scene-shutdown, visibility-change, route/menu transition, and resize cancellation paths.
- Return invalid drops with a bounded tween and restore original interactivity.
- Provide keyboard/accessibility alternatives through existing DOM or shared app controls.

### Suggested modules

- New `src/renderers/phaser/drag-controller.ts`
- New `src/renderers/phaser/drag-state.ts`
- `CardView` integration points
- `DropZoneView` integration points
- Existing action/legality projection from `src/app/`

### Requirements

- The controller may inspect app-provided legal actions, but must not reimplement game rules.
- Pointer move work must be cheap: update only the drag proxy directly and defer expensive hover/legality recomputation.
- All pointer listeners must be removed on shutdown/destroy.
- Drag release outside the original card still resolves safely.
- Duplicate pointer-up events or cancellation followed by pointer-up must not submit duplicate actions.

### Tests

- Unit tests for drag state transitions and at-most-once submission.
- Pointer simulation tests for mouse, touch threshold, invalid drop, cancel, and release outside source bounds.
- Accessibility regression test that non-drag action alternatives remain available.
- Rule-parity tests comparing submitted `GameAction` values to existing legal-action projections.

### Definition of done

- Drag behavior is smooth and pointer-type aware.
- Valid and invalid drops resolve predictably.
- Cancellation paths clean up state and listeners.
- Accessibility alternatives remain intact.
- `npm run lint`, `npm run test`, and `npm run build` pass.

### Phase 5 implementation notes (2026-08-09)

- Phase 5 was selected because it was the first unchecked phase in the
  authoritative checklist. The Phase 0 acceptance baseline, shared settings
  and asset pipeline from Phases 1–2, and retained background/card ownership
  from Phases 3–4 were verified in the current tree before implementation.
- Added `src/renderers/phaser/drag-state.ts` and
  `src/renderers/phaser/drag-controller.ts`. One scene-owned controller now
  validates mouse/touch/pen pointer sessions, applies a 12-pixel touch/pen
  threshold, owns a high-depth retained drag proxy, submits only actions from
  `resolvePlayLandDrop`, and suppresses duplicate or non-owning releases.
- Integrated proxy snapshots and source dim/restore behavior with `CardView`
  and `CardViewRegistry`. Invalid drops use a bounded return tween; resize,
  visibility, menu, game-change, pointer-cancel/loss, stale-source, and scene
  shutdown paths cancel idempotently and remove all controller listeners.
  Targeted land choices still route through the existing battlefield and
  popup target-selection flows.
- Added `src/test/drag-state.test.ts`,
  `src/test/phaser-drag-controller.test.ts`, and
  `src/test/phaser-drag-accessibility.test.ts`; updated retained-card, depth,
  and module-architecture coverage. Tests cover thresholds, mouse/touch/pen
  transitions, overlapping pointers, release outside the source, legal-action
  parity, duplicate release, invalid return, all cancellation paths, 1,000
  retained-proxy moves, cleanup, and native accessibility alternatives.
- Updated `docs/agent/architecture.md` and
  `docs/agent/phaser-renderer.md` with the durable input ownership and depth
  contracts. Targeted validation passed (8 files / 77 tests); required
  validation passed: `npm run lint`, `npm run test` (71 files / 682 tests),
  `npm run build` (with the existing non-failing chunk-size advisory), and
  `codeql_checker` (0 alerts).
- Independent `code-review` inspected the actual diff, surrounding renderer
  code, and installed Phaser 4.1 input semantics. It reported no
  merge-blocking defects. The safe single-active-pointer policy is now
  controller-tested; optional drag-proxy pooling remains deferred to the
  adaptive performance/lifecycle phases.
- Manual browser smoke and a screenshot could not be captured because the
  Playwright MCP required interactive browser OAuth in this environment.
  Later-phase real-browser mobile/WebGL smoke, drop-zone visuals, quality
  policy, and final verification remain unchecked as planned.

## Phase 6 — Add drop-zone visuals and contextual interaction feedback

### Tasks

- Add `DropZoneView` objects for battlefield, hand, playable-card, target, attack/block, and modal target areas as applicable.
- Drive zone visibility from current legal actions and drag state.
- Cache reusable highlight sprites, outlines, text labels, and target rings.
- Avoid allocation on every pointer move; update positions, alpha, tint, and visibility in place.
- Map shared visual-effect semantics from `src/app/` to Phaser presentation effects.
- Show valid, invalid, hover, selected, and disabled states consistently across desktop and touch interactions.

### Suggested modules

- New `src/renderers/phaser/drop-zone-view.ts`
- New `src/renderers/phaser/interaction-feedback.ts`
- Existing app effect descriptor modules
- Existing Phaser effects queue
- Existing layout helpers

### Requirements

- No rule duplication: legal zones come from shared action/selector data.
- Reusable visuals must be pooled or retained.
- Pointer-move handlers must not allocate new Phaser objects.
- Feedback semantics should align with DOM labels/tooltips where possible.
- Unknown or future effect descriptors must fall back safely rather than returning `undefined` from format/render paths.

### Tests

- Drop-zone sync tests for no drag, valid drag, invalid hover, target selection, and state transitions.
- Allocation guard tests or instrumentation around pointer-move update paths.
- Effect descriptor mapping tests for known and unknown descriptor kinds.
- Visual regression screenshots for representative desktop/mobile states if screenshot infrastructure exists.

### Definition of done

- Legal drop and target feedback is clear and reusable.
- Pointer move is allocation-light.
- Shared effect semantics remain centralized.
- `npm run lint`, `npm run test`, and `npm run build` pass.

## Phase 7 — Implement adaptive desktop/mobile performance policy

### Tasks

- Define `PhaserQualityProfile` values derived from shared render-quality preference, device signals, reduced-motion state, visibility state, and viewport size.
- Add high, balanced, and low profiles with explicit recommendations for backgrounds, ambience, particles, tweens, shadows, antialiasing, and DPR cap.
- Cap device pixel ratio on high-DPR phones to avoid excessive GPU fill-rate cost.
- Validate actual Phaser 4 renderer and scale-manager APIs before changing render scaling or resolution behavior.
- Add visibility handling to pause ambience, reduce timers, and avoid unnecessary work when hidden.
- Ensure profile changes reconcile retained objects instead of recreating the full scene.

### Suggested profile shape

```ts
type PhaserQualityProfile = {
  readonly tier: 'high' | 'balanced' | 'low';
  readonly maxDevicePixelRatio: number;
  readonly backgroundVariant: 'hd' | 'balanced' | 'low' | 'fallback';
  readonly ambience: 'full' | 'reduced' | 'off';
  readonly maxParticles: number;
  readonly enableMoveTweens: boolean;
  readonly enableHoverTweens: boolean;
};
```

### Suggested modules

- New or extended `src/renderers/phaser/quality.ts`
- Shared `src/app/render-quality.ts`
- `BoardBackgroundView`
- `CardViewRegistry`
- `DropZoneView`
- Scene visibility/lifecycle hooks

### Requirements

- Validate Phaser 4 APIs against installed `phaser` types and runtime behavior before modifying resolution, canvas size, or scale behavior.
- High profile may use HD assets and richer ambience on capable desktop devices.
- Balanced profile should be the safe default for unknown devices.
- Low profile should minimize overdraw, particles, shadows, filters, and high-DPR rendering.
- Reduced-motion must override ambience and unnecessary animation.
- Hidden tabs should not keep running expensive effects.

### Tests

- Unit tests for profile selection across desktop, mobile, high-DPR mobile, reduced-motion, hidden tab, and explicit user preference cases.
- Integration tests verifying profile changes update retained views without duplicate objects.
- Manual smoke tests on desktop Chrome/Firefox/Safari if available, mobile emulation, and at least one touch viewport.
- Performance measurement notes for frame time and object counts.

### Definition of done

- Quality policy is explicit, typed, and tested.
- DPR and ambience are bounded on mobile.
- Phaser API usage has been verified before scaling changes land.
- `npm run lint`, `npm run test`, and `npm run build` pass.

### Phase 7 implementation notes (2026-08-10)

- `src/renderers/phaser/quality.ts` now owns the adaptive policy. It exports a
  frozen `PhaserQualityProfile` (`tier`, `maxDevicePixelRatio`,
  `backgroundVariant`, `ambience`, `maxParticles`, `effectDetail`,
  `enableMoveTweens`, `enableHoverTweens`) and `resolvePhaserQualityProfile`,
  which folds the shared `RenderQualityPreference` together with viewport
  size/phone-sizedness, `prefers-reduced-motion`, animation speed, and page
  visibility. `'auto'` never selects the high tier on phone-sized viewports and
  only selects it on comfortably large desktop viewports; everything else falls
  back to `balanced`. `resolveGameResolution` now derives its cap from the same
  profile.
- Phaser 4 API verification: `Phaser.Types.Core.GameConfig` has no
  `resolution` option and `ScaleManager` (phaser@4.1.0) never multiplies the
  canvas backing store by `window.devicePixelRatio` — only `zoom`,
  `setGameSize`, and `resize` affect canvas size. With `Phaser.Scale.RESIZE`
  the drawing buffer already matches CSS pixels, so no scale-manager or
  resolution behavior was changed; `maxDevicePixelRatio` is an explicit policy
  bound (phones capped at 2 regardless of tier).
- Consumers reconcile retained objects instead of rebuilding the scene:
  - `board-background.ts` takes the profile in `BoardBackgroundSyncOptions`;
    `resolveBoardAmbiencePolicy(profile)` is now a pure projection of
    `ambience`/`maxParticles`, so hidden tabs, reduced motion, and the low tier
    all stop ambience sprites and their tweens in place.
  - `cardgame-scene.ts` resolves the profile once per render pass, keys the
    board asset manifest/preload on the resolved `tier` (so `'auto'` picks a
    real asset tier), and passes `enableMoveTweens` to the card view registry.
  - `card-view.ts` / `card-view-registry.ts` snap card positions instead of
    tweening when the profile disables move tweens.
  - `effect-controller.ts` takes `effectDetail` from the profile, falling back
    to the previous viewport heuristic when no profile is available.
- Tests: extended `src/test/phaser-quality.test.ts` (tier selection across
  desktop/phone/small/invalid viewports, explicit preferences, DPR caps,
  background variant, ambience/particle bounds, reduced-motion/animations-off/
  hidden-tab overrides and recovery, effect detail, frozen profile);
  `src/test/phaser-board-background.test.ts` (profile-driven ambience, in-place
  tier downgrade without duplicate objects, hide/restore ambience);
  `src/test/phaser-card-view-registry.test.ts` (tween suppression);
  `src/test/phaser-module-architecture.test.ts` (guards `quality.ts`).
- Documentation: `docs/agent/architecture.md` module map and
  `docs/agent/phaser-renderer.md` quality/effect sections updated.
- Validation: `npm run lint`, `npm run test`, `npm run build`, and
  `codeql_checker` — see the PR description for exact results.
- Deferred/known limitations: no real-browser desktop/mobile smoke matrix or
  frame-time measurement was captured in this environment (no interactive
  browser); those belong to Phase 9. Hover tweens are exposed via
  `enableHoverTweens` but no renderer currently runs hover tweens, so the flag
  has no consumer yet.

## Phase 8 — Audit scene lifecycle, cleanup, and texture/resource eviction

### Tasks

- Audit every object owner introduced by previous phases for `destroy`, `dispose`, or `shutdown` behavior.
- Clean up on renderer transitions, scene shutdown, scene destroy, app unmount, route/menu transitions, resize teardown, game seed reset, and visibility-state changes.
- Remove global listeners, Phaser input listeners, timers, tweens, delayed calls, texture references, cached failed URLs, drag state, and pooled transient objects when no longer valid.
- Evict large theme background textures when switching themes or quality tiers if they are not shared by another active scene.
- Ensure game reset/new seed clears retained card views and effect queues before the next game sync.

### Suggested modules

- Scene lifecycle owner or disposer registry in `src/renderers/phaser/`
- `BoardBackgroundView`
- `CardViewRegistry`
- `DropZoneView`
- `DragController`
- Texture loader/cache helpers
- Existing renderer mount/unmount code

### Requirements

- Cleanup must be safe to call more than once.
- Scene shutdown must cancel in-flight drags and queued effects.
- Resize handlers must be debounced/throttled where appropriate and removed on unmount.
- Texture eviction must not remove textures still in active use.
- Visibility transitions must not leave the scene in a permanently paused or degraded state after returning to visible.

### Tests

- Lifecycle tests for mount/unmount, scene restart, renderer switch, game reset, and theme switch.
- Listener cleanup tests using spies or counters where practical.
- Texture cache tests for large background eviction and fallback preservation.
- Drag cancellation tests during shutdown and visibility changes.

### Definition of done

- All retained object owners have idempotent cleanup.
- No known listener, tween, timer, texture, or drag-state leaks remain.
- Renderer transitions and game resets are stable.
- `npm run lint`, `npm run test`, and `npm run build` pass.

## Phase 9 — Add regression, lifecycle, and performance verification

### Tasks

- Fill gaps in unit, integration, and smoke coverage from earlier phases.
- Add named regression tests that document the retained-mode behavior and repository-specific guardrails.
- Add a desktop/mobile smoke matrix and record expected manual checks.
- Measure performance against acceptance targets and document results.
- Update relevant documentation under `docs/agent/` only if new durable renderer rules are introduced.

### Suggested tests

- `src/test/phaser-board-theme-settings.test.ts` — validates board theme and quality guards, defaults, and storage fallback.
- `src/test/phaser-board-assets-base-path.test.ts` — verifies board asset URLs survive a Vite build with a non-root base path.
- `src/test/phaser-board-background-view.test.ts` — verifies cover-fit crop, resize sync, reduced-motion ambience, and theme switching.
- `src/test/phaser-card-view-registry.test.ts` — verifies keyed create/update/remove/reorder behavior and pool reset.
- `src/test/phaser-drag-controller.test.ts` — verifies thresholds, cancel paths, invalid drops, and at-most-once action submission.
- `src/test/phaser-drop-zone-view.test.ts` — verifies legal zone feedback and reusable visual states.
- `src/test/phaser-quality-profile.test.ts` — verifies DPR caps, tier selection, reduced-motion, and visibility handling.
- `src/test/phaser-lifecycle-cleanup.test.ts` — verifies listener, texture, tween, timer, and drag cleanup.

### Required commands

Run these after each phase and before final merge:

```bash
npm run lint
npm run test
npm run build
```

Then run CodeQL review before finalizing the implementation PR.

### Desktop/mobile smoke matrix

- Desktop Chrome or Chromium, mouse input, high and balanced quality.
- Desktop Firefox or WebKit where available, mouse input, resize and renderer switching.
- Mobile viewport emulation, touch input, balanced and low quality.
- High-DPR mobile viewport, low quality or DPR-capped balanced quality.
- Reduced-motion enabled, ambience disabled/reduced.
- Offline/reload path with service worker enabled and cached fallback assets.
- Non-root GitHub Pages base path build.

### Performance acceptance targets

- Repeated sync with unchanged view model creates no new retained board/card/drop-zone objects.
- Pointer move during drag allocates no Phaser display objects and performs only bounded math/state updates.
- Mobile low-quality mode avoids expensive filters, unbounded particles, and uncapped DPR.
- Scene shutdown leaves no active drag, no retained tweens/timers, and no orphan global listeners.
- Large background textures are not accumulated across repeated theme switches.
- Gameplay remains responsive during hand drag, battlefield updates, and resize.

### Definition of done

- Named regression tests cover the retained renderer, settings, asset, input, lifecycle, and quality paths.
- Manual smoke matrix is complete.
- Performance targets are met or documented with approved follow-up issues.
- `npm run lint`, `npm run test`, `npm run build`, and CodeQL pass.

## Autonomous implementation workflow

Implement the renderer evolution in small logical commits, each scoped to one reviewable concern. A suggested commit sequence is:

1. Add shared board-theme and render-quality settings with guards and tests.
2. Add board/sprite asset manifests, base-path-safe URL helpers, and service worker updates.
3. Add retained `BoardBackgroundView` and cover-fit crop tests.
4. Add `CardView`, registry reconciliation, pooling, and hidden-information tests.
5. Add drag controller state machine and action-submission tests.
6. Add drop-zone visuals and contextual feedback tests.
7. Add adaptive `PhaserQualityProfile` and visibility/reduced-motion handling.
8. Add lifecycle cleanup, resource eviction, and reset tests.
9. Add final regression/performance documentation and address subagent findings.

For every phase:

- Keep changes surgical and avoid unrelated refactors.
- Run the canonical validation sequence from `docs/agent/validation-and-build.md` before reporting the phase complete: `npm run lint`, `npm run test`, `npm run build`, then `codeql_checker`, addressing every alert it reports.
- If validation fails, stop and fix the phase before starting the next one unless the failure is proven pre-existing and documented.
- Preserve direct `import.meta.env.BASE_URL` member access.
- Use crop/manual culling instead of Phaser `GeometryMask` for WebGL clipping.
- Validate all persisted settings and untrusted JSON with shared guards.
- Keep shared visual semantics, settings, and persistence in `src/app/`; keep Phaser objects, input, pooling, and texture ownership in `src/renderers/phaser/`.
- Do not modify engine legality, hidden-information rules, P2P semantics, recordings, renderer selection, or DOM accessibility flows except to preserve parity with new settings.

## Independent subagent verification

Use one or more independent verification subagents after implementation is substantially complete. The subagent should review the implementation rather than initially implement it. Provide the subagent with the branch, objective, acceptance criteria, changed files, validation results, and this plan.

### Architecture and ownership review checklist

- Verify dependency direction remains `src/renderers/phaser/ → src/app/ → src/game/`.
- Confirm `src/game/` has no renderer, Phaser, asset, storage, or browser dependencies.
- Confirm shared settings, persistence, guards, and cross-renderer visual semantics live in `src/app/`.
- Confirm Phaser display objects, pooling, texture ownership, and input controllers live in `src/renderers/phaser/`.
- Confirm the renderer consumes immutable `AppViewModel` snapshots and submits existing `GameAction` values.
- Flag broad unrelated refactors or source changes outside the intended ownership boundaries.

### Lifecycle, memory, and listener-cleanup review checklist

- Verify retained views are cleaned up on scene shutdown, destroy, unmount, renderer switch, game reset, theme switch, resize teardown, and visibility changes.
- Verify cleanup is idempotent.
- Verify global listeners, Phaser input listeners, timers, tweens, delayed calls, drag state, and effect queues are removed or cancelled.
- Verify large background textures are evicted when safe and retained only when still active.
- Verify pooled card/drop-zone/effect objects are fully reset before reuse.
- Flag any leak-prone owner without a clear lifecycle contract.

### Input safety, accessibility, and rule-parity review checklist

- Verify drag-and-drop submits at most one action per completed drag.
- Verify invalid drops, cancellation, pointer loss, scene shutdown, visibility changes, and release outside source bounds are safe.
- Verify drag legality comes from shared app/game projections, not duplicated Phaser-only rules.
- Verify hidden opponent hand behavior does not leak private card identity, art, metadata, or stale pooled state.
- Verify keyboard, DOM, screen-reader, and non-canvas action alternatives remain available.
- Verify DOM renderer, P2P, recordings, replay, import/export, and renderer selection behavior are not regressed.

### Asset, GitHub Pages, and service-worker review checklist

- Verify asset URL helpers use direct `import.meta.env.BASE_URL` literal member access.
- Verify non-root GitHub Pages builds resolve board backgrounds, sprite atlases, fallback textures, and existing card art.
- Verify loader error handling falls back without crashing or retrying failed URLs indefinitely.
- Verify service worker/runtime cache behavior handles public board assets and hashed build assets correctly.
- Verify cache version is bumped when same-path public assets change.
- Verify missing/offline assets still allow gameplay with fallback visuals.

### Performance review and final merge gate checklist

- Verify retained-mode sync avoids recreating unchanged board, card, and drop-zone objects.
- Verify pointer move during drag does not allocate display objects or run unbounded legality/layout work.
- Verify high/balanced/low quality profiles bound DPR, particles, ambience, shadows, filters, and tween counts appropriately.
- Verify reduced-motion and hidden-tab states reduce animation work.
- Verify repeated theme switches and game resets do not accumulate textures, listeners, or retained views.
- Verify desktop and mobile smoke results satisfy the documented acceptance targets.

### Required verification report

The subagent report must include:

- Verified areas and files reviewed.
- Defects with file and line references.
- Performance risks and measured or observed evidence.
- Accessibility risks and affected flows.
- Required pre-merge fixes, clearly separated from optional follow-up work.
- Validation commands reviewed and whether they passed.
- A final blocker/non-blocker recommendation.

## Final merge gate

Do not merge the implementation until all of the following are true:

- `npm run lint`, `npm run test`, `npm run build`, and CodeQL pass.
- Independent subagent verification reports no blockers.
- Required subagent defects are fixed and re-verified.
- No regressions are present in DOM renderer flows, P2P flows, recordings/replay, import/export, renderer selection, or GitHub Pages base-path asset loading.
- Manual confirmation covers retained board/card/drop-zone objects, drag responsiveness, invalid-drop recovery, resize behavior, fallback assets, offline behavior, reduced-motion, and high/balanced/low quality limits.
- Documentation is updated for any new durable renderer rules, settings, assets, or validation expectations.
- The PR description includes any approved follow-up work and ends with the validation block required by `docs/agent/pr-workflow.md`: `Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔`.
