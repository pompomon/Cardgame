# Phaser renderer

Phaser 4 specific pitfalls observed in review. The renderer lives in
`src/renderers/phaser/`.

## Scene depth contract

The cardgame scene anchors render order on constants and a z-order map in
`src/renderers/phaser/depth.ts`:

- `DEPTH_REPLAY_LOG = -10` — replay log
- `DEPTH_REPLAY_LOG_HEADING = -9` — replay log heading
- `DEPTH_BOARD = -5` — player-info panels
- default `0` — cards, buttons, battlefields
- `DEPTH_HEADER_STRIP = 9` — header strip
- `DEPTH_HEADER = 10` — Menu button, Turn/Phase label, Winner banner
- `DEPTH_MENU_OVERLAY = 20` — in-game menu overlay
- `DEPTH_TARGET_PICKER_OVERLAY = 30` — target picker overlay

Rule: any new GameObject that needs to occlude the log/panel layer must
call `setDepth` explicitly. Default-depth objects (e.g. battlefield
rectangles, hand cards) sit above the panel but below the header — if you
need a different layering relationship, set the depth.

If you change the depth constants, update `depth.ts`, this guide, and the
depth regression tests so they reflect what is actually enforced (don't
claim "battlefields sit above the log" unless those GameObjects actually
render at default depth (`DEPTH_GAMEPLAY`, 0)).

## Clipping: masks vs culling

Phaser 4 ships only `GeometryMask`, and its `phaser.d.ts` explicitly says
it is supported only in the Canvas renderer. Under WebGL it silently
no-ops. **Do not rely on masks to clip a scrollable viewport in this
project.**

Options:

- **Static art that needs cover-fit cropping:** use `setCrop` on the
  Image (see `addCardArtToContainer` `{ fit: 'cover', … }`).
- **Scrollable list:** manual viewport culling. For the menu-overlay
  replay log, cull to **fully-contained** rows (strict) because partial
  rows would render outside the panel without masking. The in-scene log
  uses overlap-based culling.

## Coordinate-space discipline

Layout helpers (`log-scroll.ts`, `layout.ts`) operate in the **parent
container's coordinate space**, not "world" space. Document parameters
and JSDoc accordingly; mislabeling these as "world Y" has caused
confusion when the same helper is reused under a different container with
non-zero offsets. The `bottomPadding` parameter in
`computeLogScrollLayout` is **added** to effective content height
(increasing `maxScroll`); document it that way — not as "subtracted from
the bottom of the visible strip".

## Performance pitfalls

- **Don't create N small `Rectangle` GameObjects per pixel-art tile.** Use
  one `Graphics`/Texture per (land, style, size bucket) and reuse. The
  scene rebuilds on every render — per-pixel GameObjects multiply hand +
  battlefield + picker counts and cause GC churn.
- **Always bucket sizes and use the bucketed value for both rect
  generation and positioning.** `landPixelRects` already buckets internally
  (even values). If callers pass `Math.floor(...)` (potentially odd), the
  rects come back at a different effective size than the offsets you
  computed, leaving the icon off-center.
- **Anchor effects to the right battlefield row.** `computeEffectAnchor`
  must use `layout.nonActiveBattlefieldHeight` when `useNonActive` is true.
- **Cap the visual log and the a11y mirror.** Both iterate the full event
  array; long recordings or hostile imports can balloon both. Render the
  last N tiles + an "older entries omitted" row, and apply the same cap to
  the a11y string.

## Listener hygiene

- `scene.load.once(FILE_LOAD_ERROR, …)` detaches only if an error fires.
  Across repeated scene start/stop cycles with successful loads, listeners
  accumulate. Guard with a scene-level flag or detach on `LOAD_COMPLETE`
  too.
- Cleanup containers (e.g. `effectsLayer`) deterministically. If you
  destroy/recreate a layer per render, add effect GameObjects to that
  layer so cleanup is meaningful. Otherwise drop the layer.

## Effect queue (`effects.ts`)

- **Read options via a thunk on every drain.** `pumpEffectQueue` takes a
  `getOptions: () => PumpEffectQueueOptions` and re-invokes it on each
  recursion. Capturing `options` at queue start means mid-queue
  `animationSpeed`/`durationMs` changes don't take effect until the queue
  drains.
- **`clearEffectQueue` drops pending entries but leaves the in-flight
  tween to complete on its own.** The running effect's `done` callback
  (set up by `pumpEffectQueue` / `playAbilityEffect`) flips
  `state.playing` back to `false`. Don't reset `playing` here — doing so
  would let a follow-up `pumpEffectQueue` start a new effect concurrently
  with the still-running tween and double up rings on screen.

## Log rendering rules

- **Color actor pills by active actor index** (`tile.actor === game.actor`)
  — not by fixed player index `0`. Otherwise active/non-active colors
  flip when P1 isn't active.
- **Multi-line labels must not overflow the previous row.** Either
  top-align the label inside the row (`setOrigin(0, 0)` and
  `y = tilePadding`), or measure row height first and center both icon
  and label within the measured row.
- **Reuse `computeLogScrollLayout` for both the in-scene and the
  menu-overlay log** so clamp + pin-to-bottom semantics stay identical.
- **Reuse the shared `clamp` from `layout.ts`** rather than redeclaring a
  local one in `log-scroll.ts`.

## Lobby fallbacks

- **Never hardcode `'classic'` as the default card visual style.** Import
  and use `DEFAULT_CARD_VISUAL_STYLE` from `src/app/card-visual-styles`.
  The same rule applies to any other default that has a named export.
- **Optional-chain `view?.adventure.status`** in `LobbyScene.renderView()`
  before the first controller render — `LobbyScene.create()` may call
  `renderView(this.rendererRef.currentView)` before
  `renderer.render(...)` has been called.
- **A11y submenu predicates must mirror the visible-button predicates.**
  If a visible adventure quick action is gated on `adventure.status`, the
  a11y root submenu entries must use the same condition.
