# Phaser renderer

Phaser 4 specific pitfalls observed in review. The renderer lives in
`src/renderers/phaser/`.

## Module layout

`index.ts` is a thin composition root (`PhaserRenderer`: mount/render/unmount)
that wires together `lobby-scene.ts` and `cardgame-scene.ts` plus the DOM
overlays Phaser can't host itself (`p2p-overlay.ts`, `a11y-navigation.ts`,
`recording-file-actions.ts`). `cardgame-scene.ts` owns scene lifecycle/input
wiring and composes the extracted subsystems: `gameplay-presenter.ts`
sequences the board render pass across `game-header.ts`, `player-info.ts`,
`battlefield-view.ts`, and `hand-controls.ts`; `menu-overlay.ts` hosts the
Replay Log panel/scroll state and delegates tile content (cap/legacy-
fallback/empty rules) to the pure, unit-tested `log-tiles.ts`; target
selection splits into `battlefield-targets.ts` (pure pending-selection state
and the a11y label derivation, unit-tested without Phaser) and
`target-picker.ts` (the modal popup UI); and `effect-controller.ts` owns the
effect queue + card position registries. Card art loading (`card-art-loader.ts`)
is separate from the card GameObject factory (`card-factory.ts`) that assumes
textures are already loaded. Lobby row/action content and predicates
(`isAdventureResumable`, `selectedAiLevelLabel`, …) live in the pure, tested
`lobby-actions.ts`, consumed by both `lobby-scene.ts` and
`a11y-navigation.ts` so the two surfaces can't drift apart. Shared low-level
pieces live in `theme.ts` (colors/CardStyle), `scene-config.ts` (numeric
constants/scene keys), and `scene-host.ts` (Phaser.Game bootstrap). See
`docs/agent/architecture.md` for the full module map, and
`src/test/phaser-module-architecture.test.ts` for the guard that asserts
every module above still exists.

Board asset paths and URLs are renderer-neutral in `src/app/board-assets.ts`.
`asset-manifest.ts` maps the selected theme/quality to Phaser texture keys,
and `texture-loader.ts` queues one large background tier at a time. A failed
background advances through the ordered fallback candidates; failed public
URLs are remembered so scene restarts do not retry them. Shared UI, effect,
and per-theme ambience atlases are independent from the large backgrounds so
future retained views can evict a background without discarding shared
sprites. `board-background.ts` owns the retained scene-level background layer:
it cover-crops loaded backgrounds with `setCrop`, uses bounded quality-aware
ambience sprites, and evicts stale large background textures after a theme
switch.

Visible hand and battlefield cards use the retained path in `card-view.ts`,
`card-view-pool.ts`, and `card-view-registry.ts`. The app view model projects
both stable `cardId` and targeting-only `instanceId` values for battlefield
cards. `battlefield-view.ts` and `hand-controls.ts` now emit descriptors;
`GameplayPresenter` reconciles them once per pass. The registry detaches its
stable layer before the remaining gameplay root is rebuilt, then reattaches it
after sync. Pool release destroys every face child and clears data, listeners,
input, drag state, alpha, depth, scale, rotation, and active tweens before an
outer container can be reused. Static cards outside the board (previews,
effect retention, log tiles, and target choices) continue to use
`card-factory.ts`.

Because `lobby-scene.ts` and `cardgame-scene.ts` must never import the
composition root (that would create a cycle), they depend on the structural
`PhaserRendererHost` interface in `renderer-host.ts` instead of the concrete
`PhaserRenderer` class.

## Scene depth contract

The cardgame scene anchors render order on constants and a z-order map in
`src/renderers/phaser/depth.ts`:

