# Architecture

A module map and ownership guide for the Three.js-only browser application.
The renderer consolidation decision is recorded in
[`adr/0002-three-only-renderer.md`](adr/0002-three-only-renderer.md).

## Module map

```text
src/
├── game/                       Pure game engine and AI
│   ├── engine.ts               Rules, legality, and action application
│   ├── cards.ts                Deck generation and seeded shuffle
│   ├── ai.ts                   Policy registry
│   ├── ai-levels.ts            Canonical AI level type and guard
│   └── ai-policies/            Individual AI policies
│
├── app/                        UI-independent orchestration
│   ├── controller.ts           State transitions, persistence, subscriptions
│   ├── view-model.ts           Immutable renderer projection
│   ├── action-resolution.ts    Shared legal-action presentation
│   ├── game-recording.ts       Versioned recording import/export
│   ├── adventure*.ts           Adventure state and persistence
│   ├── log-presentation.ts     Structured event labels and visual-log cap
│   ├── lobby-presentation.ts   Lobby mode options and predicates
│   ├── renderer-migration.ts   One-way cleanup of obsolete renderer choices
│   ├── board-assets.ts         Base-safe board and ambience locations
│   ├── card-art.ts             Base-safe card-art locations
│   ├── install-support.ts      PWA installation state
│   ├── safe-storage.ts         Exception-safe localStorage adapter
│   └── types.ts                App and view-model types
│
├── renderers/
│   ├── host.ts                 Lazy Three.js loading and accessible recovery
│   ├── types.ts                Renderer lifecycle contract
│   ├── card-preview.ts         Framework-independent preview policy
│   ├── shared/
│   │   ├── drag-state.ts       Pointer-type-aware drag state
│   │   ├── image-fit.ts        Cover-crop calculations
│   │   ├── interaction-feedback.ts
│   │   └── math.ts             Shared bounded math
│   └── three/
│       ├── index.ts            Renderer composition and lifecycle
│       ├── board.ts            Scene, camera, picking, and GPU ownership
│       ├── assets.ts           Texture loading and fallback ownership
│       ├── background.ts       Board and ambience presentation
│       ├── card-registry.ts    Retained card identities and meshes
│       ├── interaction.ts      Pointer capture and drag/drop
│       ├── effects.ts          Cancellable event queue
│       ├── effect-visual.ts    Cosmetic drawing primitives
│       ├── interface.ts        Native HTML behavior and focus management
│       ├── interface-model.ts  Native HTML projection
│       └── native-html.ts      Escaped markup and raster fallback tracking
│
├── cli/                        Browser-independent terminal interface
├── net/                        WebRTC P2P transport
├── test/                       Vitest specifications
└── main.ts                     Browser bootstrap
```

The Node adapter is `scripts/cardgame-cli.mjs`. Vite emits the standalone ESM
bundle at `dist-cli/cardgame-cli.mjs`.

## Layering

Dependencies flow inward:

```text
renderers/three/ ──→ app/ ──→ game/
cli/             ──→ app/ ──→ game/
```

- `src/game/` imports only game modules and has no browser APIs.
- `src/app/` imports app/game modules. Browser APIs belong behind thin adapters
  such as `safe-storage.ts` and `install-support.ts`.
- `src/renderers/` may consume public app/game types, guards, and helpers but
  never controller internals.
- `src/cli/` may consume pure app/game helpers but not persistence, P2P, browser
  renderers, or DOM APIs.
- Shared presentation semantics belong in `src/app/`; framework and DOM
  mechanics belong in `src/renderers/`.

## Browser renderer contract

Three.js is the only browser renderer. Its WebGL battlefield and native HTML
lobby, dialogs, settings, P2P controls, recording controls, and accessibility
surface are one renderer. “Native HTML” does not mean a fallback renderer.

`RendererHost` dynamically imports Three.js so the initial shell remains small.
It buffers the newest `AppViewModel`, rejects stale loads, and keeps the
`AppController` alive across graphics failures. WebGL2 is a runtime requirement.
Load, mount, render, and context-loss failures unmount partial GPU state and show
an accessible retry/reload panel. Retrying remounts Three.js against the same
controller and current view.

There is no renderer setting in `AppState` or `AppViewModel`. On startup,
`main.ts` removes obsolete `renderer` query parameters while preserving every
other query parameter and the hash. It also removes the old
`cardgame-renderer` localStorage entry through `safe-storage.ts`.

## Three.js ownership

- `ThreeRenderer` owns and disposes board, interface, interaction, and effects
  objects in reverse dependency order.
- `ThreeBoard` owns the WebGL renderer, canvas, scene resources, observers, and
  animation frame.
- `ThreeCardRegistry` owns retained card meshes and shared geometry.
  Presentations created outside its pick/history registry must be disposed by
  their caller before registry disposal.
- Resizing or changing the presented page reconciles card positions, invalidates
  historical effect anchors, then reanchors active effects.
- Rendering occurs on invalidation or during bounded cosmetic animation, not an
  unconditional permanent loop.
- Pointer adapters use canvas CSS bounds for picking; drawing-buffer quality is
  a separate concern.

## Interaction boundary

Trace stateful UI work end-to-end:

```text
engine legal actions → AppViewModel options → interface/board input
→ ControllerApi.submitAction() → synchronous controller notification
```

Board primary actions route through `ThreeInterface.activatePrimaryAction`.
Renderers must revalidate decision/session keys and projected legality before
submitting. Notifications may be synchronous and submissions may be rejected;
follow the
[reentrant submission contract](state-and-persistence.md#reentrant-ui-submissions).

## Where code belongs

| Concern | Owner |
| --- | --- |
| Rules, legality, deterministic transitions | `src/game/` |
| AI policy | `src/game/ai-policies/` |
| Shared labels, lobby options, event formatting | `src/app/` |
| Persisted settings and their guards | `src/app/` |
| Pointer state or generic render math | `src/renderers/shared/` |
| GPU resources, picking, effects, layout | `src/renderers/three/` |
| Native HTML behavior and CSS | `src/renderers/three/` |
| Terminal prompting and output | `src/cli/` plus `scripts/` adapter |

When unsure, place policy at the innermost layer that can express it without
depending on an outer interface. Keep exactly one canonical option list,
default, and guard for each domain concept.
