import { bench, describe } from 'vitest'
import { isLegalActionForState } from '../app/action-validation'
import { chooseAiAction } from '../game/ai'
import { createInitialGame } from '../game/engine'
import type { BattlefieldCard, Card, GameAction, GameState } from '../game/types'

// Performance gates on the fixed scenario below, run with:
//   npm run test:bench
//
// `scripts/check-ai-bench.mjs` holds one baseline per benchmark and allows a
// 50% slowdown over it to absorb routine CI variance while still catching
// hot-loop allocation regressions. Two levels are gated:
//
// - Advanced: the one-ply strategic choice.
// - Hard: the determinized search at its default budget. The scenario is
//   critical (the opponent holds the winning land), so this is the full
//   search of all 13 action classes with 12 worlds, played by best estimate.
//
// Baselines follow the reference of the original 0.55 ms/op gate for the
// one-ply Hard, which ran at 0.26 ms/op in the 2-vCPU dev container and
// 0.28-0.40 ms/op on GitHub's ubuntu-24.04 runners: each baseline is its
// dev-container mean times 2.1. Measured means over three idle runs were
// Advanced 0.255 ms/op (baseline 0.55) and Hard 6.76 ms/op (baseline 14).
// Refresh them only after intentional AI-performance work, measured with
// `KEEP_AI_BENCH_REPORT=1 npm run test:bench`, and update the script and this
// comment in the same PR.
//
// This complements `ai-no-state-clone.test.ts`: that test statically bans
// `structuredClone` call sites in AI hot-loop modules, while this benchmark
// catches runtime regressions such as new per-candidate allocations or large
// array spreads.

let actionSink: GameAction | null = null

const SCENARIO_SEED = 90605

function land(id: string, name: Card['name']): Card {
  return { id, name, type: 'land' }
}

function battlefield(instanceId: string, name: Card['name']): BattlefieldCard {
  return { instanceId, card: land(`${instanceId}-card`, name) }
}

function buildAiPerformanceScenario(): GameState {
  const state = createInitialGame(SCENARIO_SEED)
  state.currentPlayer = 0
  state.phase = 'main'
  state.pendingLandPlay = null
  state.pendingPlainsReuse = null
  state.winner = null
  state.players[0].landsPlayedThisTurn = 0
  state.players[1].landsPlayedThisTurn = 0

  state.players[0].hand = [
    land('ai-forest', 'Forest'),
    land('ai-mountain', 'Mountain'),
    land('ai-swamp', 'Swamp'),
    land('ai-plains', 'Plains'),
    land('ai-island', 'Island'),
  ]
  state.players[0].battlefield = [
    battlefield('ai-bf-forest', 'Forest'),
    battlefield('ai-bf-mountain', 'Mountain'),
    battlefield('ai-bf-swamp', 'Swamp'),
  ]
  state.players[0].graveyard = [
    land('ai-gy-forest', 'Forest'),
    land('ai-gy-mountain', 'Mountain'),
    land('ai-gy-swamp', 'Swamp'),
  ]
  state.players[0].deck = [land('ai-deck-island', 'Island')]

  state.players[1].hand = [
    land('opp-hand-forest', 'Forest'),
    land('opp-hand-mountain', 'Mountain'),
    land('opp-hand-swamp', 'Swamp'),
    land('opp-hand-plains', 'Plains'),
    land('opp-hand-win', 'Swamp'),
  ]
  state.players[1].battlefield = [
    battlefield('opp-bf-forest', 'Forest'),
    battlefield('opp-bf-island', 'Island'),
    battlefield('opp-bf-mountain', 'Mountain'),
    battlefield('opp-bf-plains', 'Plains'),
  ]
  state.players[1].graveyard = []
  state.players[1].deck = [land('opp-deck-forest', 'Forest')]

  return state
}

const scenario = buildAiPerformanceScenario()
const BENCH_OPTIONS = {
  iterations: 100,
  time: 200,
  warmupIterations: 20,
  warmupTime: 50,
}

for (const level of ['advanced', 'hard'] as const) {
  const initialAction = chooseAiAction(scenario, 0, { level, seed: SCENARIO_SEED })
  if (!initialAction || !isLegalActionForState(scenario, initialAction)) {
    throw new Error(`AI performance scenario must produce a legal ${level}-level action`)
  }
}

describe('AI performance gate', () => {
  bench('advanced ai chooses from targeted scenario', () => {
    actionSink = chooseAiAction(scenario, 0, { level: 'advanced', seed: SCENARIO_SEED })
  }, BENCH_OPTIONS)

  bench('hard ai search chooses from targeted scenario', () => {
    actionSink = chooseAiAction(scenario, 0, { level: 'hard', seed: SCENARIO_SEED })
  }, BENCH_OPTIONS)
})

void actionSink
