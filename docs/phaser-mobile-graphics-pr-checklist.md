# Phaser Mobile Graphics PR Checklist

PR title: Improve Phaser mobile graphics quality, touch ergonomics, and renderer efficiency

## Goal

Ship a focused Phaser-renderer improvement pass for mobile devices that:

- improves visual sharpness on high-DPI phones
- gives more screen space to cards and controls in portrait layouts
- reduces avoidable texture, CPU, and GC cost on mobile
- preserves existing gameplay behavior, fallback chains, and Phaser renderer invariants

## Scope

- In scope: Phaser renderer quality settings, layout, touch ergonomics, art-loading strategy, cached primitives, and mobile-friendly effects
- Out of scope: game rules, AI behavior, DOM renderer feature parity changes unrelated to safe-area comparison, broad visual redesign outside the Phaser mobile path

## Implementation Checklist

- [ ] Add a capped device-pixel-ratio policy for Phaser boot.
  Acceptance criteria:
  - Phaser no longer relies on default resolution behavior on mobile.
  - Phone-class `devicePixelRatio` values are capped explicitly.
  - Orientation changes preserve the intended quality policy.
  Files:
  - [src/renderers/phaser/index.ts](../src/renderers/phaser/index.ts)

- [ ] Add safe-area-aware layout inputs for Phaser scenes.
  Acceptance criteria:
  - Header controls and bottom hand/action areas reserve notch and gesture-bar space.
  - Non-safe-area browsers keep current behavior.
  Files:
  - [src/renderers/phaser/index.ts](../src/renderers/phaser/index.ts)
  - [src/renderers/phaser/layout.ts](../src/renderers/phaser/layout.ts)
  - [src/style.css](../src/style.css) as the reference for expected safe-area behavior parity

- [ ] Rebalance collapsed portrait layout toward gameplay surfaces.
  Acceptance criteria:
  - Narrow portrait viewports allocate more height to cards and action controls.
  - Replay-log height and decorative spacing are reduced where needed.
  - Existing header/log separation invariants remain intact.
  Files:
  - [src/renderers/phaser/layout.ts](../src/renderers/phaser/layout.ts)

- [ ] Raise minimum touch-target sizes for mobile controls.
  Acceptance criteria:
  - Primary buttons and menu actions remain usable on narrow portrait screens.
  - Touch interaction does not depend on hover-only affordances.
  Files:
  - [src/renderers/phaser/layout.ts](../src/renderers/phaser/layout.ts)
  - [src/renderers/phaser/button.ts](../src/renderers/phaser/button.ts)

- [ ] Increase mobile card readability.
  Acceptance criteria:
  - Hand and battlefield cards do not shrink below a practical readability floor in collapsed layouts.
  - Card labels remain legible on small screens.
  Files:
  - [src/renderers/phaser/layout.ts](../src/renderers/phaser/layout.ts)
  - [src/renderers/phaser/index.ts](../src/renderers/phaser/index.ts)

- [ ] Restrict card-art preload to the active style and required fallbacks.
  Acceptance criteria:
  - Scene preload does not eagerly load every art style.
  - The selected style still renders correctly.
  - Fallback art remains functional for missing primary textures.
  Files:
  - [src/renderers/phaser/index.ts](../src/renderers/phaser/index.ts)
  - [public/cards/README.md](../public/cards/README.md)

- [ ] Add deferred prefetch for non-active styles only if needed for perceived responsiveness.
  Acceptance criteria:
  - First render favors startup cost and memory use.
  - Switching styles later stays acceptably responsive.
  Files:
  - [src/renderers/phaser/index.ts](../src/renderers/phaser/index.ts)

- [ ] Cache repeated Phaser primitives instead of recreating them on each render.
  Acceptance criteria:
  - Frequently reused panels, frames, card backs, or equivalent surfaces are converted to reusable cached textures or shared primitives.
  - Visual output remains equivalent.
  Files:
  - [src/renderers/phaser/index.ts](../src/renderers/phaser/index.ts)
  - [src/renderers/phaser/visual-primitives.ts](../src/renderers/phaser/visual-primitives.ts)

- [ ] Reduce procedural icon render churn.
  Acceptance criteria:
  - Land icon generation is reused by land, style, and size bucket.
  - Scene rebuilds no longer redraw identical icon geometry unnecessarily.
  Files:
  - [src/renderers/phaser/index.ts](../src/renderers/phaser/index.ts)

- [x] Add a lower-cost mobile effects tier.
  Acceptance criteria:
  - Narrow or mobile layouts use reduced overdraw or lower visual density.
  - Queue ordering and disabled-animation semantics remain unchanged.
  Files:
  - [src/renderers/phaser/effects.ts](../src/renderers/phaser/effects.ts)

- [ ] Improve raster-art presentation on smaller cards.
  Acceptance criteria:
  - Cover-fit raster art remains sharp under mobile sizing.
  - Text overlays remain legible over painted art.
  Files:
  - [src/renderers/phaser/index.ts](../src/renderers/phaser/index.ts)
  - [src/renderers/phaser/visual-primitives.ts](../src/renderers/phaser/visual-primitives.ts)

- [ ] Update renderer guidance with the new mobile rules.
  Acceptance criteria:
  - Docs capture the chosen DPR cap, safe-area behavior, preload strategy, caching expectations, and mobile effect constraints.
  Files:
  - [docs/agent/phaser-renderer.md](agent/phaser-renderer.md)

## Test Checklist

- [ ] Extend [src/test/phaser-layout.test.ts](../src/test/phaser-layout.test.ts) for safe-area-aware layout behavior.
  Acceptance criteria:
  - Tests cover top and bottom inset handling without regressing existing portrait invariants.

- [ ] Extend [src/test/phaser-layout.test.ts](../src/test/phaser-layout.test.ts) for larger mobile touch targets and improved card-area allocation.
  Acceptance criteria:
  - Narrow portrait cases assert the new minimum button and card sizing expectations.

- [ ] Add focused tests for renderer quality policy.
  Acceptance criteria:
  - Extracted DPR logic is covered for common phone DPR values and orientation changes.
  Files:
  - new focused test under [src/test](../src/test)

- [ ] Extend [src/test/phaser-card-rendering.test.ts](../src/test/phaser-card-rendering.test.ts) for active-style-only preload behavior.
  Acceptance criteria:
  - Tests verify the selected style is loaded.
  - Required fallback textures remain available.
  - Non-active styles are excluded from the eager preload path.

- [ ] Extend [src/test/phaser-effects.test.ts](../src/test/phaser-effects.test.ts) for the mobile effects tier.
  Acceptance criteria:
  - Reduced-cost visuals do not alter queue draining, off-mode behavior, or sequential execution semantics.

- [ ] Keep structural Phaser regressions green.
  Acceptance criteria:
  - [src/test/phaser-depth.test.ts](../src/test/phaser-depth.test.ts) passes.
  - [src/test/phaser-menu-overlay.test.ts](../src/test/phaser-menu-overlay.test.ts) passes.
  - Existing layout, log, and rendering tests continue to pass.

## Suggested Commit Slices

1. Renderer quality policy and tests
2. Safe-area plumbing plus portrait layout rebalance
3. Touch-target and card-readability adjustments
4. Art preload optimization and tests
5. Primitive and icon caching
6. Mobile effects tier
7. Docs update and final validation

## Validation

Run in order:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `codeql_checker`

PR description should end with:

```text
Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔
```