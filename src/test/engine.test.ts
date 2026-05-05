import { describe, expect, it } from 'vitest'
import { applyAction, createInitialGame, getLegalActions } from '../game/engine'
import type { BasicLand } from '../game/types'

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
    state!.players[1].hand = []

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
    state.players[1].hand = [
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-other', name: 'Forest', type: 'land' },
    ]
    const land = state.players[0].hand[0]
    state = applyAction(state, { type: 'play_land', actor: 0, cardId: land.id })

    const before = structuredClone(state)
    state = applyAction(state, { type: 'pass_response', actor: 2 })

    expect(state).toEqual(before)
    expect(state.phase).toBe('respond')
  })

  it('resolves pending land play when opponent passes response', () => {
    let state = createInitialGame(100)
    state.players[1].hand = [
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-other', name: 'Forest', type: 'land' },
    ]

    const land = state.players[0].hand.find((card) => card.type === 'land')
    expect(land).toBeTruthy()

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: land!.id })

    expect(state.phase).toBe('respond')
    expect(state.pendingLandPlay).toBeTruthy()

    state = applyAction(state, { type: 'pass_response', actor: 1 })

    expect(state.pendingLandPlay).toBeNull()
    expect(state.players[0].battlefield.some((entry) => entry.card.id === land!.id)).toBe(true)
  })
  it('wins with domain board condition', () => {
    let state = createInitialGame(13)
    state.players[1].hand = []

    const order: BasicLand[] = ['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']
    for (const name of order) {
      state.players[0].landsPlayedThisTurn = 0
      state.players[0].hand.push({ id: `forced-${name}`, name, type: 'land' })
      state = applyAction(state, { type: 'play_land', actor: 0, cardId: `forced-${name}` })
      if (state.phase === 'respond') {
        state = applyAction(state, { type: 'pass_response', actor: 1 })
      }
    }

    expect(state.phase).toBe('gameOver')
    expect(state.winner).toBe(0)
  })

  it('forest returns the selected graveyard card', () => {
    let state = createInitialGame(21)
    state.players[1].hand = []
    state.players[0].graveyard = [
      { id: 'g-1', name: 'Swamp', type: 'land' },
      { id: 'g-2', name: 'Mountain', type: 'land' },
    ]
    state.players[0].hand = [{ id: 'forest-play', name: 'Forest', type: 'land' }]

    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'forest-play',
      effectTargetId: 'g-1',
    })

    expect(state.players[0].hand.some((card) => card.id === 'g-1')).toBe(true)
    expect(state.players[0].graveyard.some((card) => card.id === 'g-1')).toBe(false)
  })

  it('mountain destroys the selected enemy land', () => {
    let state = createInitialGame(22)
    state.players[1].hand = []
    state.players[0].hand = [{ id: 'mountain-play', name: 'Mountain', type: 'land' }]
    state.players[1].battlefield = [
      { instanceId: 'enemy-a', card: { id: 'e-a', name: 'Forest', type: 'land' } },
      { instanceId: 'enemy-b', card: { id: 'e-b', name: 'Island', type: 'land' } },
    ]

    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'mountain-play',
      effectTargetId: 'enemy-b',
    })

    expect(state.players[1].battlefield.map((entry) => entry.instanceId)).toEqual(['enemy-a'])
    expect(state.players[1].graveyard.some((card) => card.id === 'e-b')).toBe(true)
  })

  it('swamp discards the selected opponent hand card', () => {
    let state = createInitialGame(23)
    state.players[1].hand = [
      { id: 'opp-1', name: 'Forest', type: 'land' },
      { id: 'opp-2', name: 'Mountain', type: 'land' },
    ]
    state.players[0].hand = [{ id: 'swamp-play', name: 'Swamp', type: 'land' }]

    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'swamp-play',
      effectTargetId: 'opp-2',
    })

    expect(state.players[1].hand.map((card) => card.id)).toEqual(['opp-1'])
    expect(state.players[1].graveyard.some((card) => card.id === 'opp-2')).toBe(true)
  })

  it('plains reusing mountain allows selecting enemy battlefield target after uncountered response', () => {
    let state = createInitialGame(24)
    state.players[1].hand = [
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-other', name: 'Forest', type: 'land' },
    ]
    state.players[0].battlefield = [
      { instanceId: 'self-mountain', card: { id: 'self-mountain-card', name: 'Mountain', type: 'land' } },
    ]
    state.players[1].battlefield = [
      { instanceId: 'enemy-a', card: { id: 'enemy-a-card', name: 'Forest', type: 'land' } },
      { instanceId: 'enemy-b', card: { id: 'enemy-b-card', name: 'Island', type: 'land' } },
    ]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]

    const action = getLegalActions(state, 0).find(
      (entry) => entry.type === 'play_land' && entry.cardId === 'plains-play' && entry.effectTargetId === 'self-mountain::enemy-b',
    )
    expect(action).toBeTruthy()

    state = applyAction(state, action!)
    expect(state.phase).toBe('respond')

    state = applyAction(state, { type: 'pass_response', actor: 1 })

    expect(state.players[1].battlefield.map((entry) => entry.instanceId)).toEqual(['enemy-a'])
    expect(state.players[1].graveyard.some((card) => card.id === 'enemy-b-card')).toBe(true)
  })

  it('plains reusing swamp allows selecting enemy hand target after uncountered response', () => {
    let state = createInitialGame(241)
    state.players[1].hand = [
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-other', name: 'Forest', type: 'land' },
      { id: 'p1-discard', name: 'Mountain', type: 'land' },
    ]
    state.players[0].battlefield = [{ instanceId: 'self-swamp', card: { id: 'self-swamp-card', name: 'Swamp', type: 'land' } }]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]

    const action = getLegalActions(state, 0).find(
      (entry) => entry.type === 'play_land' && entry.cardId === 'plains-play' && entry.effectTargetId === 'self-swamp::p1-discard',
    )
    expect(action).toBeTruthy()

    state = applyAction(state, action!)
    expect(state.phase).toBe('respond')

    state = applyAction(state, { type: 'pass_response', actor: 1 })

    expect(state.players[1].hand.map((card) => card.id)).toEqual(['p1-island', 'p1-other'])
    expect(state.players[1].graveyard.some((card) => card.id === 'p1-discard')).toBe(true)
  })

  it('plains reusing forest allows selecting graveyard target after uncountered response', () => {
    let state = createInitialGame(242)
    state.players[1].hand = [
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-other', name: 'Forest', type: 'land' },
    ]
    state.players[0].graveyard = [
      { id: 'grave-a', name: 'Swamp', type: 'land' },
      { id: 'grave-b', name: 'Mountain', type: 'land' },
    ]
    state.players[0].battlefield = [{ instanceId: 'self-forest', card: { id: 'self-forest-card', name: 'Forest', type: 'land' } }]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]

    const action = getLegalActions(state, 0).find(
      (entry) => entry.type === 'play_land' && entry.cardId === 'plains-play' && entry.effectTargetId === 'self-forest::grave-a',
    )
    expect(action).toBeTruthy()

    state = applyAction(state, action!)
    expect(state.phase).toBe('respond')

    state = applyAction(state, { type: 'pass_response', actor: 1 })

    expect(state.players[0].hand.some((card) => card.id === 'grave-a')).toBe(true)
    expect(state.players[0].graveyard.some((card) => card.id === 'grave-a')).toBe(false)
  })

  it('island counter discards the selected additional hand card', () => {
    let state = createInitialGame(25)
    state.players[0].hand = [{ id: 'p0-play', name: 'Forest', type: 'land' }]
    state.players[1].hand = [
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-keep', name: 'Forest', type: 'land' },
      { id: 'p1-discard', name: 'Mountain', type: 'land' },
    ]

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'p0-play' })
    expect(state.phase).toBe('respond')

    state = applyAction(state, { type: 'counter_land', actor: 1, discardCardId: 'p1-discard' })

    expect(state.players[1].graveyard.some((card) => card.id === 'p1-island')).toBe(true)
    expect(state.players[1].graveyard.some((card) => card.id === 'p1-discard')).toBe(true)
    expect(state.players[1].hand.some((card) => card.id === 'p1-keep')).toBe(true)
    expect(state.players[0].graveyard.some((card) => card.id === 'p0-play')).toBe(true)
  })
})
