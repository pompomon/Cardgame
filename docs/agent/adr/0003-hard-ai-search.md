# ADR 0003: Seeded search for the Hard AI

- Status: Accepted
- Date: 2026-11-09
- Supersedes: —
- Superseded by: —

## Context

Hard used Advanced's one-step scorer (`chooseStrategicAction`) with full
visibility. It was deterministic, so the same position always produced the same
move, and it was no stronger than Advanced: 50.2% [45.4%, 55.1%] over 400
mirrored games. It also scored draws with each deck's real top card, which no
player can see, and it broke ties by card order: 35.9% of re-run decisions chose
a different kind of move when only the order of cards within zones changed.

The goal was a Hard level that varies from game to game without throwing games
away and that looks further ahead. AI code must stay pure and reproducible:
tests, CLI fixtures, recordings, and Adventure pause and resume depend on it.
Decisions run synchronously on the main thread, and
`structuredClone(GameState)` is banned in AI hot loops.

## Decision

Hard is a determinized Monte-Carlo search with seeded selection
(`src/game/ai-hard.ts`); the registry entry in `src/game/ai-policies/hard.ts`
points at it. Basic and Advanced are unchanged.

### Information model

Hard keeps the documented visibility: both hands and every public zone. It never
uses deck order. `projectKnowledge` reduces each deck to a multiset and
`determinize` samples orders ("worlds"). Rollouts mask the card an Island draws
and score End Turn before its draw. The rollout model of the opponent does not
see Hard's hand, as a human opponent cannot, except when it chooses a Swamp
discard, direct or reused by Plains. The game reveals Hard's hand to a human for
that choice, so the model picks the discard with the full hand.

Deciding whether to play the Swamp stays blind. Before the reveal, the model
values a Swamp at the best discard it can expect. The evaluator counts a hidden
hand only by size, so a discard's blind value depends only on the card's name.
Each name is weighted by the chance that it is the best name in a hand dealt
from Hard's hand and deck. Tests check that redealing Hard's hidden cards
changes no blind choice outside the discard itself.

### Search

`searchActionValues` groups legal actions into canonical classes (the same move
with interchangeable cards). In each world it applies every class and plays a
rollout of up to four turns with an ε-greedy policy (ε = 0.15) driven by the
fitted evaluator in `ai-features.ts` and `ai-weights.ts`. All classes in a world
share one random stream (common random numbers), so differences come from the
actions rather than luck. Above four classes, sequential halving keeps three
finalists. Only the first world is guaranteed: a counter of engine steps, not a
clock, decides whether later worlds fit. A rollout cut off by its step limit
first finishes any counter window and the target choice after it, because the
engine checks for a win only once they resolve. A search takes at most
max(6000, 16 × classes) steps plus about one rollout decision per class, and
the counter window and target choice that decision may leave.

Before sampling worlds, the search checks each class for a win the opponent
cannot answer. A Swamp, or a Plains reusing a land that needs a target, wins
only after the player's own target choice, so the check resolves that choice. A
counter window is an answer, so a land the opponent can counter is searched.

Search states advance through `applyActionForSearch`, which copies only what the
engine mutates and is checked against `applyAction` by parity tests. AI modules
contain no `structuredClone`.

### Selection

`decisionCriticality` is 1 when either player is at four lands of a winning set,
a deck holds two cards or fewer, or the game is over. Below that it is 0, 0,
0.25 or 0.5 for the furthest player's progress of zero to three lands.

`selectSearchedClass` applies rails first: a single class, then a class that
wins before the opponent can answer, then the best estimate at criticality 1.
Critical positions are also searched with a fixed seed and the balanced weights,
so every game plays them identically. Otherwise Hard samples among finalists
whose estimate trails the best by at most 0.02 win probability, with a softmax
over the gaps whose temperature is 0.015 × (1 − criticality).

Each seat draws a persona from the game seed for the whole game:

