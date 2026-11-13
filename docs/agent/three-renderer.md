# Three.js renderer

Rules for the WebGL2 Board in `src/renderers/three/`.

## Rules

- No second gameplay renderer (`browser-renderer-architecture.test.ts`) or
  hidden fallback:
  [Explicit WebGL2 failure](../../AGENTS.md#explicit-webgl2-failure).
- Whatever allocates a listener, observer, frame or GPU resource disposes it,
  safely after partial construction and when repeated.
- Draw only when invalidated and visible in gameplay, with
  [no GameState clones](../../AGENTS.md#no-gamestate-clones-in-hot-loops).
- One gesture at a time, never both a click and a drop; primary actions go
  through `ThreeInterface.activatePrimaryAction()`, which revalidates them.
- A live drag measures layout once ([Drag geometry](#drag-geometry));
  `dropAccepts()` is the one drop predicate.
- Mid-drag, change only colour, outline and opacity; keep prompts and
  captions in stage overlays.
- Board CSS keys on `[data-shell]`, never `max-width: 480px`.
- Targets stay at least 44 CSS px (`three-layout.test.ts`); cull large native
  lists; never measure the DOM per frame.

## Composition and host lifecycle

- `RendererHost` mounts one renderer with the newest view, drops stale loads
  by generation (`renderer-host.test.ts`) and keeps failures out of gameplay
  status.
- `ThreeRenderer.unmount()` removes global listeners before disposing its
  parts; a failed `mount()` unmounts and rethrows.
- On `webglcontextlost` the board prevents the default, cancels its frame,
  ends any drag and reports once via `onFailure`.

## Resource ownership

Cancel work before disposing what it references.

- `ThreeBoard`: renderer, scene, observers, frame, registry, background and
  asset cache.
- `ThreeCardRegistry`: shared geometry and every active or retired card,
  cleared at each `presentationBoundary()` (`three-effects.test.ts`).
  Dispose `createPresentation()` cards first.
- `ThreeBackground`, `EffectVisual`: their meshes and materials;
  `ThreeInteraction`: its listeners and pointer capture.

## Interaction

`ThreeBoard` captures intent; `ThreeInterface` owns submission
([reentrant UI submissions](state-and-persistence.md#reentrant-ui-submissions)).
When idle, any touch or pen `pointerdown` starts a gesture; a new pointer
replaces a press or peek, while a drag ignores it. Capture drags, reject stale
hits, and cancel at visibility, layout, overlay and lifecycle boundaries
(`three-interaction.test.ts`).

### Long-press peek

A touch or pen press held within `TOUCH_DRAG_THRESHOLD_PX` shows a ring at
`PEEK_RING_DELAY_MS` and peeks at `PEEK_HOLD_MS` (`three-interaction.test.ts`).

- Gate on `ThreeInterface.canPeek()`, which mirrors Details, so a peek never
  reveals what a preview hides.
- `peekPlacement()` opens away from the finger only where `peekFits()`, an
  unpainted probe, fits the whole panel; pointerdown checks geometry only.
  Otherwise the press stays a tap.
- Release only closes a peek; passing the threshold closes it before any
  drag. Every close path (cancel, capture loss, blur, Escape, hidden
  document, decision change, refused preview, relayout, menu, disposal)
  clears both timers.
- `setPeek()` never calls `onChange`; the peek is not in `isBlocked()`, and
  Details stays the keyboard path.

### Second-finger guard

While a card follows a pointer, `dragActive` makes `ThreeInterface`'s
`handleClick` inert (`three-interface.test.ts`) and the board ignores its
primary and page buttons (`three-battlefield-controls.test.ts`). Never reuse
`isBlocked()` or `nativeActionBlocked()`: `playCard` checks the latter, so
the drop would fail.

### Context menu

The canvas prevents `contextmenu` for touch and pen, and for any type after
a touch or pen press; a mouse right-click keeps its menu
(`three-interaction.test.ts`). The game stage disables the touch callout
and text selection.

### Edge auto-scroll

Touch and pen drags scroll the stage within `AUTO_SCROLL_EDGE_PX` of its
visible edge, faster with depth up to `AUTO_SCROLL_MAX_SPEED`; the
mouse never does. It stops outside the band and at either end
(`three-battlefield-controls.test.ts`), and on release, cancel, relayout and
disposal.

### Drag geometry

The first move measures the canvas client box, the stage's visible box and
scroll range (`DragGeometry`); later moves, auto-scroll steps and the
release reuse them (`three-battlefield-controls.test.ts`).

- A stage `scroll` reads only `scrollTop`; an offset the drag did not write
  pins the pill and re-places the card.
- A render, or a relayout that keeps the drag, discards the geometry; a page
  or ancestor scroll re-measures at once. Anything else that can move the
  stage must discard it too.
- `containsDrop` uses the geometry behind the highlight, else measures.

### Relayout

Viewport and observer callbacks interrupt gestures only on a real change: a
new layout, any shell or short-flag change included, ends the drag, cancels
the interaction, re-presents and re-anchors; a resized stage around a board
held at `NARROW_MIN_BOARD_HEIGHT` does the same without re-presenting.
Re-anchoring keeps the near lane, and in the short rail the hand, in view,
dropping the near header first.

### Hand paging

A touch-shell hand page follows the selection across profile and page-size
changes, even while input is blocked. Without a selection, touch shells keep
the browsed page, or its first card on a page-size change. Entering or
leaving `desktop`, a new actor or a presentation boundary resets to page 0
(`three-battlefield-controls.test.ts`).

## Layout

Pure functions of the viewport and measured chrome, using the
[shared helpers](../../AGENTS.md#reuse-shared-helpers). Lay out and pick in
CSS pixels; the pixel ratio sets only GPU resolution.

### Touch shells

`ThreeRenderer` reclassifies with `threeShellProfile()` on `resize` and
`(pointer: coarse)` changes, never for `visualViewport`, re-rendering only
on a profile or short-flag change (`three-renderer.test.ts`).

- **Classifier.** First match wins (`three-layout.test.ts`, with
  `fold4-postures.ts`):
  1. Invalid size: `desktop`.
  2. Width at most 480 px (`isNarrowWidth`): `narrow`, any pointer.
  3. Fine primary pointer: `desktop`.
  4. Coarse, wider than `TOUCH_SHELL_MAX_WIDTH` (1024 px) and taller than
     480 px: `desktop`.
  5. Landscape: `rail`, short at most 480 px tall (`SHORT_SHELL_MAX_HEIGHT`).
  6. Portrait: `dock`.

  Key on the primary pointer (`(pointer: coarse)`), not `any-pointer`, and
  on orientation, not aspect ratio. No input depends on the shell, so add
  hysteresis only if devices show flapping.
- **Settled defaults** (device testing may revisit): the drop follows the
  finger (the lifted card is only a visual offset); a 2D drag layer, never a
  second WebGL context; no haptics; the rail stays right, unmirrored; the
  mouse keeps hover, with no press-and-hold peek; flex mode (Viewport
  Segments API) needs its own plan.
- **Root.** In a game, touch shells set `data-shell` on `.three-root` and
  show the dock; a short rail adds `data-shell-short="true"`; only `narrow`
  adds `three-root--narrow`.
- **Geometry.** `narrowBoardLayout()` with per-shell `TOUCH_CARD_MAXIMA`;
  `compactBoardViewport()` takes `window.innerHeight`.
- **Pager row.** Always reserved in `narrow`; in `dock` and `rail` only while
  paged, so it never moves mid-drag.
- **Chrome.** `narrow` and `dock` keep a fixed-size dock; the target panel
  and tutorial banner stay clear of the rail.

Drag presentation:

- A pill pinned to the visible stage top shows the instruction, changing
  only with acceptance; the end restores the current idle text.
- `dragProxyPlacement()` lifts a touch card above the finger, or beside it
  (`preferSide` in the short rail), below the pill's band and keeping the
  landing slot visible; a mouse card stays under the cursor.
- A point over the hand, outside the canvas or outside the visible stage
  never drops; touch and pen get `TOUCH_DROP_SLOP_PX`, never toward the hand.
- `ThreeDragLayer` is `aria-hidden`, pointer-transparent and holds at most
  one face lease, released by `endDrag` on every path; if it cannot paint,
  the in-scene proxy stays (`three-drag-layer.test.ts`).
- Call `onDragFeedback` last: its listener may end or dispose the board.
- Reduced motion and Animations Off skip only the return animation.

## Assets

Card and board art use base-safe URLs from `src/app/card-art.ts` and
`src/app/board-assets.ts` ([Vite base URL](../../AGENTS.md#vite-base-url)).
`ThreeAssets` owns texture state and an idle limit; a load invalidates only
while its owner is live.

## Effects

`ThreeEffects` plays log events in order, at most
`MAX_QUEUED_EFFECTS` queued; formatting stays in `src/app/log-presentation.ts`.
Reduced motion, Animations Off or a hidden document announce each effect for
`EFFECT_ANNOUNCEMENT_MS` instead of playing it.
Cancellation completes, so the queue drains. Retain cards an effect anchors
to; after a resize or page change, invalidate moved anchors, then reanchor.
Never block gameplay on cosmetic failure.

## Native HTML interface

See [three-interface.md](three-interface.md).

## Tests

[Three.js tests](testing.md#threejs-tests).
