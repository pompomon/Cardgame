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
    expect(next.players[0].battlefield).toHaveLength(1)
  })

  it('uses 50-card starter deck with 10 of each basic', () => {
    const state = createInitialGame(123)
    const p1 = state.players[0]
    const all = [...p1.deck, ...p1.hand]
    expect(all).toHaveLength(50)

    const counts = new Map<string, number>()
    for (const card of all) {
      counts.set(card.name, (counts.get(card.name) ?? 0) + 1)
    }

    expect(counts.get('Forest')).toBe(10)
    expect(counts.get('Island')).toBe(10)
    expect(counts.get('Mountain')).toBe(10)
    expect(counts.get('Plains')).toBe(10)
    expect(counts.get('Swamp')).toBe(10)
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

  it('rejects invalid actors during response phase', () => {
    let state = createInitialGame(99)
    const land = state.players[0].hand[0]
    state = applyAction(state, { type: 'play_land', actor: 0, cardId: land.id })

    const before = structuredClone(state)
    state = applyAction(state, { type: 'pass_response', actor: 2 })

    expect(state).toEqual(before)
    expect(state.phase).toBe('respond')
  })

  it('wins with domain board condition', () => {
    let state = createInitialGame(13)
    state.players[1].hand = []

    const order = ['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']
    for (const name of order) {
      state.players[0].hand.push({ id: `forced-${name}`, name, type: 'land' })
      state = applyAction(state, { type: 'play_land', actor: 0, cardId: `forced-${name}` })
      if (state.phase === 'respond') {
        state = applyAction(state, { type: 'pass_response', actor: 1 })
      }
    }

    expect(state.phase).toBe('gameOver')
    expect(state.winner).toBe(0)
  })
})