- balanced
- racer, with progress features × 1.15
- controller, with counter and disruption features × 1.2
- hoarder, with hand and reuse features × 1.2

Personas change only Hard's own calm-position evaluation; its model of the
opponent keeps the fitted weights.

### Determinism contract

- Randomness comes only from `src/game/ai-random.ts` (mulberry32 with separate
  search, selection and persona streams). AI modules never call `Math.random`,
  read a clock, or use `crypto`; a static test enforces this.
- `chooseAiAction(state, actor, { level, seed, budget })` returns the same action
  for the same state, seat, seed and budget, including after a JSON round trip.
  `decisionFingerprint` hashes zones as sorted multisets and ignores deck order
  and logs; canonical classes make the choice independent of card order within
  zones.
- The controller and CLI pass the game seed. In Adventure that is the attempt
  seed, which pause and resume keep. A retry after a loss or draw derives a new
  attempt seed and therefore new variety. Recordings store actions, so replays
  never run the AI.

### Budget

`HARD_AI_DEFAULT_BUDGET` is 12 worlds, 4 rollout turns, ε 0.15 and 6,000 engine
steps. Twelve worlds won 55.2% [51.2%, 59.1%] against eight for about 1.4× the
time.

## Measurements

All matches were mirrored over the same seeds. Latency was measured in Node 24
on a 2-vCPU dev container. Adventure seating gives Hard the Adventure deck and
the stand-in player (Advanced) the starter deck. The tables and bullets below
use the registered Hard level with the version 2 weights, the win check, and
rollouts that finish pending decisions.

| Match | Games | Hard's score [95% Wilson] |
| --- | --- | --- |
| vs legacy Hard | 600 | 88.8% [86.1%, 91.1%] |
| vs Advanced | 600 | 90.2% [87.5%, 92.3%] |
| vs Basic | 600 | 95.2% [93.1%, 96.6%] |
| vs the same search playing its best estimate | 600 | 49.0% [45.0%, 53.0%] |

| Adventure deck (vs Advanced on starter) | Legacy Hard | New Hard |
| --- | --- | --- |
| starter | 49.5% | 92.8% [89.8%, 94.9%] |
| standard | 53.3% | 90.5% [87.2%, 93.0%] |
| dual | 49.8% | 65.8% [61.0%, 70.2%] |
| random | 48.8% | 91.3% [88.1%, 93.6%] |
| mono boss | 54.0% | 53.0% [48.1%, 57.8%] |

Every Adventure row had 400 games. The mono-deck difference is within noise.

| Behaviour | Legacy Hard, vs Advanced | New Hard, vs legacy Hard |
| --- | --- | --- |
| Calm decisions that vary across 8 game seeds | 0% (0 of 1,138) | 70.8% (1,444 of 2,039) |
| Critical decisions that vary across game seeds | 0% (0 of 543) | 0% (0 of 798) |
| Decisions changed by card order within zones | 35.9% (604 of 1,681) | 0% |
| Choices worse than a 4×-budget re-search by more than 0.05 | 29.5% (496 of 1,681) | 2.7% (76 of 2,837) |

The win check and rollout finishing left the level, Adventure and persona
results unchanged, moved the best-estimate match by one game, and shortened
games by 0.1 turns on average. In 865 calm states from 60 games, Hard chose the
same class before and after them with each of 4 game seeds. Nine of 316
critical states changed, all between classes that win before the opponent can
answer. The behaviour diagnostics re-run every fourth decision across all
games, so games that end sooner change which states they sample. Before rollout
finishing, no rollout reached its step limit in 16,236 rollouts at the default
budget; at 1,500 steps, 0.7% of rollouts were scored in a pending decision,
affecting 11.6% of searched decisions.

- **Weights:** version 2 was fitted on 4,000 self-play games that cover every
  mono and dual deck. Its held-out log-loss is 0.5850 against 0.5893 for
  version 1, and 0.4188 against 0.4553 on mono decks. The search with version
  2 scored 52.4% [50.1%, 54.7%] against the search with version 1 over 1,800
  mirrored games on starter, mono and dual decks.
