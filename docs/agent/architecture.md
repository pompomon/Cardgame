# Architecture

Module ownership, layering ([ADR 0001](adr/0001-layering.md)) and AI data
flow.

## Rules

- Dependencies flow inward: `renderers/three/` → `app/` → `game/`, and
  `cli/` → `app/` → `game/`.
- `src/game/` is pure: it imports only game modules (`src/test/engine.test.ts`)
  and uses no browser API, Three.js, storage, catalog or app orchestration.
- `src/app/` keeps browser APIs behind thin adapters such as `safe-storage.ts`
  and `install-support.ts`; P2P uses `src/net/`.
- Renderers use `ControllerApi` and public app/game types, guards and helpers,
  never controller internals.
- `src/cli/` uses pure app/game helpers, never persistence, P2P, renderers or
  DOM APIs (`src/test/cli-bundle.test.ts`: no storage or P2P).
- `src/app/` decides presentation semantics once; renderers and the CLI only
  translate them; DOM mechanics stay in `src/renderers/`.
- Put policy in the innermost layer that can express it, with exactly one
  canonical option list, default and guard per concept.
- Three.js is the only browser renderer (Board plus native HTML), with no
  setting or fallback (`src/test/browser-renderer-architecture.test.ts`).
- Player copy comes only from `src/app/card-catalog.ts` via app helpers:
  [Catalog presentation boundary](../../AGENTS.md#catalog-presentation-boundary).
- Identity-sensitive loops follow `BASIC_LANDS`, not names or catalog keys:
  [serialized identity](state-and-persistence.md#serialized-identity-versus-display-copy).

## Module map

| Directory | Owns | Key modules |
| --- | --- | --- |
| `game/` | Rules, legality, deterministic transitions, decks; AI policies (levels, tutorial), search, evaluation, seeded randomness | `engine.ts`, `cards.ts`, `types.ts`, `ai.ts`, `ai-*.ts`, `ai-policies/` |
| `app/` | UI-independent orchestration, persistence, Adventure, recordings, settings, guards; catalog, labels, lobby options, event formatting, base-safe asset URLs | `controller.ts`, `view-model.ts`, `validators.ts`, `safe-storage.ts`, `adventure*.ts`, `card-catalog.ts`, `*-presentation.ts` |
| `net/` | WebRTC P2P transport | `p2p.ts` |
| `renderers/` | Renderer contract, lazy Three.js loading and recovery, card previews | `types.ts`, `host.ts`, `card-preview.ts` |
| `renderers/shared/` | Pointer state and generic render math | `drag-state.ts`, `math.ts`, `image-fit.ts` |
| `renderers/three/` | WebGL renderer, scene, GPU resources, picking, effects, layout; native HTML and CSS | `index.ts`, `board.ts`, `card-registry.ts`, `interaction.ts`, `effects.ts`, `interface.ts` |
| `cli/` | Terminal prompts and output; Node adapter `scripts/cardgame-cli.mjs`, bundle `dist-cli/cardgame-cli.mjs` | `main.ts`, `session.ts`, `options.ts` |
| `test/` | Vitest specs, `helpers/`, `fixtures/`, opt-in `tools/` | `*.test.ts`, `ai-perf.bench.ts` |
| `assets/` | Unused Vite starter art | — |

## Browser renderer contract

- `main.ts` imports `style.css`, clears legacy renderer choices
  ([ADR 0002](adr/0002-three-only-renderer.md)), wires `AppController` to
  `RendererHost` and registers the service worker.
- `RendererHost` lazy-loads Three.js, renders the newest `AppViewModel` and
  keeps `AppController` across failures
  ([Explicit WebGL2 failure](../../AGENTS.md#explicit-webgl2-failure)).

## Three.js ownership

`ThreeRenderer` disposes its interaction, effects, interface and board in
reverse dependency order; `ThreeBoard` owns the WebGL renderer, scene, frame
and card registry ([resource rules](three-renderer.md#resource-ownership)).

## Interaction boundary

```text
engine legal actions → AppViewModel options → interface/board input
→ ControllerApi.submitAction() → synchronous controller notification
```

Board primary actions route through `ThreeInterface.activatePrimaryAction`;
renderers revalidate decision/session keys and projected legality before
submitting
([reentrant UI submissions](state-and-persistence.md#reentrant-ui-submissions)).

## AI decisions

The controller's AI timer (never during replays) and the CLI call
`chooseAiAction(state, actor, { level, seed })` synchronously with the game
seed; the tutorial calls `tutorialPolicy`. Basic (first legal action) and
Advanced (one-ply score) are deterministic; Hard searches:

```text
explainHardDecision                                  ai-hard.ts
 ├─ criticality = decisionCriticality(state)         ai-selection.ts
 ├─ persona     = personaForSeat(seed, actor)        ai-personas.ts
 ├─ search      = searchActionValues(...)            ai-search.ts
 │   ├─ classes: canonicalActionClasses              ai-action-classes.ts
 │   ├─ worlds:  determinize(projectKnowledge(...))  ai-knowledge.ts
 │   ├─ moves:   applyActionForSearch                engine.ts
 │   └─ values:  playRollout → evaluator             ai-rollout.ts, ai-features.ts, ai-weights.ts
 └─ choice      = selectSearchedClass(...)           ai-selection.ts
```

Budgets, selection, determinism: [ADR 0003](adr/0003-hard-ai-search.md).
