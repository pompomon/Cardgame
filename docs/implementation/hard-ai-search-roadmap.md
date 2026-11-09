# Hard AI search roadmap

> [!IMPORTANT]
> This document lists follow-ups to the Hard AI search. It is not evidence that
> any follow-up has been implemented, measured, or verified in a browser.

The delivered design, its measurements and the alternatives rejected are in
[ADR 0003](../agent/adr/0003-hard-ai-search.md).

## Delivered

- [x] Phase 0: opt-in tournament harness, behaviour diagnostics, and a frozen
  legacy Hard baseline
- [x] Phase 1: seeded AI randomness, knowledge projection, action classes, and
  the engine's search path with parity tests
- [x] Phase 2: fitted position evaluator, rollout policy, and the `ai:tune`
  tool
- [x] Phase 3: determinized Monte-Carlo search with a step budget
- [x] Phase 4: seeded selection, deterministic rails, and personas
- [x] Phase 5: registry switch, Hard CLI fixture, benchmark gates, and
  documentation

## Follow-ups

Each item names the evidence that should trigger it.

### Off-main-thread decisions

- **Trigger:** p95 decision latency above 16 ms with 4× or 6× CPU throttling,
  or visible stutter on target devices. Desktop measurements in Node are a
  3.66 ms mean and a 7.50 ms p95, and a fresh page's first decision includes
  JIT warm-up.
- **Shape:** a Web Worker adapter in `src/app/`. Each request carries the
  decision key; the controller drops stale replies and cancels on mode change,
  replay, or pause. Load the worker with
  `new Worker(new URL(...), { type: 'module' })` so Vite keeps the base path and
  the hashed chunk is cached like other assets.
- **Failure:** fall back to the synchronous call. Seeding makes both paths
  choose the same action, so the fallback cannot change play.

### Adventure difficulty

- **Trigger:** player feedback or a target win rate. With Hard selected,
  Adventure opponents beat an Advanced stand-in 90.5% to 92.8% of the time on
  starter, standard and random decks.
- **Shape:** scale the search budget and selection temperature by tier in
  `src/app/`, passing them through `chooseAiAction` options. `src/game/` must
  not learn Adventure terms; a static test enforces this. Selection settings are
  not yet part of `chooseAiAction` options.

### A hand-blind Hard or Expert level

- Track beliefs about the opponent's hand from public events. A counter reveals
  an Island, Swamp discards and Forest returns reveal cards, and hand sizes and
  draw counts are public.
- Sample opponent hands from those beliefs, for example with a particle filter,
  and search with single-observer information-set MCTS to avoid strategy fusion.
- Add it as a new level by following README "Extending with more AI levels",
  or replace Hard's visibility after a product decision.

### Advanced's information leaks

Advanced scores actions by applying them to the real state, so it reads hidden
information:

- Draws use each deck's real top card (`trimDeckForEvaluation` in
  `src/game/ai-evaluation.ts`).
- A land opens a counter window only when the opponent holds an Island, so the
  scored result reveals that.

Fix both in a separate change that regenerates only the Advanced CLI fixture and
re-measures Advanced against Basic and Hard.

### Search quality

- **Exact chance enumeration:** when a class's outcome depends only on the next
  draw, weight each distinct card by its count instead of sampling worlds. This
  lowers variance at the same budget.
- **Weight refits:** after rule or card changes, rerun `npm run ai:tune`, bump
  `HARD_AI_WEIGHTS_VERSION`, and regenerate the Hard CLI fixture (see
  [`docs/agent/testing.md`](../agent/testing.md#seeded-ai-and-the-hard-search)).