- `DEPTH_BACKGROUND = -10` — retained full-scene board background
- `DEPTH_BOARD = -5` — player-info panels
- default `0` — cards, buttons, battlefields
- `DEPTH_HEADER_STRIP = 9` — header strip
- `DEPTH_HEADER = 10` — Menu button, Turn/Phase label, Winner banner
- `DEPTH_CARD_PREVIEW_OVERLAY = 15` — enlarged card preview
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
- **Scrollable list:** manual viewport culling through
  `cullRowsToViewport` in `src/renderers/phaser/log-row-visibility.ts`.
  Use `mode: 'contained'` when partial rows would render outside a panel
  without masking (the menu replay-log viewport **and** the target-picker
  options list in `target-picker.ts` use this today), and `mode: 'overlap'`
  only where partial rows are acceptable. `target-picker.ts` tags each
  option button with `rowTop`/`rowHeight` data (mirroring the log tiles) and
  re-runs `cullRowsToViewport` both on initial render and after every scroll
  step, so its `GeometryMask` is a Canvas-only convenience, not the thing
  actually keeping scrolled-out buttons from painting over the title/footer.

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

- **Effect semantics are shared.** `src/app/visual-effects.ts` maps structured
  log events to style-aware descriptors consumed by both renderers. Keep event
  selection, actor/target ownership, identifiers, and palette derivation there;
  renderer modules own only drawing and lifecycle.
- **Prefer exact anchors, then fall back safely.** Current battlefield card
  positions resolve newly played/source cards. The bounded per-game position
  history resolves cards removed by an effect, such as a queued Mountain
  target. Legacy recordings without identifiers fall back to the correct actor
  row; clear the history whenever the game seed changes.
- **Keep Mountain targets visible through destruction effects.** Renderers retain
  an inert visual copy at the removed card's last exact position until the
  effect completion callback runs. The retained visual is renderer-owned and
  must also be cleared on queue reset, game changes, unmount, or scene shutdown;
  position history remains only the fallback for anchoring particles.
- **Use the reduced quality tier on phone-sized viewports.** It lowers particle
  counts and overdraw but must not alter queue ordering, duration, completion,
  or disabled-animation semantics.
- **Every recipe completes and cleans up exactly once.** Coordinated trails and
  bursts share a completion counter; every temporary GameObject is destroyed by
  its terminal tween.
- **Read options via a thunk on every drain.** `pumpEffectQueue` takes a
  `getOptions: () => PumpEffectQueueOptions` and re-invokes it on each
  recursion. Capturing `options` at queue start means mid-queue
  `animationSpeed`/`durationMs` changes don't take effect until the queue
  drains.
- **Keep board orientation stable until the queue drains.** Both renderers use
  `BoardPresentationCoordinator` to retain the displayed active actor while
  effects are queued or playing. State and effect descriptors continue to
  advance, but the active/non-active rows, hand, anchors, and accessibility
  view use the presented actor. The final queue completion applies the latest
  pending actor and triggers one render; changes with no visual effect switch
  immediately.
- **Reset presentation and queue state together.** New games, replay rewinds,
  lobby transitions, unmount, and scene shutdown must clear any pending actor
  so an old completion callback cannot switch the next board. Turning
  animations off applies the latest actor immediately.
- **`clearEffectQueue` drops pending entries but leaves the in-flight
  tween to complete on its own.** The running effect's `done` callback
  (set up by `pumpEffectQueue` / `playAbilityEffect`) flips
  `state.playing` back to `false`. Don't reset `playing` here — doing so
  would let a follow-up `pumpEffectQueue` start a new effect concurrently
  with the still-running tween and double up rings on screen.

The DOM renderer uses the same descriptor source and a separately bounded FIFO
queue. It prefers exact `data-battlefield-card-id` / `data-card-id` anchors,
falls back to actor rows, derives CSS variables from the selected card style,
and removes active overlays on unmount or game changes.

## Log rendering rules

- **Color actor pills by active actor index** (`tile.actor === game.actor`)
  — not by fixed player index `0`. Otherwise active/non-active colors
  flip when P1 isn't active.
- **Multi-line labels must not overflow the previous row.** Either
  top-align the label inside the row (`setOrigin(0, 0)` and
  `y = tilePadding`), or measure row height first and center both icon
  and label within the measured row.
- **Use `computeLogScrollLayout` for the menu-overlay log** so clamp +
  pin-to-bottom semantics remain unit-tested.
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
