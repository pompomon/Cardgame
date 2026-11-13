# ADR 0001: Module layering

Status: Accepted, 2026-05-18; [ADR 0002](0002-three-only-renderer.md)
supersedes its browser-renderer parts.

## Context

The `game/`, `app/`, `renderers/` split was advisory, so reviewers caught
`game/` → `app/` imports and view-model leaks by hand.

## Decision

Dependencies flow strictly inward: `renderers/three/` → `app/` → `game/`.

| Layer | May import | Never |
| --- | --- | --- |
| `src/game/` | `src/game/` | `src/app/`, `src/renderers/`, Three.js, browser APIs, storage, network |
| `src/app/` | `src/game/`, `src/app/`, `src/net/` | `src/renderers/`; DOM or storage except via thin adapters |
| `src/renderers/three/` | `src/app/`, `src/game/` types and guards, `src/renderers/shared/`, Three.js | Controller internals |

- One owner per concept: `game/ai-levels.ts` owns `AiLevel`, `AI_LEVELS`,
  `DEFAULT_AI_LEVEL` and `isAiLevel`; `app/ai-levels.ts` re-exports them and
  adds `AI_LEVEL_OPTIONS`
  ([Reuse shared helpers](../../../AGENTS.md#reuse-shared-helpers)).
- Board and native-interface behavior (hand redaction, animation speed, card
  visual style) is decided once in `app/`.
- Guards in `app/validators.ts` enforce
  [Validate and cap untrusted JSON](../../../AGENTS.md#validate-and-cap-untrusted-json);
  renderers follow
  [Immutable view-model snapshots](../../../AGENTS.md#immutable-view-model-snapshots).

## Consequences

- `src/test/engine.test.ts` fails on a non-game import in `src/game/`, and
  `src/test/ai-no-state-clone.test.ts` on `structuredClone` in AI modules
  ([No GameState clones in hot loops](../../../AGENTS.md#no-gamestate-clones-in-hot-loops)).
- No exceptions: `AiLevel` lives in `game/`; `app/types.ts` re-exports it.
