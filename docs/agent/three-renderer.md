# Three.js renderer

The sole browser renderer lives in `src/renderers/three/`. It combines a WebGL2
battlefield with a native HTML lobby, HUD, menus, dialogs, P2P controls,
recording controls, card lists, and accessibility actions.

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
shows a focused `role="alert"` panel with retry and reload controls. Failure
messages must not overwrite gameplay status.

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
Battlefield primary actions must route through
`ThreeInterface.activatePrimaryAction()` so current blocking state, decision
keys, and legality are revalidated immediately before submission.

Pointer interaction must:

- Track one active pointer by identity and pointer type.
- Use capture for drags that leave the canvas.
- Reject stale hits after view/session changes.
- Cancel on visibility, layout, overlay, and lifecycle boundaries.
- Keep click activation and drag/drop from firing for the same gesture.

Controller submissions can notify subscribers synchronously and can reject.
Never let cleanup for an older submission erase a newer decision. Preserve a
still-legal retry selection after rejection; see
[reentrant UI submissions](state-and-persistence.md#reentrant-ui-submissions).

## Layout

Treat responsive layout as a pure projection from viewport and measured native
HTML chrome. Reuse `clamp` from `src/renderers/shared/math.ts` and cover fitting
from `src/renderers/shared/image-fit.ts`.

Keep action instructions and effect captions as stage-level overlays rather
than row content. Changing a wrapped prompt during an active drag can trigger
header measurement and invalidate the gesture. Anchor instructions at the near
battlefield row and place effect captions below the measured instruction
height.

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
battlefield stage is hidden for lobby and modal flows, but it is not a WebGL
gameplay fallback.

## Tests

Use focused model/contract tests for projection, selection, effects, and
resource ownership. Browser-like stateful tests must cover synchronous
notifications, rejection/retry, stale input, duplicate activation,
cancellation/disposal, and target cardinality. Build-time base-path behavior
requires the real Vite invocation pattern described in
[`testing.md`](testing.md).
