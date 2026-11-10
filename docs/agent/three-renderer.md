# Three.js renderer

The sole browser renderer lives in `src/renderers/three/`. It combines a WebGL2
Board with a native HTML lobby, HUD, menus, dialogs, P2P controls,
recording controls, card lists, and accessibility actions.

Code and contributor documentation may use `battlefield` for the stable
`GameState` field, renderer row geometry, hit-test zone, or DOM data value. That
is an internal compatibility term; every player-facing label for the zone is
**Board**.

## Composition and host lifecycle

`RendererHost` is the asynchronous boundary:

1. Buffer the newest `AppViewModel`.
2. Dynamically import `ThreeRenderer`.
3. Mount exactly one renderer.
4. Reject stale loader completions using the generation counter.
5. Re-render the buffered view.

`ThreeRenderer.mount()` constructs `ThreeBoard`, `ThreeInterface`,
`ThreeInteraction`, and `ThreeEffects`. If any constructor fails, it unmounts
everything already created before rethrowing. `unmount()` is idempotent and
removes global listeners before disposing interaction, effects, interface, and
board resources.

Do not create a second gameplay renderer as a fallback. WebGL2 load,
initialization, render, and context-loss errors report to `RendererHost`. The
host unmounts partial resources, preserves the controller and latest view, and
shows a focused `role="alert"` recovery panel. Initialization, render, and
context-loss failures offer in-page retry and reload. A failed dynamic module
load offers reload only because browsers cache failed imports by URL; repeating
the same import would not fetch it again. Failure messages must not overwrite
gameplay status.

## Resource ownership

Every object that allocates a listener, observer, animation frame, texture,
material, geometry, or retained presentation owns its cleanup.

- `ThreeBoard` owns the WebGL renderer, canvas, scene/camera, observers,
  animation frame, surfaces, shared primitives, card registry, background, and
  asset cache.
- `ThreeCardRegistry` owns shared card geometry and all registered active or
  retired cards.
- `createPresentation()` shares registry geometry but deliberately bypasses
  picking/history. Its caller must dispose the presentation before the registry.
- `ThreeBackground` owns board mesh, ambience particles, and their materials.
- `ThreeEffectVisual` owns all temporary effect meshes and copied counter cards.
- `ThreeInteraction` owns pointer listeners and active pointer capture.

Keep cleanup safe after partial construction and safe to call more than once.
Cancel work before disposing the resources it may reference.

## Rendering and invalidation

The board draws on invalidation rather than running an unconditional permanent
loop. Asset completion, layout, input, active effects, returning drags, card
animation, and ambience animation can request the next frame. Hidden or
non-gameplay stages stop drawing.

Separate CSS-space interaction from drawing-buffer quality:

- Picking uses the canvas CSS bounding rectangle.
- Layout uses measured CSS dimensions.
- Renderer pixel ratio controls GPU resolution only.

On a resize or presented-page change:

1. Cancel input that can no longer be interpreted safely.
2. Reconcile the card registry and visible layout.
3. Invalidate historical card anchors when slots changed.
4. Reanchor active effects to current source and target geometry.

Never use `structuredClone(GameState)` in render or AI hot paths.

## Interaction

`ThreeBoard` captures visual intent; `ThreeInterface` owns submission state.
Primary actions originating from an internal `battlefield` hit must route through
`ThreeInterface.activatePrimaryAction()` so current blocking state, decision
keys, and legality are revalidated immediately before submission.

Pointer interaction must:

- Track one gesture at a time by pointer identity and type. When idle, a touch
  or pen `pointerdown` may start a gesture even if it is not the primary
  pointer. A new pointer replaces a press or an open peek and releases the old
  pointer's capture. While a card is dragging, every other pointer is ignored,
  including its cancellation and capture loss.
- Use capture for drags that leave the canvas.
- Reject stale hits after view/session changes.
- Cancel on visibility, layout, overlay, and lifecycle boundaries.
- Keep click activation and drag/drop from firing for the same gesture.

