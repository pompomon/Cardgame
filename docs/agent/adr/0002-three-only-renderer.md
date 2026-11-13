# ADR 0002: Three.js-only browser renderer

Status: Accepted, 2026-09-16; supersedes the browser-renderer parts of
[ADR 0001](0001-layering.md).

## Context

Separate DOM, Phaser and Three.js renderers needed parity work for every
shared feature, while Three.js already had its own native HTML lobby, menus,
settings, P2P and recording controls and accessibility surface.

## Decision

- Three.js is the sole browser renderer and WebGL2 a runtime requirement. Its
  native HTML interface in `src/renderers/three/` is part of it, not a second
  backend. Phaser, the DOM renderer and renderer selectors are removed
  (`src/test/browser-renderer-architecture.test.ts`).
- No renderer choice is stored or projected. At startup `main.ts` calls
  `src/app/renderer-migration.ts` to drop every `renderer` query parameter,
  keeping other parameters and the hash, and the obsolete `cardgame-renderer`
  storage key (best-effort), then loads Three.js.
- Graphics failures never switch renderers
  ([Explicit WebGL2 failure](../../../AGENTS.md#explicit-webgl2-failure)); a
  failed module fetch needs a reload because browsers remember failed dynamic
  imports by URL.

## Consequences

- One implementation owns behavior, accessibility and visuals; bundles ship
  no Phaser.
- Browsers without WebGL2 cannot play, and context loss needs a Three.js
  retry: there is no non-WebGL gameplay mode.
- A first offline load can fail if the lazy Three.js chunk was never cached.
- Legacy renderer URLs still load. Game, Adventure, recording and settings
  formats are unchanged.
