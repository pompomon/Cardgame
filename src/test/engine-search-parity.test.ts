import { describe, expect, it } from 'vitest'

import { createAiRng } from '../game/ai-random'
import { activeActor, applyAction, applyActionForSearch, getLegalActions } from '../game/engine'
import type { GameState } from '../game/types'
import { deepFreeze } from './helpers/deep-freeze'
import { TEST_DECK_KINDS, createTestGame } from './helpers/seeded-games'

// `applyActionForSearch` shares card and battlefield entries between states
// instead of deep-copying them. That is only safe while the engine never
// writes to those entries or to its input. These games compare it with
// `applyAction` step by step and freeze every search state, so a write to a
// shared object throws.

function withoutLogs(state: GameState): Omit<GameState, 'log' | 'events'> {
  const { log: _log, events: _events, ...rest } = state
  return rest
}

// Compares serialized values first, which is much faster than a deep
// comparison per step; a mismatch falls back to `toEqual` for a readable diff.
function expectSame(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    expect(actual).toEqual(expected)
  }
}

describe('applyActionForSearch', () => {
  it('matches applyAction across random games of every deck kind', () => {
    const phases = new Set<string>()
    let steps = 0
    for (let game = 0; game < 400; game += 1) {
      const kind = TEST_DECK_KINDS[game % TEST_DECK_KINDS.length]
      const rng = createAiRng(game)
      let real = createTestGame(7000 + game, kind)
      let search = deepFreeze(applyActionForSearch(real, { type: 'pass_response', actor: activeActor(real) }))
      expect(withoutLogs(search)).toEqual(withoutLogs(real))
      while (real.phase !== 'gameOver') {
        const actions = getLegalActions(search, activeActor(search))
        expectSame(actions, getLegalActions(real, activeActor(real)))
        const action = actions[rng.nextInt(actions.length)]
        const next = applyAction(real, action)
        search = deepFreeze(applyActionForSearch(search, action))
        expectSame(withoutLogs(search), withoutLogs(next))
        expectSame(search.log, next.log.slice(real.log.length))
        expectSame(search.events, next.events.slice(real.events.length))
        phases.add(next.phase)
        // The search state's log covers one step, so the real log can start
        // over too; this keeps applyAction's deep copies small.
        real = { ...next, log: [], events: [] }
        steps += 1
      }
    }
    expect(steps).toBeGreaterThan(20000)
    expect([...phases].sort()).toEqual(['gameOver', 'main', 'plains_target', 'respond', 'swamp_target'])
  }, 60_000)

  it('leaves its input untouched for every legal action', () => {
    const rng = createAiRng(4)
    let state = createTestGame(12, 'standard')
    for (let step = 0; step < 120 && state.phase !== 'gameOver'; step += 1) {
      const frozen = deepFreeze(structuredClone(state))
      const before = structuredClone(frozen)
      const actions = getLegalActions(frozen, activeActor(frozen))
      for (const action of actions) {
        expect(() => applyActionForSearch(frozen, action)).not.toThrow()
      }
      expect(frozen).toEqual(before)
      state = applyAction(state, actions[rng.nextInt(actions.length)])
    }
  })

  it('ignores an action from the wrong seat like applyAction', () => {
    const state = createTestGame(3, 'starter')
    const result = applyActionForSearch(state, { type: 'end_turn', actor: 1 })
    expect(withoutLogs(result)).toEqual(withoutLogs(state))
    expect(result).not.toBe(state)
  })
})
