import { describe, expect, it } from 'vitest'

import { isLegalActionForState } from '../app/action-validation'
import { actionClassKey, canonicalActionClasses } from '../game/ai-action-classes'
import { activeActor, getLegalActions } from '../game/engine'
import type { GameAction, GameState } from '../game/types'
import { TEST_DECK_KINDS, randomDecisionStates, reverseZoneOrder } from './helpers/seeded-games'

function sampleStates(): GameState[] {
  return TEST_DECK_KINDS.flatMap((kind, index) => randomDecisionStates(500 + index, kind, 160))
}

describe('canonicalActionClasses', () => {
  const states = sampleStates()

  it('partitions the legal actions into sorted classes of legal representatives', () => {
    const phases = new Set<string>()
    for (const state of states) {
      const actor = activeActor(state)
      const actions = getLegalActions(state, actor)
      const classes = canonicalActionClasses(state, actions)
      phases.add(state.phase)
      expect(classes.reduce((total, entry) => total + entry.size, 0)).toBe(actions.length)
      const keys = classes.map((entry) => entry.key)
      expect(keys).toEqual([...keys].sort())
      expect(new Set(keys).size).toBe(keys.length)
      for (const entry of classes) {
        expect(actions).toContainEqual(entry.representative)
        expect(isLegalActionForState(state, entry.representative)).toBe(true)
        expect(actionClassKey(state, entry.representative)).toBe(entry.key)
      }
    }
    expect([...phases].sort()).toEqual(['main', 'plains_target', 'respond', 'swamp_target'])
  })

  it('does not depend on the order of cards within zones or of the legal actions', () => {
    // The engine pairs the first Island in hand with each other card, so
    // which Island ids a counter may discard depends on hand order. Those
    // counters discard the same names, so only their ids may differ.
    const withoutCounterIds = (state: GameState) => canonicalActionClasses(state, getLegalActions(state, activeActor(state)).reverse())
      .map((entry) => (entry.representative.type === 'counter_land' ? { key: entry.key, size: entry.size } : entry))
    for (const state of states) {
      expect(withoutCounterIds(reverseZoneOrder(state))).toEqual(withoutCounterIds(state))
    }
  })

  it('merges actions whose cards share names', () => {
    const merged = states.some((state) => {
      const actions = getLegalActions(state, activeActor(state))
      return canonicalActionClasses(state, actions).length < actions.length
    })
    expect(merged).toBe(true)
  })

  it('keys every action type and an unknown type', () => {
    const state = states[0]
    const actor = activeActor(state)
    const keys = getLegalActions(state, actor).map((action) => actionClassKey(state, action))
    expect(keys).toContain('end')
    expect(keys.some((key) => key.startsWith('play|'))).toBe(true)
    expect(actionClassKey(state, { type: 'pass_response', actor })).toBe('pass')
    expect(actionClassKey(state, { type: 'mystery', actor } as unknown as GameAction)).toBe('unknown|mystery')
    expect(actionClassKey(state, { type: 'end_turn', actor: 5 } as unknown as GameAction)).toBe('invalid-actor|5')
  })
})
