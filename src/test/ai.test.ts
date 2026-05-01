import { describe, expect, it } from 'vitest'
import { chooseAiAction } from '../game/ai'
import { applyAction, createInitialGame } from '../game/engine'

describe('ai', () => {
  it('prioritizes playing lands in main phase', () => {
    const state = createInitialGame(77)
    const action = chooseAiAction(state, 0)
    expect(action?.type).toBe('play_land')
  })

  it('uses island counter in response phase when available', () => {
    let state = createInitialGame(77)
    state.players[0].hand = [{ id: 'p0-play', name: 'Forest', type: 'land' }]
    state.players[1].hand = [
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-other', name: 'Swamp', type: 'land' },
    ]
    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'p0-play' })

    const action = chooseAiAction(state, 1)
    expect(action?.type).toBe('counter_land')
  })
})
