---
applyTo: "src/renderers/**,src/style.css"
---

# Renderer and native interface

Details: [three-renderer](../../docs/agent/three-renderer.md) and
[three-interface](../../docs/agent/three-interface.md).

- Element `id`s are unique. A button shown in both the lobby and the in-game
  menu uses `class`/`data-action` (the `abandon-adventure` pattern).
- A raster `onerror` records the failed URL in module state, so the next
  render skips it, and strips the raster classes as it swaps in non-raster
  art.
- CSS order matters: `image-rendering: pixelated` goes after `crisp-edges`
  when preferred; override selectors follow the equally specific base rule.
- Give every `env(safe-area-inset-*)` a plain-value fallback first.
  `@supports (padding: max(0px))` is invalid: `max()` needs two arguments.
- Every new kind of Adventure hub decision must change
  `adventure.decisionKey` (`src/app/view-model.ts`), so
  `ThreeInterface.latestForAction` drops clicks on stale buttons.
- Touch-shell hand paging follows the selected card across profile and
  page-size changes. Without one it keeps the old page's first card, but
  leaving `desktop` restarts at page 0; a new actor or presentation always
  does (`board.ts`).
- Layout is a pure projection: every touch shell lays out with
  `narrowBoardLayout()`, and board CSS keys on `[data-shell]`, not
  `max-width: 480px` queries. During a drag change only colour, outline and
  opacity, and keep prompts and captions as stage overlays, so measured
  headers never resize mid-gesture.
- Whatever allocates a GPU resource, listener, observer or frame owns its
  cleanup, which must be safe after partial construction and when repeated.
