---
applyTo: "src/game/**"
---

# Engine and AI

Details: [architecture](../../docs/agent/architecture.md#ai-decisions) and
[ADR 0003](../../docs/agent/adr/0003-hard-ai-search.md).

- `src/game/` imports only other `src/game/` modules and names no Adventure,
  reward or relic concept (`engine.test.ts`, "game engine boundary").
- A change that adds draws, land plays or instance creation must update
  `remainingCounterGrowth()` in `engine.ts`: Adventure mid-game saves need
  `turn` and `nextInstanceId` plus their growth within
  `Number.MAX_SAFE_INTEGER`.
- `lcg()` and `shuffle()` keep only `seed >>> 0`, while `Date.now()` seeds
  exceed 2^32: fold the high bits in when deriving a sub-seed, as
  `ai-random.ts` does.
- For AI search or hot-loop changes, run `npm run test:bench` before the
  build. `ai-perf.bench.ts` fails beyond 1.5× its `GATES` baselines;
  re-baseline only after intentional performance work, in the same PR.