- **Personas:** each scored 89.7% to 90.2% against legacy Hard. Against
  balanced, the others scored 48.5% to 51.2%, so none dominates.
- **Latency per searched decision:** mean 3.54 ms, p95 7.42 ms, maximum 19 ms
  over 949 states. The first decision in a fresh process took 24 to 36 ms
  because of JIT compilation. Tournament jobs sharing both vCPUs saw single
  decisions of up to 731 ms; the same 600 games run alone peaked at 37 ms.
- **Benchmark:** the critical benchmark scenario (13 classes, 12 worlds) takes
  6.3 to 8.3 ms over seven runs, no slower than before the win check; Advanced
  takes 0.26 ms on the same scenario.

The planned gate of at most 2% blunders is unreachable for this search even
without sampling: with the version 1 weights, playing the best estimate scored
3.8%, 2.9% and 2.2% at 8, 12 and 16 worlds against an oracle noise floor of
0.6%. The gate is restated as "seeded selection adds at most 0.5 percentage
points over the best estimate at the same budget". On 505 states, each decided
with 8 game seeds at the default budget, it adds 0.45 points (2.57% to 3.02%)
and raises calm variety from 60.1% to 67.6%.

The weights comparison was measured before the win check and rollout finishing.
The budget comparison, the rollout depths and the alternative opponent model
were measured with the version 1 weights, before the Swamp reveal, and were not
repeated.

## Alternatives considered

- **Noise on the one-step scorer.** Adds variety without strength, reads as
  blunders, and keeps the deck-top peek.
- **`Math.random` or time budgets.** Breaks fixtures, tests and pause and
  resume, and makes decisions depend on the device.
- **A Web Worker first.** Desktop latency fits a frame; the worker adds stale
  reply and cancellation handling. It remains a follow-up.
- **Full information-set MCTS now.** Strategy fusion matters little while Hard
  sees both hands; it belongs with a hand-blind "fair" Hard.
- **Sampling any class whose confidence interval overlaps the best.** Measured
  against a larger search, it only added mistakes.
- **Other rollout depths.** Against four turns, two turns scored 45.2%
  [41.2%, 49.2%] and six turns 46.3% [42.4%, 50.3%].
- **An opponent model that always sees Hard's hand.** 52.3%, not significant,
  and less realistic.

## Consequences

### Positive

- Hard is clearly stronger and plays differently from game to game in calm
  positions, while meeting decisive positions the same way every time.
- Hard no longer uses deck order.
- Decisions are reproducible from the game seed, bounded by a step cap, and
  measurable with the opt-in `ai:tournament` and `ai:tune` tools.

### Negative

- Adventure on Hard is much harder: the lobby's level applies to every
  encounter.
- A stronger AI that sees the player's hand can feel unfair.
- Hard takes about 25 times Advanced's CPU time per decision, and more on
  low-end mobile devices. Its benchmark gate is separate from Advanced's.
- Weight, budget, selection, or persona changes alter Hard's choices and
  require regenerating the Hard CLI fixture.

## Compatibility

Rules, saves, recordings, P2P payloads and settings are unchanged. Basic and
Advanced make the same choices as before; their CLI fixtures are byte-identical.
The Hard CLI fixture was regenerated with search provenance. Saved Adventure
games resume normally; the new Hard plays from the restored state.

Follow-ups are listed in
[`docs/implementation/hard-ai-search-roadmap.md`](../../implementation/hard-ai-search-roadmap.md).

## Related documents

- [`docs/agent/architecture.md`](../architecture.md#ai-decisions) — AI data flow.
- [`docs/agent/testing.md`](../testing.md#seeded-ai-and-the-hard-search) — AI
  test contract and tools.
- [`ADR 0001`](0001-layering.md) — `src/game/` stays pure.
