import { describe, expect, it } from 'vitest'
import { applyAction, createInitialGame } from '../game/engine'
import type { Card, GameState } from '../game/types'

function makeDeck(names: Array<Card['name']>): Card[] {
  return names.map((name, index) => ({ id: `card-${name}-${index}`, name, type: 'land' as const }))
}

function findInHand(state: GameState, actor: 0 | 1, name: Card['name']): Card | undefined {
  return state.players[actor].hand.find((card) => card.name === name)
}

describe('engine LogEvent stream', () => {
  it('emits game_started + draws + game_start_skip_draw at init', () => {
    const state = createInitialGame(123)
    expect(state.events[0]).toEqual({ kind: 'game_started' })
    expect(state.events.some((event) => event.kind === 'draw')).toBe(true)
    expect(state.events[state.events.length - 1]).toEqual({ kind: 'game_start_skip_draw', actor: 0 })
  })

  it('keeps log strings and structured events in lock-step', () => {
    const state = createInitialGame(7)
    expect(state.events).toHaveLength(state.log.length)
  })

  it('emits play_land and ability_forest_return events together when reusing a Forest', () => {
    const p0Deck = makeDeck(['Plains', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'])
    const p1Deck = makeDeck(['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'])
    let state = createInitialGame(1, [p0Deck, p1Deck])
    // Send a Forest to graveyard so the next Forest play has a return target.
    const firstForest = findInHand(state, 0, 'Forest')!
    state.players[0].graveyard.push({ id: 'gy-forest', name: 'Forest', type: 'land' })
    const before = state.events.length
    state = applyAction(state, { type: 'play_land', actor: 0, cardId: firstForest.id, effectTargetId: 'gy-forest' })
    const newEvents = state.events.slice(before)
    expect(newEvents).toEqual([
      { kind: 'play_land', actor: 0, cardName: 'Forest' },
      { kind: 'ability_forest_return', actor: 0, cardName: 'Forest' },
    ])
  })

  it('emits counter_offered and counter_resolved when an Island counters a land', () => {
    const p0Deck = makeDeck(['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'])
    const p1Deck = makeDeck(['Island', 'Plains', 'Forest', 'Forest', 'Forest', 'Forest'])
    let state = createInitialGame(2, [p0Deck, p1Deck])
    const land = findInHand(state, 0, 'Forest')!
    state = applyAction(state, { type: 'play_land', actor: 0, cardId: land.id })
    expect(state.events.some((event) => event.kind === 'counter_offered')).toBe(true)
    const island = findInHand(state, 1, 'Island')!
    const discard = state.players[1].hand.find((card) => card.id !== island.id)!
    state = applyAction(state, { type: 'counter_land', actor: 1, discardCardId: discard.id })
    const last = state.events[state.events.length - 1]
    expect(last).toEqual({ kind: 'counter_resolved', actor: 1, cardName: 'Forest' })
  })
})
