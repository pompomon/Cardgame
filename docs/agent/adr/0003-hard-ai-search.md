# ADR 0003: Seeded search for the Hard AI

Status: Accepted, 2026-11-09. See
[AI decisions](../architecture.md#ai-decisions).

## Context

Hard reused Advanced's one-step scorer: no stronger, identical every game,
reading deck tops and breaking ties by card order. AI code must stay pure,
reproducible (tests, fixtures, recordings, resume) and synchronous.

## Decision

Hard is a determinized Monte-Carlo search with seeded selection
(`src/game/ai-hard.ts`). Rejected: scorer noise, `Math.random` or time
budgets, a Web Worker first, full IS-MCTS, confidence-overlap sampling, other
rollout depths, an opponent model always seeing Hard's hand.

### Information model

- Hard sees both hands and public zones, never deck order: `projectKnowledge`
  keeps decks as multisets; `determinize` samples orders ("worlds").
- Rollouts mask the card an Island draws and score End Turn before its draw.
- The opponent model sees Hard's hand only for a Swamp discard (direct or via
  Plains), which the game reveals; redealing Hard's hidden cards changes no
  other blind choice (`src/test/ai-rollout.test.ts`).

### Search

- `searchActionValues` groups legal actions into canonical classes that share
  one random stream per world (common random numbers).
- Rollouts are ε-greedy on the fitted evaluator. Above four classes,
  sequential halving keeps three finalists.
- An engine-step counter (`maxEngineSteps`), never a clock, bounds the
  search: the first world always completes and later ones start only if they
  fit (exact bound in the `src/game/ai-search.ts` header).
- Before sampling, find a class that wins before the opponent can answer,
  after Hard's own target choice; a counter window is an answer.
- `applyActionForSearch` must match `applyAction`
  (`src/test/engine-search-parity.test.ts`).

### Selection

- `decisionCriticality` is 1 at game over, at a deck of two cards or fewer
  or at four lands of a winning set; otherwise it grows with board progress.
- `selectSearchedClass` rails: a single class, an unanswerable win, then the
  best estimate at criticality 1, searched with `CRITICAL_SEARCH_SEED` and
  balanced weights so all games play it alike.
- Calm positions sample finalists within 0.02 win probability of the best by
  softmax over the gaps, temperature 0.015 × (1 − criticality). Sampling may
  add at most 0.5 percentage points of blunders over best-estimate play at
  the same budget (`AI_TOURNAMENT_DIAGNOSTICS=1` audit).
- Each seat keeps one seeded persona per game (balanced, racer, controller or
  hoarder) for its own calm evaluation, never its opponent model.

### Determinism contract

- [Seeded AI randomness](../../../AGENTS.md#seeded-ai-randomness):
  `src/game/ai-random.ts` has separate search, selection and persona streams.
- `chooseAiAction` repeats for the same state, seat, seed and budget, after a
  JSON round trip and with reordered zones (`src/test/ai-hard.test.ts`);
  `decisionFingerprint` sorts zones and ignores deck order and logs.
- Callers pass the game seed: in Adventure the attempt seed, which survives
  pause and resume; a retry derives a new one. Replays never run the AI.

### Budget and performance gate

- `HARD_AI_DEFAULT_BUDGET`: 12 worlds, 4 rollout turns, ε 0.15, 6,000 engine
  steps; 12 worlds beat 8 in 55% of mirrored games for ~1.4× the time.
- `npm run test:bench` fails beyond 1.5× each level's `GATES` baseline in
  `src/test/ai-perf.bench.ts`; Hard's is a full critical search (13 classes,
  12 worlds). Re-baselining:
  [Sequence](../validation-and-build.md#sequence).

## Consequences

- Hard is much stronger, varies in calm positions, costs far more CPU than
  Advanced and makes Adventure much harder.
- Weight, budget, selection or persona changes alter Hard's choices; see
  [Seeded AI and the Hard search](../testing.md#seeded-ai-and-the-hard-search).
- Follow-ups: [roadmap](../../implementation/hard-ai-search-roadmap.md).
  Measurements: `git show da7c3c9:docs/agent/adr/0003-hard-ai-search.md`.
