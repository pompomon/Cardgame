import { describe, expect, it } from 'vitest'
import { applyAction, createInitialGame } from '../game/engine'

describe('engine', () => {
  it('allows one land play per turn', () => {
    let state: ReturnType<typeof createInitialGame> | undefined

    for (let seed = 0; seed < 1000; seed += 1) {
      const candidate = createInitialGame(seed)
      const landsInHand = candidate.players[0].hand.filter((card) => card.type === 'land')
      if (landsInHand.length >= 2) {
        state = candidate
        break
      }
    }

    expect(state).toBeTruthy()

    const firstLand = state!.players[0].hand.find((card) => card.type === 'land')
    expect(firstLand).toBeTruthy()

    state = applyAction(state!, { type: 'play_land', actor: 0, cardId: firstLand!.id })
    const secondLand = state.players[0].hand.find((card) => card.type === 'land')
    expect(secondLand).toBeTruthy()

    const next = applyAction(state, { type: 'play_land', actor: 0, cardId: secondLand!.id })
    expect(next.players[0].battlefield.filter((entry) => entry.card.type === 'land')).toHaveLength(1)
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

  it('generates deterministic battlefield instance ids', () => {
    let first = createInitialGame(2026)
    let second = createInitialGame(2026)

    const firstLand = first.players[0].hand.find((card) => card.type === 'land')
    const secondLand = second.players[0].hand.find((card) => card.type === 'land')
    expect(firstLand).toBeTruthy()
    expect(secondLand).toBeTruthy()

    first = applyAction(first, { type: 'play_land', actor: 0, cardId: firstLand!.id })
    second = applyAction(second, { type: 'play_land', actor: 0, cardId: secondLand!.id })

    expect(first.players[0].battlefield[0]?.instanceId).toBe(second.players[0].battlefield[0]?.instanceId)
  })

  it('rejects invalid actors during blocker declaration', () => {
    let state = createInitialGame(99)
    state = applyAction(state, { type: 'end_main', actor: 0 })
    state = applyAction(state, { type: 'declare_attackers', actor: 0, attackerIds: [] })

    const before = structuredClone(state)
    state = applyAction(state, { type: 'declare_blockers', actor: 2, blocks: {} })

    expect(state).toEqual(before)
    expect(state.phase).toBe('declareBlockers')
  })
})
