# Architecture

A quick map of the codebase plus a "where does this belong?" decision guide.

## Module map

```
src/
├── game/                  Pure game engine + AI (no DOM, no Phaser)
│   ├── engine.ts          Rule enforcement, action application
│   ├── cards.ts           Deterministic deck generation, seeded shuffle
│   ├── ai.ts              Policy registry (basic / advanced / hard)
│   ├── ai-levels.ts       Canonical AiLevel tuple + type + guard
│   ├── ai-policies/       Per-level policy implementations
│   └── types.ts           Engine-level types and guards
│
├── cli/                   Terminal interface (Human vs AI / AI vs AI)
│   ├── main.ts            CLI option-to-session orchestration
│   ├── options.ts         Argument parsing, defaults, and validation
│   ├── session.ts         Injected-I/O terminal game loop
│   └── io.ts              Terminal adapter contract
│
├── app/                   Orchestration layer; no DOM/Phaser-specific code
│   ├── controller.ts      App controller: mode/state transitions,
│   │                      persistence side effects, subscriptions
│   ├── view-model.ts      Projects controller state into the shape
│   │                      renderers consume (immutable snapshot)
│   ├── action-validation.ts Shape + legality guards for untrusted actions
│   ├── game-recording.ts  Versioned save/load + sanitization
│   ├── adventure.ts       Adventure run shape, snapshot guards
│   ├── adventure-persistence.ts  Adventure-run localStorage helpers
│   ├── ai-levels.ts       Lobby AI_LEVEL_OPTIONS (re-exports from game/)
│   ├── animation-settings.ts  App-wide animation speed setting
│   ├── card-visuals.ts    Procedural icon generation, raster routing
│   ├── card-visual-styles.ts  CardVisualStyle tuple, guards, options
│   ├── card-art.ts        Raster asset registry, URL builder
│   ├── board-assets.ts     Board/sprite public paths + base-safe URLs
│   ├── install-support.ts PWA install state machine
│   ├── renderer-selection.ts  ?renderer=… selector
│   ├── safe-storage.ts    localStorage wrappers (swallow access errors)
│   ├── url-path.ts        Base-path helpers
│   ├── validators.ts      Shared structural validators (capTail, …)
│   └── types.ts           App-level shared types
│
├── renderers/
│   ├── host.ts            Lazy graphics loading + state-preserving DOM fallback
│   ├── dom.ts             DOM renderer
│   ├── shared/            Framework-independent pointer state
│   ├── three/             Optional WebGL2 / Three.js tabletop
│   │   ├── index.ts       Composition, presentation and lifecycle
│   │   ├── board.ts       Retained board, camera, picking and GPU ownership
│   │   ├── assets.ts      Shared/ref-counted art textures and fallbacks
│   │   ├── card-registry.ts Retained card identities and visual state
│   │   ├── layout.ts      CSS-pixel coordinates and adaptive row overlap
│   │   ├── quality.ts     Actual drawing-buffer and effect quality bounds
│   │   ├── interaction.ts Pointer capture, drag/drop and cancellation
│   │   ├── interface.ts   Native HTML lobby, actions, menus and targets
│   │   └── effects.ts     Cancellable event queue + board presentation
│   └── phaser/            Phaser 4 renderer
│       ├── index.ts       Composition root: PhaserRenderer (mount/render/
│       │                  unmount), wires scenes + DOM overlays together
│       ├── renderer-host.ts  PhaserRendererHost interface shared by the
│       │                  scenes so they never import the composition root
│       ├── scene-config.ts   Scene-wide numeric constants + scene keys
│       ├── theme.ts       Color palette, CardStyle, cardStyleForLand
│       ├── scene-host.ts  Phaser.Game bootstrap + canvas host element
│       ├── scene-lifecycle.ts Idempotent shutdown/destroy cleanup binding
│       ├── card-art-loader.ts  Card art texture preloading
│       ├── asset-manifest.ts   Board background/atlas texture manifests
│       ├── texture-loader.ts   Tiered board loading + recoverable failed-URL suppression
│       ├── board-background.ts Retained board background + ambience owner
│       ├── card-factory.ts   Static card GameObject factory (previews/logs)
│       ├── card-view.ts      Retained visible-card object owner
│       ├── card-view-pool.ts Fully reset reusable CardView pool
│       ├── card-view-registry.ts Stable card-id reconciliation + card layer
│       ├── drag-state.ts    Pointer-type-aware drag state machine
│       ├── drag-controller.ts Drag proxy, cancellation + legal-action owner
│       ├── drop-zone-view.ts Retained drop-zone and target-ring feedback owner
│       ├── interaction-feedback.ts Pure drag/effect feedback semantics
│       ├── lobby-scene.ts LobbyScene (mode select, Settings, Recording)
│       ├── lobby-actions.ts  Lobby row/action models + predicates (pure, tested)
│       ├── cardgame-scene.ts CardgameScene: lifecycle/input wiring, menu
│       │                  overlay, composes the subsystems below
│       ├── gameplay-presenter.ts  Sequences the render-pass modules below
│       ├── game-header.ts    Header strip (☰ Menu button, turn/winner label)
│       ├── player-info.ts    Active/non-active player info panels
│       ├── battlefield-view.ts  Battlefield chrome, positions + card descriptors
│       ├── hand-controls.ts  Hand descriptors + phase-specific controls
│       ├── log-tiles.ts   Log tile cap/legacy-fallback/empty/a11y content (pure, tested)
│       ├── battlefield-targets.ts  Battlefield target pure state/a11y (tested)
│       ├── target-picker.ts  Target-picker popup UI (explicit WebGL-safe culling)
│       ├── effect-controller.ts  Cancellable effect queue + card position registries
│       ├── p2p-overlay.ts    Lobby P2P manual-signaling HTML overlay
│       ├── a11y-navigation.ts  Keyboard/screen-reader nav mirroring Phaser UI
│       ├── recording-file-actions.ts  Hidden file input + recording download
│       ├── quality.ts     Adaptive PhaserQualityProfile policy (tier, DPR
│       │                  bound, background variant, ambience, tweens)
│       ├── layout.ts      Shared layout math + clamp
│       ├── log-scroll.ts  Menu Replay Log scroll math
│       ├── log-events.ts  formatLogEventTile/Text
│       └── effects.ts     Effect queue runner
│
├── net/                   P2P (WebRTC data channel + manual signaling)
│
├── test/                  vitest specs (named after module or behavior under test)
├── main.ts                Entry; mounts renderer and subscriptions
└── style.css              DOM styling
```

