import { describe, expect, it } from 'vitest'
import { applyAction, createInitialGame } from '../game/engine'

describe('engine', () => {
  it('allows one land play per turn', () => {
    let state = createInitialGame(11)
    const land = state.players[0].hand.find((card) => card.type === 'land')
    expect(land).toBeTruthy()

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: land!.id })
    const secondLand = state.players[0].hand.find((card) => card.type === 'land')
    if (secondLand) {
      const next = applyAction(state, { type: 'play_land', actor: 0, cardId: secondLand.id })
      expect(next.players[0].battlefield.filter((entry) => entry.card.type === 'land')).toHaveLength(1)
    }
  })

  it('resolves unblocked combat damage', () => {
    let state = createInitialGame(123)

    for (let index = 0; index < 3; index += 1) {
      const land = state.players[0].hand.find((card) => card.type === 'land')
      if (land) {
        state = applyAction(state, { type: 'play_land', actor: 0, cardId: land.id })
      }
      const creature = state.players[0].hand.find((card) => card.type === 'creature' && card.cost <= state.players[0].battlefield.filter((entry) => entry.card.type === 'land' && !entry.tapped).length)
      if (creature) {
        state = applyAction(state, { type: 'cast_creature', actor: 0, cardId: creature.id })
      }
      state = applyAction(state, { type: 'end_main', actor: 0 })
      state = applyAction(state, { type: 'declare_attackers', actor: 0, attackerIds: [] })
      state = applyAction(state, { type: 'declare_blockers', actor: 1, blocks: {} })
      const otherLand = state.players[1].hand.find((card) => card.type === 'land')
      if (otherLand) {
        state = applyAction(state, { type: 'play_land', actor: 1, cardId: otherLand.id })
      }
      state = applyAction(state, { type: 'end_main', actor: 1 })
      state = applyAction(state, { type: 'declare_attackers', actor: 1, attackerIds: [] })
      state = applyAction(state, { type: 'declare_blockers', actor: 0, blocks: {} })
    }

    const attackers = state.players[0].battlefield
      .filter((entry) => entry.card.type === 'creature' && !entry.summoningSickness)
      .map((entry) => entry.instanceId)

    state = applyAction(state, { type: 'end_main', actor: 0 })
    state = applyAction(state, { type: 'declare_attackers', actor: 0, attackerIds: attackers })
    state = applyAction(state, { type: 'declare_blockers', actor: 1, blocks: {} })

    expect(state.players[1].life).toBeLessThan(20)
  })
})
