import { describe, expect, it } from 'vitest'
import { chooseAiAction } from '../game/ai'
import { createInitialGame } from '../game/engine'

describe('ai', () => {
  it('prioritizes playing lands in main phase', () => {
    const state = createInitialGame(77)
    const action = chooseAiAction(state, 0)
    expect(action?.type).toBe('play_land')
  })
})