The Node-specific adapter is `scripts/cardgame-cli.mjs`; Vite bundles it and
the imported pure modules into `dist-cli/cardgame-cli.mjs` using
`vite.cli.config.ts`. The generated bundle is not committed.

## Layering rule

Preferred dependency direction:

```
renderers/{dom,phaser,three}/  ──→  app/  ──→  game/
cli/                     ──→  app/  ──→  game/
```

- `game/` is independent of `app/` and `renderers/`. (Previously `AiLevel`
  was imported by `game/ai.ts` from `app/types.ts`; this seam has been
  closed — `AiLevel` now lives in `src/game/ai-levels.ts` and `app/types.ts`
  re-exports it for backwards-compatible imports. See
  [`adr/0001-layering.md`](adr/0001-layering.md).)
- `app/` must not import from `renderers/`.
- Renderers should consume controller state through `AppViewModel`/controller
  APIs, but may import shared app/game helpers and types directly
  (options/constants/guards) when needed.
- `cli/` is another outer interface. It may consume pure presentation and
  validation helpers from `app/` plus the engine/AI APIs from `game/`, but it
  must not import browser renderers, persistence, P2P, Phaser, or DOM APIs.

A renderer should never reach into controller internals; if it needs
information, project it into the view-model.

For stateful UI changes, trace the full round trip: engine legal actions →
`AppViewModel` options → renderer input → `ControllerApi.submitAction()` →
controller notification. Reuse `src/app/action-resolution.ts` and existing
renderer decision/session guards. Three.js battlefield primary actions go through
`ThreeInterface.activatePrimaryAction`, not a direct board-to-controller shortcut.
Notifications can be synchronous and submissions rejected; follow the
[reentrant submission contract](state-and-persistence.md#reentrant-ui-submissions)
and test every renderer affected by shared behavior changes.

## Three.js integration

`RendererHost` retains the controller while asynchronously loading graphics
renderers. DOM remains in the initial bundle as the offline/unsupported-GPU
fallback. The host projects the *running* renderer into the view model without
overwriting the stored preference. Renderer switches in lobby links still
navigate; runtime failure fallback never reloads or restarts a match.

Three.js owns one canvas and a separate native HTML interface. Never replace
the canvas host's HTML when refreshing controls. Meshes, drag sessions,
textures, effects, and target selection remain renderer-owned; submit only
app-projected legal actions through `ControllerApi`.

`renderers/shared/drag-state.ts` is the common pure pointer state machine;
Phaser's old import path re-exports it for compatibility. Renderer adapters
own pointer capture and graphics-specific coordinates. Three.js uses canvas
CSS bounds for picking, independently of its capped drawing-buffer DPR.

Graphics render only on invalidation or during cosmetic animation. Cleanup
must cancel pointer sessions, playback, pending loads, and frame callbacks
before disposing GPU resources. Context loss selects the same-session DOM
fallback. Board orientation and event semantics reuse the app layer.

## Where does this code go?

| Concern | Goes in | Rationale |
| --- | --- | --- |
| Rules, legality, action application | `src/game/` | Pure, deterministic, no UI |
| AI policy heuristics | `src/game/ai-policies/` | Pure, depends only on engine |
| Terminal parsing, prompting, and output | `src/cli/` + thin `scripts/` adapter | Keeps Node I/O outside the shared engine |
| Shared presentation logic (e.g. hide AI hand from human, action labels) | `src/app/game-presentation.ts` + `src/app/view-model.ts` | One implementation shared by browser renderers and CLI |
| New persisted setting (localStorage) | `src/app/<feature>.ts` + matching guard + controller wiring | Validation must live next to the persisted shape |
| New AiLevel | `src/game/ai-levels.ts` (canonical tuple) + `src/app/ai-levels.ts` (label) + new policy in `src/game/ai-policies/` + registry entry in `src/game/ai.ts` (README has the full checklist) | Keeps registry-driven |
| Layout math (Phaser) shared between scenes | `src/renderers/phaser/layout.ts` | Already the shared home; reuse its `clamp` |
| Phaser scroll math for a panel | `src/renderers/phaser/log-scroll.ts` pattern | Co-locate with the renderer |
| Type guard for a type | Next to the type definition | Don't fork guards across modules |
| New raster card-art style | `RASTER_CARD_VISUAL_STYLES` + assets under `public/cards/<style>/` + `scripts/generate-card-art.mjs` recipe (if generated) | Renderers route through `cardArtSourceFor` / `isRasterCardVisualStyle` automatically |

## Cross-cutting conventions

- **Shared sentinels** (e.g. `HIDDEN_HAND_CARD_NAME`) live in `src/app/types.ts`
  and are imported by both renderers.
- **Default values** live alongside the option list and are exported as
  `DEFAULT_*` constants (e.g. `DEFAULT_CARD_VISUAL_STYLE`). Never inline the
  literal in renderer fallbacks.
- **Cross-renderer behavior parity**: if a behavior is observable to a user
  in both renderers (hide AI hand, animation speed, card visual style), it
  must be implemented once at the `app/` layer.
