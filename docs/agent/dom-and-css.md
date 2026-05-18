# DOM and CSS

DOM renderer lives in `src/renderers/dom.ts`; styles in `src/style.css`.

## HTML invariants

- **Unique element `id`s.** If the same logical button (e.g.
  `abandon-adventure`) appears both in the lobby and in the in-game menu,
  use a `class` or `data-action` attribute and bind the handler off that.
  Duplicate `id`s are invalid HTML and break querySelector, labels, and
  a11y tooling.
- **Consolidate imports** from the same module. Don't ship two import
  statements (`import { X } …` + `import type { Y } …`) for the same path
  — merge them.
- **Strip whitespace from `display:flex` row templates.** When
  `renderCardTile(...)` returns a template literal with leading/trailing
  newlines and indentation, that whitespace becomes anonymous flex items
  inside `.card-tile-row` and shows up as unexpected spacing/wrapping
  beyond the intended `gap`. Trim or build markup without the surrounding
  whitespace.

## Per-render rebuild caveat

The DOM renderer rebuilds its HTML on every render. That has two
consequences:

- **`onerror` mutations on `<img>` are lost on the next render.** A bare
  `src` swap will fail again next frame. Track failed raster URLs in
  module state (`src/renderers/dom.ts` already does this — extend the
  pattern for new raster paths) and skip the bad URL on subsequent
  renders.
- **Strip raster classes immediately on error.** When the `onerror`
  fallback fires, remove `card-tile-icon--raster` from the `<img>` and
  `card-tile--raster` from the parent tile in the same handler so the
  immediate procedural fallback isn't styled as raster. Tests in
  `src/test/dom-card-rendering.test.ts` cover this.

## CSS pitfalls

- **Declaration order wins for repeated properties.** For two
  `image-rendering` declarations (`pixelated` vs `crisp-edges`), the
  **last** wins in browsers that support both. Put the preferred value
  (`pixelated`) last; treat the other as a fallback above it.
- **Selector specificity ordering.** A later, equally-specific base rule
  (`.card-tile-icon`) will override an earlier raster override
  (`.card-tile-icon--raster`). Place override selectors **after** the base
  rule, or raise specificity.
- **`@supports (padding: max(0px))` is invalid.** `max()` requires at
  least two arguments, so this feature query never matches. Use either a
  check that an `env()` value resolves
  (`@supports (top: env(safe-area-inset-top))`) or a valid
  `max(0px, 1px)` expression.
- **Provide plain-value fallbacks before `env(safe-area-*)`.** On browsers
  without `env()` support the property becomes invalid; declare a
  plain-value version first (`top: 18px; …`) and the `env()` override
  after, so non-supporting browsers keep the previous behavior. Make sure
  later mobile media-query overrides don't undo safe-area insets.

## Re-render orchestration

- Prefer a **single subscriber-driven render path**. `install-support`
  already calls `notifyChange()`, and `main.ts` subscribes via
  `subscribeInstallSupport()` to re-render. Manual `.finally(render)`
  calls in click handlers duplicate the render and waste work.

## Form input validation

- Validate `<select>` values before assigning to typed setters. Don't
  cast `select.value as AiLevel` — pass through `isAiLevel(value)` first
  and ignore/default invalid values. Same pattern for any other
  type-narrowed setter (`isCardVisualStyle`, `isAnimationSpeed`, …).
