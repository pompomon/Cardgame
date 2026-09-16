# ADR 0001: Module layering

- Status: Accepted
- Date: 2026-05-18
- Supersedes: —
- Superseded by: —

## Context

The codebase has grown around a clear three-layer split (`game/`, `app/`,
`renderers/`) but the rule had been advisory and lived only in
[`docs/agent/architecture.md`](../architecture.md). Reviewers were catching
violations by hand (`game/ → app/` imports, view-model state leaks, the
"hide AI hand" parity bug, etc.). This ADR codifies the layering rule so it
is the canonical reference for both humans and AI agents.

## Decision

The repository has three concentric layers. Dependencies flow strictly
**inward**.

```
renderers/three/  ──→  app/  ──→  game/
```

| Layer | Allowed to import from | Forbidden |
| --- | --- | --- |
| `src/game/` | `src/game/` only | `src/app/`, `src/renderers/`, browser APIs, storage, network |
| `src/app/` | `src/game/`, `src/app/` | `src/renderers/`; DOM/storage only through thin adapters |
| `src/renderers/three/` | `src/app/`, `src/game/` types/guards, `src/renderers/shared/`, Three.js | Controller internals |

### Cross-cutting rules

1. **Single source of truth.** Option lists, default values, and type
   guards for the same domain concept live in one module
   (e.g. `game/ai-levels.ts` owns `AiLevel`, `AI_LEVELS`, `DEFAULT_AI_LEVEL`,
   and `isAiLevel`; `app/ai-levels.ts` re-exports them and adds the
   renderer-facing `AI_LEVEL_OPTIONS` label table; renderers re-import,
   never re-declare).
2. **Validation at the trust boundary.** Anything entering the app from
   `localStorage`, imported JSON, or a P2P payload must pass a guard from
   `app/validators.ts` (or a guard built from those helpers).
3. **View-model immutability.** Renderers consume controller state
   exclusively through `AppViewModel`. Never pass `state.adventure` /
   `state.game` by reference; project an immutable snapshot.
4. **One presentation policy.** Behavior observable in both the Three.js board
   and its native HTML interface (hand redaction, animation speed, card visual
   style) is implemented in `app/` once. Presentation surfaces translate; they
   do not decide.
5. **Engine purity.** `src/game/` must not import browser APIs, Three.js, `app/`, or
   browser APIs. AI policies must not `structuredClone(GameState)` —
   enforced by `src/test/ai-no-state-clone.test.ts`.

## Consequences

### Positive

- Reviewers (human or AI) can point at this ADR instead of re-deriving the
  rule from scratch each time.
- New developers have a single canonical document to read before touching
  cross-layer code.
- Future tooling (e.g. `dependency-cruiser`) can mechanically enforce the
  layering. The ADR is the contract that tooling will implement.

### Negative

- Adds one more document contributors must keep in sync. The mitigation is
  that this ADR is short and stable: changes that touch it should be rare
  and require deliberate review.

## Exceptions

There are currently **no** documented exceptions. The previously documented
`game/ → app/` seam for `AiLevel` has been removed (see "Close legacy seam"
work) — the type now lives in `src/game/` and `src/app/types.ts` re-exports
it for backwards-compatible imports.

## Related documents

- [`AGENTS.md`](../../../AGENTS.md) — non-negotiable rules.
- [`docs/agent/architecture.md`](../architecture.md) — module map.
- [`ADR 0002`](0002-three-only-renderer.md) — browser renderer consolidation.
- [`docs/agent/state-and-persistence.md`](../state-and-persistence.md) —
  validation invariants this ADR encodes.
