import { describe, expect, it } from 'vitest'
import { chooseAiAction } from '../game/ai'
import { applyAction, createInitialGame, getLegalActions } from '../game/engine'
import type { BattlefieldCard } from '../game/types'

describe('ai', () => {
  it('basic level plays the first legal action', () => {
    const state = createInitialGame(77)
    const legal = getLegalActions(state, 0)
    const action = chooseAiAction(state, 0, { level: 'basic' })
    expect(action).toEqual(legal[0])
  })

  it('advanced level chooses an immediate winning move when available', () => {
    const state = createInitialGame(80)
    state.players[0].hand = [{ id: 'p0-win', name: 'Island', type: 'land' }]
    state.players[0].battlefield = [
      { instanceId: 'p0-1', card: { id: 'bf-forest', name: 'Forest', type: 'land' } },
      { instanceId: 'p0-2', card: { id: 'bf-mountain', name: 'Mountain', type: 'land' } },
      { instanceId: 'p0-3', card: { id: 'bf-plains', name: 'Plains', type: 'land' } },
      { instanceId: 'p0-4', card: { id: 'bf-swamp', name: 'Swamp', type: 'land' } },
    ] satisfies BattlefieldCard[]
    state.players[1].hand = []

    const action = chooseAiAction(state, 0, { level: 'advanced' })

    expect(action?.type).toBe('play_land')
    expect(action).toMatchObject({ actor: 0, cardId: 'p0-win' })
    const next = action ? applyAction(state, action) : state
    expect(next.winner).toBe(0)
  })

  it('advanced level prioritizes disruption when opponent is near-win', () => {
    const state = createInitialGame(81)
    state.players[0].hand = [
      { id: 'p0-first', name: 'Forest', type: 'land' },
      { id: 'p0-disrupt', name: 'Mountain', type: 'land' },
    ]
    state.players[1].hand = []
    state.players[1].battlefield = [
      { instanceId: 'p1-1', card: { id: 'p1-forest', name: 'Forest', type: 'land' } },
      { instanceId: 'p1-2', card: { id: 'p1-island', name: 'Island', type: 'land' } },
      { instanceId: 'p1-3', card: { id: 'p1-mountain', name: 'Mountain', type: 'land' } },
      { instanceId: 'p1-4', card: { id: 'p1-plains', name: 'Plains', type: 'land' } },
    ] satisfies BattlefieldCard[]

    const action = chooseAiAction(state, 0, { level: 'advanced' })

    expect(action?.type).toBe('play_land')
    expect(action).toMatchObject({ actor: 0, cardId: 'p0-disrupt' })
  })

  it('hard level uses opponent hand information for targeted disruption', () => {
    let state = createInitialGame(77)
    state.players[0].hand = [{ id: 'ai-swamp', name: 'Swamp', type: 'land' }]
    state.players[1].hand = [
      { id: 'safe-card', name: 'Forest', type: 'land' },
      { id: 'winning-card', name: 'Swamp', type: 'land' },
    ]
    state.players[1].battlefield = [
      { instanceId: 'p1-1', card: { id: 'p1-forest', name: 'Forest', type: 'land' } },
      { instanceId: 'p1-2', card: { id: 'p1-island', name: 'Island', type: 'land' } },
      { instanceId: 'p1-3', card: { id: 'p1-mountain', name: 'Mountain', type: 'land' } },
      { instanceId: 'p1-4', card: { id: 'p1-plains', name: 'Plains', type: 'land' } },
    ] satisfies BattlefieldCard[]

    const advancedAction = chooseAiAction(state, 0, { level: 'advanced' })
    const hardAction = chooseAiAction(state, 0, { level: 'hard' })
    const legal = getLegalActions(state, 0)

    expect(advancedAction).toMatchObject({ type: 'play_land', actor: 0, cardId: 'ai-swamp' })
    expect(hardAction).toMatchObject({ type: 'play_land', actor: 0, cardId: 'ai-swamp' })
    if (advancedAction?.type === 'play_land' && hardAction?.type === 'play_land') {
      expect(advancedAction.effectTargetId).toBeDefined()
      expect(legal).toContainEqual(advancedAction)
      expect(hardAction.effectTargetId).toBe('winning-card')
    }
  })
})
