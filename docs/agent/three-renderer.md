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
of the stage away from the finger, and never over the held card. Without a
preview or room, a held press stays a tap.

- Releasing a peek closes it without a tap, so it never selects, previews,
  intercepts, or submits.
- Moving past the threshold closes the peek first and, for a summonable hand
  card, starts a drag.
- The peek closes on `pointercancel`, capture loss, blur, Escape, a hidden
  document, a decision change, a refused preview, relayout, an opened menu,
  and disposal. Every path clears both timers.
- The peek reuses the hover overlay and is `aria-hidden`. The narrow dock
  prompt announces it, and Details stays the keyboard and screen-reader path.
- `setPeek()` only re-renders the interface and never calls `onChange`. The
  peek is not part of `isBlocked()`.

### Second-finger guard

While a card follows one pointer, the `dragActive` option of `ThreeInterface`
makes the native click dispatcher (`handleClick`) inert. `ThreeBoard`'s
`activatePrimary` ignores the primary button. A second finger therefore
cannot press a dock button, Summon, or End Turn mid-drag.

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
  still move. After each step the board reruns `moveDrag` with the last
  pointer.
- **Stops.** The loop stops when the finger leaves the band, at either scroll
  end, and on release, cancellation, relayout, and disposal. A late frame does
  nothing. The mouse never auto-scrolls.

### Relayout

On relayout the board anchors the stage scroll to the near lane, so the lane
stays in view.

The narrow hand page follows the selected card across profile and page-size
changes. With no selection, a page-size change keeps the first card of the
old page in view. A new acting player or a presentation boundary still resets
the hand to page 0.

## Layout

Treat responsive layout as a pure projection from viewport and measured native
HTML chrome. Reuse `clamp` from `src/renderers/shared/math.ts` and cover fitting
from `src/renderers/shared/image-fit.ts`.

Keep action instructions and effect captions as stage-level overlays rather
than row content. Changing a wrapped prompt during an active drag can trigger
header measurement and invalidate the gesture. Anchor instructions at the near
internal `battlefield` row and place effect captions below the measured instruction
height.

During a live drag the instruction becomes a pill at the top of the visible
stage (`scrollTop` + 4 px), clear of the drop zone, and returns to the near row
when the drag ends. A passive stage `scroll` listener keeps it there when the
board scrolls mid-drag (a wheel, or edge auto-scroll), and re-places the card
and its acceptance from the last pointer. Touch and pen placement reserves the
pill's band, measured once at drag start, so the pill never covers a touch
card; a mouse card stays under the cursor. The pill's text changes only when
acceptance changes, and the end of a drag restores the current idle text,
which may be a response prompt. In the narrow profile it is hidden except as
the pill and reserves no caption space. Drag feedback changes only colour,
outline, and opacity, so measured headers keep their size.

`dropAccepts()` in `layout.ts` is the one drop predicate behind both the
highlight (`moveDrag`) and the release (`containsDrop`). Touch and pen get
`TOUCH_DROP_SLOP_PX` (12 client px) on the top and side edges, never on the
edge facing the hand, and the mouse gets none. A point over the hand, outside
the canvas, or outside the stage's visible box never drops.

`ThreeBoard` owns one `ThreeDragLayer` (`drag-layer.ts`): an `aria-hidden`,
pointer-transparent overlay inside `.three-board-stage`, so it scrolls with the
board. It draws the lifted card above the HTML headers and labels the landing
slot ("Lands here", or "+1" on an occupied narrow type slot). Each drag holds
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