Controller submissions can notify subscribers synchronously and can reject.
Never let cleanup for an older submission erase a newer decision. Preserve a
still-legal retry selection after rejection; see
[reentrant UI submissions](state-and-persistence.md#reentrant-ui-submissions).

### Long-press peek

`DragStateMachine` (`src/renderers/shared/drag-state.ts`) has a `peeking`
phase for touch and pen. The press must stay within the 12 px drag threshold.
The ring appears at `PEEK_RING_DELAY_MS` (150 ms), and the peek opens at
`PEEK_HOLD_MS` (450 ms). Both need `ThreeInterface.canPeek()`, which uses the
same projection and gates as Details, so a peek reveals nothing a preview
would hide. Eligible Interception cards qualify, unlike hover.

`peekPlacement()` in `layout.ts` places the peek in client pixels, on the half
of the stage away from the finger, and never over the held card. The panel
cannot scroll, so a peek opens only on a side where all of it fits:

- Pointerdown checks only the geometry, so a tap never measures the DOM.
- When the ring is due, and again when the peek opens, the interaction passes
  a `fits` check through `ThreeBoardApi.peekPlacement()`. The tile shrinks
  with the room, so each side is measured on its own.
- `ThreeInterface.peekFits()` renders a probe of the peek into the hover
  overlay, compares its `scrollHeight` with its `clientHeight`, and removes it
  in the same task, so the probe never paints.
- If the preferred side would clip the peek, the other side is tried. With no
  preview, or no side where the whole peek fits, no ring shows and a held
  press stays a tap.

- Releasing a peek closes it without a tap, so it never selects, previews,
  intercepts, or submits.
- Moving past the threshold closes the peek first and, for a summonable hand
  card, starts a drag.
- The peek closes on `pointercancel`, capture loss, blur, Escape, a hidden
  document, a decision change, a refused preview, relayout, an opened menu,
  and disposal. Every path clears both timers.
- The peek reuses the hover overlay and is `aria-hidden`. The dock prompt
  announces it in every touch shell, and Details stays the keyboard and
  screen-reader path.
- `setPeek()` only re-renders the interface and never calls `onChange`. The
  peek is not part of `isBlocked()`.

### Second-finger guard

While a card follows one pointer, the `dragActive` option of `ThreeInterface`
makes the native click dispatcher (`handleClick`) inert. `ThreeBoard`'s
`activatePrimary` ignores the primary button, and `changeHandPage` ignores the
hand page buttons. A second finger therefore cannot press a dock button,
Summon, End Turn, or turn the hand page mid-drag.

Never fold this guard into `isBlocked()` or `nativeActionBlocked()`.
`playCard` checks `nativeActionBlocked()`, so the guard would refuse the drop
itself.

Chromium cancels a tap when another pointer goes down, so a button pressed
during a drag and released after the drop should not click. Verify this on a
device.

### Context menu

The board canvas prevents `contextmenu` for touch and pen. Some browsers
report a long-press menu as `mouse` or with no pointer type, so a menu that
follows a touch or pen press is also prevented. A real right-click presses
the mouse first, so it keeps its menu. During a game the board stage also sets
`-webkit-touch-callout: none` and `user-select: none`.

### Edge auto-scroll

During a touch or pen drag, a scrollable stage scrolls when the finger is near
its visible top or bottom.

- **Band.** `AUTO_SCROLL_EDGE_PX` (48 px), or half the stage when it is short.
- **Speed.** Up to `AUTO_SCROLL_MAX_SPEED` (600 px/s), scaled by how deep the
  finger is in the band (`autoScrollVelocity()` in `layout.ts`).
- **Steps.** `requestAnimationFrame` drives the steps. The first assumes
  16 ms, and later steps are clamped to 64 ms. Fractions carry, so slow speeds
  still move. After each step the board pins the pill and reruns `moveDrag`
  with the last pointer. A step reuses the drag's measured geometry (see
  [Drag geometry](#drag-geometry)).
- **Stops.** The loop stops when the finger leaves the band, at either scroll
  end, and on release, cancellation, relayout, and disposal. A late frame does
  nothing. The mouse never auto-scrolls.

### Drag geometry

A live drag measures its geometry once and keeps it until something may move
the stage. Its first move measures the canvas's client box, the stage's
visible box, and the stage's scroll range (`DragGeometry` in `board.ts`).
Later moves, edge auto-scroll steps, and the release reuse them:

- **Scroll offset.** The stage scrolls only vertically, so the drag tracks its
  `scrollTop` and moves the measured canvas box by the difference. An
  auto-scroll step tracks the offset it wrote instead of reading it back. Each
  stage `scroll` event reads `scrollTop` once. When the offset differs from
  the tracked one, as after a wheel or a browser-rounded write, the board pins
  the pill and re-places the card; the step's own event changes nothing.
- **Invalidation.** A render, or a relayout that keeps the drag, discards the
  geometry, and the next move measures again. A scroll of the page or of an
  ancestor of the stage reaches a capturing, passive window `scroll` listener,
  which measures again at once and re-places the card; other scrollers are
  ignored. A measurement that finds an untracked offset also pins the pill.
  Drag feedback re-renders only the fixed-size dock prompt, so it keeps the
  geometry.
- **Release.** `containsDrop` uses the geometry behind the highlight, so a
  release at the last move's point does what the highlight shows, even before
  a pending scroll event arrives. A render or relayout that keeps the drag
  leaves the highlight until the next move or scroll; a release in between,
  or without a live drag, measures afresh.

New drag behaviour must not read layout per move or per frame, and anything
that can move the stage without resizing it must discard the geometry.

### Relayout

On relayout the board anchors the stage scroll to the near lane, so the lane
stays in view. The short rail also keeps the whole hand below it in view, so a
drag starts and lands without scrolling. When they cannot all fit, the near
header leaves the view first, then the top of the near lane.

Viewport and observer callbacks interrupt gestures only when something really
changed. A new layout ends the drag, cancels the interaction (closing a peek or
long press), re-presents the board and re-anchors the near lane. A touch-shell
board held at its 356 px minimum keeps its layout while the stage around it
shrinks or grows. `relayout` therefore also compares the stage's client box with the one
from the last relayout. When only that box changed, it ends the drag, cancels the
interaction and re-anchors the near lane, without re-presenting. A callback with
neither change keeps a live gesture and the player's own scroll position.

The touch-shell hand page follows the selected card across shell and page-size
changes, including a shell switch that keeps the page size. It follows the
retained selection even while Details or a menu blocks
input and hides the highlight, so closing them finds the card on the shown
page instead of clearing it as off-page. With no selection, a switch between
touch shells keeps the browsed page, and a page-size change keeps the first
card of the old page in view. Entering or leaving `desktop`, a new acting
player, or a presentation boundary resets the hand to page 0.

## Layout

Treat responsive layout as a pure projection from viewport and measured native
HTML chrome. Reuse `clamp` from `src/renderers/shared/math.ts` and cover fitting
from `src/renderers/shared/image-fit.ts`.

### Touch shells

`ThreeRenderer` classifies the viewport with `threeShellProfile()` on window
`resize` and on `(pointer: coarse)` changes. It re-renders only when the
profile or its short flag changes. A change to the `visualViewport` alone,
such as the on-screen keyboard or a pinch zoom, never reclassifies. Unmount
removes both listeners.

- **Root.** During a game, every touch shell sets `data-shell` (`narrow`,
  `dock`, or `rail`) on `.three-root` and shows the dock. A short rail also
  sets `data-shell-short="true"`. Only `narrow` adds `three-root--narrow`.
  Outside a game the shell is `desktop`.
- **Geometry.** Every touch shell lays out with `narrowBoardLayout(width,
  height, headers, shell)`. `TOUCH_CARD_MAXIMA` caps the type-slot and
  hand-card heights per shell. The cover screen keeps its `narrow` geometry,
  and `dock` and `rail` stop at about 85×117 slots and 115×158 hand cards.
  The stage's `data-layout` names the shell, so `narrow` stays the
  cover-screen key.
- **Pager row.** `narrow` always reserves the 50 px hand pager row. `dock`
  and `rail` reserve it only while the hand has more than one page. Only the
  hand size changes the page count, so the row never moves during a drag.
  The short rail's row is a 44 px strip, and its buttons bleed into the
  header's padding.
- **Viewport.** `compactBoardViewport` uses the layout viewport
  (`window.innerHeight`) instead of the `visualViewport` height.
- **Switching.** Any shell change ends a drag, cancels the interaction, and
  makes the hand page follow the selection, or else keeps the browsed page.
  Entering or leaving `desktop` instead starts on page 0 and moves the
  primary button and the hand pager.
- **Short rail.** A rail on a landscape screen at most 480 px tall, such as
  the cover screen held sideways, passes `short: true` in
  `ThreeBoardPresentation`; other shells ignore it. The board then takes the
  full height beside the rail, a lifted touch card goes beside the finger
  whenever a side fits (`preferSide`), and the near-lane anchor keeps the
  hand in view. A rail turning short or back is a shell switch.
- **CSS.** `[data-shell]` selectors replace the board's `max-width: 480px`
  rules, and every `env(safe-area-inset-*)` value has a plain fallback first.
  `narrow` and `dock` put a fixed, rem-based dock under the board, with room
  for a three-line and a two-line prompt. Its action row reserves End Turn's
  height, so large text never takes those lines; longer prompts scroll.
  `rail` uses `grid-template-columns: minmax(0, 1fr) clamp(180px, 26vw, 240px)`:
  the top bar stays above the board, and the full-height rail stacks the
  prompt, 48 px actions, and the primary button. The target panel and the
  tutorial banner stay clear of the rail. In the short rail the top bar heads
  the rail column instead. Its title and status scroll under the pinned menu
  and Hint buttons, and the actions wrap in rows. When large text outgrows the
  rail, the dock below the top bar scrolls as a whole, End Turn included.

Keep action instructions and effect captions as stage-level overlays rather
than row content. Changing a wrapped prompt during an active drag can trigger
header measurement and invalidate the gesture. Anchor instructions at the near
internal `battlefield` row and place effect captions below the measured instruction
height.

During a live drag the instruction becomes a pill at the top of the visible
stage (`scrollTop` + 4 px), clear of the drop zone, and returns to the near row
when the drag ends. A passive stage `scroll` listener keeps it there when the
board scrolls mid-drag (a wheel, or edge auto-scroll), and re-places the card
and its acceptance from the last pointer; edge auto-scroll does both itself (see
[Drag geometry](#drag-geometry)). Touch and pen lift a smaller card
above the finger, or beside it without room above, and keep its side while it
fits (`dragProxyPlacement()` in `layout.ts`); the short rail prefers a side.
Touch and pen placement reserves the pill's band, measured once at drag
start, so the pill never covers a touch card; a mouse card stays under the
cursor. The pill's text changes only when
acceptance changes, and the end of a drag restores the current idle text,
which may be a response prompt. In every touch shell it is hidden except as
the pill and reserves no caption space. Drag feedback changes only colour,
outline, and opacity, so measured headers keep their size.

`dropAccepts()` in `layout.ts` is the one drop predicate behind both the
highlight (`moveDrag`) and the release (`containsDrop`), which during a drag
also share one geometry. Touch and pen get
`TOUCH_DROP_SLOP_PX` (12 client px) on the top and side edges, never on the
edge facing the hand, and the mouse gets none. A point over the hand, outside
the canvas, or outside the stage's visible box never drops.

`ThreeBoard` owns one `ThreeDragLayer` (`drag-layer.ts`): an `aria-hidden`,
pointer-transparent overlay inside `.three-board-stage`, so it scrolls with the
board. It draws the lifted card above the HTML headers and labels the landing
slot ("Lands here", or "+1" on an occupied touch-shell type slot). A touch card
lifts above the finger, or beside it without room above (and whenever a side
fits on the short rail). When exactly one side fits without covering the
landing slot, a sideways card takes that side. Each drag holds
at most one extra card-face lease for it, released by `endDrag` on every path,
including disposal. Without a 2D context, or when painting fails, the
in-scene proxy stays visible instead. A move changes only CSS transforms.
Artwork that loads mid-drag replaces the fallback face once, on the next board
frame, so the card updates even while the finger is still.
`onDragFeedback` reports drag start, acceptance changes, and the end of a live
drag. It is called last, after the board's state is updated, because the
listener renders the interface synchronously and may end or dispose the board.
Reduced motion and Animations Off skip only the return animation; a live drag
continues.

Use explicit viewport culling for large native lists and avoid per-frame DOM
measurement. Keep touch targets at least 44 CSS pixels.

## Assets

Use base-safe URLs from `src/app/card-art.ts` and `src/app/board-assets.ts`.
`import.meta.env.BASE_URL` must appear as a literal member expression so Vite
replaces it correctly for GitHub Pages.

`ThreeAssets` owns asynchronous texture state and an idle texture limit. Loading
completion must invalidate only while the owner remains live. Raster failures
in the native HTML interface are tracked by URL in `native-html.ts`; strip the
raster class immediately on `error` and skip failed URLs on later renders.

Card art and board backgrounds are unhashed public assets and therefore follow
the service worker's network-first policy. The lazy Three.js JavaScript chunk is
hashed and cache-first.

## Effects

`ThreeEffects` maps structured log events to sequential visual work. Keep event
formatting in `src/app/log-presentation.ts`; drawing belongs here.

- Process effects in order and cap queued historical work.
- Reduced motion or a hidden document completes effects immediately.
- Cancellation must invoke completion so the queue can drain.
- Retain referenced cards until their effect no longer needs an anchor.
- Reanchor active visuals after layout changes.
- Cosmetic failures must not block gameplay.

## Native HTML interface

The HTML interface is part of this renderer. Its detailed markup, focus,
escaping, CSS, raster fallback, and responsive rules are documented in
[`three-interface.md`](three-interface.md). It remains available when the
WebGL Board stage is hidden for lobby and modal flows, but it is not a WebGL
gameplay fallback.

## Tests

Use focused model/contract tests for projection, selection, effects, and
resource ownership. Browser-like stateful tests must cover synchronous
notifications, rejection/retry, stale input, duplicate activation,
cancellation/disposal, and target cardinality. Build-time base-path behavior
requires the real Vite invocation pattern described in
[`testing.md`](testing.md).
