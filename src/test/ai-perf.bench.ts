import { bench, describe } from 'vitest'
import { chooseAiAction } from '../game/ai'
import { createInitialGame } from '../game/engine'
import type { BattlefieldCard, Card, GameAction, GameState } from '../game/types'

// Baseline captured for T-9 on the fixed scenario below with:
//   npm run test:bench
//
// Current baseline: 0.55 ms/op for `chooseAiAction(..., { level: 'hard' })`
// on a warm local Node 22/Vitest 3 run. The gate in
// `scripts/check-ai-bench.mjs` allows a 50% slowdown (0.825 ms/op) to absorb
// routine CI variance while still catching hot-loop allocation regressions.
// Refresh the baseline only after intentional AI-performance work, and update
// the script threshold and this comment in the same PR.
//
// This complements `ai-no-state-clone.test.ts`: that test statically bans
// `structuredClone` call sites in AI hot-loop modules, while this benchmark
// catches runtime regressions such as new per-candidate allocations or large
// array spreads.

let actionSink: GameAction | null = null

function land(id: string, name: Card['name']): Card {
  return { id, name, type: 'land' }
}

function battlefield(instanceId: string, name: Card['name']): BattlefieldCard {
  return { instanceId, card: land(`${instanceId}-card`, name) }
}

function buildAiPerformanceScenario(): GameState {
  const state = createInitialGame(90605)
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
const initialAction = chooseAiAction(scenario, 0, { level: 'hard' })

if (!initialAction) {
  throw new Error('AI performance scenario must produce a legal hard-level action')
}

describe('AI performance gate', () => {
  bench('hard ai chooses from targeted scenario', () => {
    actionSink = chooseAiAction(scenario, 0, { level: 'hard' })
  }, {
    iterations: 100,
    time: 200,
    warmupIterations: 20,
    warmupTime: 50,
  })
})

void actionSink
