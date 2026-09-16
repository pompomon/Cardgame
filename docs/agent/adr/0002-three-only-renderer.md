# ADR 0002: Three.js-only browser renderer

- Status: Accepted
- Date: 2026-09-16
- Supersedes: Browser renderer portions of ADR 0001
- Superseded by: —

## Context

The browser application maintained separate DOM, Phaser, and Three.js renderers.
Every shared feature required parity work, while Three.js had already become a
hybrid renderer with its own native HTML lobby, menus, settings, P2P controls,
recording controls, keyboard actions, and accessibility surface.

## Decision

Three.js is the sole browser renderer. WebGL2 is a runtime requirement for
gameplay. The native HTML interface under `src/renderers/three/` remains part of
that renderer and is not a second rendering backend.

The application no longer stores or projects a renderer choice. At startup it:

1. Removes every obsolete `renderer` query parameter while preserving other
   parameters and the URL hash.
2. Removes the obsolete `cardgame-renderer` localStorage key best-effort.
3. Loads Three.js.

`RendererHost` retains the controller and latest view across Three.js load,
initialization, render, and context-loss failures. It shows an accessible
retry/reload screen rather than switching to a reduced renderer. An in-page
retry remounts Three.js against the preserved controller state.

Phaser code, the standalone DOM renderer, renderer selectors, Phaser-only
sprites, related active guidance, and the Phaser production dependency are
removed. Generic helpers required by Three.js live in `app/`,
`renderers/shared/`, or `renderers/three/` according to their ownership.

## Consequences

### Positive

- One browser implementation owns behavior, accessibility, and visuals.
- Shared features no longer require cross-renderer parity maintenance.
- Browser bundles and public assets no longer include Phaser.
- Graphics failure behavior is explicit and cannot silently change UI semantics.

### Negative

- Browsers without WebGL2 cannot play the browser version.
- A first-time offline load may fail if the lazy Three.js chunk was never cached.
- Context loss requires retrying Three.js; there is no non-WebGL gameplay mode.

## Compatibility

Legacy renderer URLs continue to load the application after one-way URL
normalization. Other search parameters and hashes remain intact. The obsolete
stored preference is discarded because it no longer has a meaningful value.
Existing game, Adventure, recording, visual-style, board-theme, animation, and
quality persistence formats are unchanged.
