---
name: code-review
description: Review Cardgame pull requests with repository context, focusing on performance, user experience, and correctness of implementation.
---

# Cardgame code review

Report only high-confidence findings that affect correctness, performance,
user experience or a repository rule; skip style-only feedback.

## Load context

Read [`AGENTS.md`](../../../AGENTS.md), the
[`docs/agent/`](../../../docs/agent/) topic docs for the touched areas, and
the `.github/instructions/` files whose `applyTo` matches the diff.

## Checklist

### Correctness

- [ ] Every `AGENTS.md` hard rule holds: Vite base URL, catalog boundary,
      no string-to-enum casts, validated and capped JSON, union `default:`,
      immutable snapshots, explicit WebGL2 failure, no hot-loop clones,
      shared helpers, status-message ordering, artwork acceptance, seeded AI
      randomness.
- [ ] Layering stays `renderers/three/ -> app/ -> game/`, with `src/game/`
      pure.
- [ ] Actions stay legal under `isLegalActionForState`, with exact fields
      such as `effectTargetId`.
- [ ] Every value crossing a trust boundary (`localStorage`, recordings, P2P,
      snapshot migrations) is deep-validated before use.
- [ ] Hidden hands stay hidden: shared `players[].handCards` never unredacts
      AI cards; reveals use narrowly scoped fields a rule requires.

### Performance

- [ ] No per-candidate or per-frame deep copies, and no full-state JSON
      serialization on frequent actions; large `localStorage` writes happen
      at commit boundaries.
- [ ] Three.js keeps retained registries, bounded caches and pure layout:
      no meshes, geometries, materials, textures or markup rebuilt per frame.
- [ ] Logs, recordings, replays, target pickers and accessibility mirrors
      are capped or culled.
- [ ] Listeners, observers, frames, timers, GPU resources, pointer capture
      and temporary presentations are released on failure, unmount, lobby,
      replay exit and new game.
- [ ] Reduced-quality and reduced-motion paths never change rules, queue
      order, completion or user decisions.

### User experience

- [ ] The board and native HTML controls stay at parity: legal actions,
      settings, replay, Adventure, install UI, animations, card style.
- [ ] Portrait and landscape mobile layouts stay usable, with safe areas,
      touch targets, and semantic and keyboard alternatives.
- [ ] Error, fallback and empty states say what failed and what remains.
- [ ] UI findings name a concrete regression: clipping, overlap, contrast,
      lost focus, stale render state, duplicate IDs, broken fallback art or
      inaccessible controls.

### Deployment, tests and validation

- [ ] Service-worker caching and base-path rules hold
      ([service-worker-and-pwa](../../../docs/agent/service-worker-and-pwa.md)).
- [ ] Behavior changes add focused tests under `src/test/` that follow
      [testing](../../../docs/agent/testing.md); no unrelated test is
      removed or weakened.
- [ ] The description reports real validation outcomes
      ([rules](../../../docs/agent/pr-workflow.md#validation-status)).

## Tools and comments

- GitHub MCP gives PR metadata, files, linked issues, threads and checks;
  use Playwright MCP when UI flows, screenshots, install or offline behavior
  are in scope. Neither is required for every review.
- One actionable finding per comment: state the user-visible or correctness
  impact, the smallest affected area and the expected pattern or doc. Make
  tool-derived findings self-contained.
- When a concern depends on unverified runtime behavior, ask for evidence
  instead of asserting a bug.
