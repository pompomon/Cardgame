import { describe, expect, it } from 'vitest'
import { applyAction, createInitialGame, getLegalActions } from '../game/engine'
import { encodePlainsTargeting } from '../game/plains-targeting'
import type { BasicLand, GameAction } from '../game/types'

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

  it('plains reuses the selected own battlefield land effect', () => {
    let state = createInitialGame(24)
    state.players[1].hand = [{ id: 'opp-card', name: 'Forest', type: 'land' }]
    state.players[0].graveyard = [{ id: 'grave-target', name: 'Mountain', type: 'land' }]
    state.players[0].battlefield = [
      { instanceId: 'self-swamp', card: { id: 'self-swamp-card', name: 'Swamp', type: 'land' } },
      { instanceId: 'self-forest', card: { id: 'self-forest-card', name: 'Forest', type: 'land' } },
    ]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]

    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'plains-play',
      effectTargetId: 'self-forest',
    })

    expect(state.players[0].hand.some((card) => card.id === 'grave-target')).toBe(true)
    expect(state.players[1].hand.some((card) => card.id === 'opp-card')).toBe(true)
  })

  it('plains emits nested target actions when reusing target-dependent lands', () => {
    const state = createInitialGame(26)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].graveyard = [
      { id: 'grave-a', name: 'Forest', type: 'land' },
      { id: 'grave-b', name: 'Mountain', type: 'land' },
    ]
    state.players[0].battlefield = [
      { instanceId: 'self-forest', card: { id: 'bf-forest', name: 'Forest', type: 'land' } },
      { instanceId: 'self-swamp', card: { id: 'bf-swamp', name: 'Swamp', type: 'land' } },
      { instanceId: 'self-mountain', card: { id: 'bf-mountain', name: 'Mountain', type: 'land' } },
      { instanceId: 'self-island', card: { id: 'bf-island', name: 'Island', type: 'land' } },
    ]
    state.players[1].hand = [
      { id: 'opp-hand-a', name: 'Swamp', type: 'land' },
      { id: 'opp-hand-b', name: 'Plains', type: 'land' },
    ]
    state.players[1].battlefield = [
      { instanceId: 'opp-bf-a', card: { id: 'opp-bf-card-a', name: 'Forest', type: 'land' } },
      { instanceId: 'opp-bf-b', card: { id: 'opp-bf-card-b', name: 'Island', type: 'land' } },
    ]

    const actions = getLegalActions(state, 0).filter(
      (action): action is Extract<GameAction, { type: 'play_land' }> =>
        action.type === 'play_land' && action.cardId === 'plains-play',
    )
    const encodedTargets = new Set(actions.map((action) => action.effectTargetId))

    expect(encodedTargets).toEqual(new Set([
      encodePlainsTargeting('self-forest', 'grave-a'),
      encodePlainsTargeting('self-forest', 'grave-b'),
      encodePlainsTargeting('self-swamp', 'opp-hand-a'),
      encodePlainsTargeting('self-swamp', 'opp-hand-b'),
      encodePlainsTargeting('self-mountain', 'opp-bf-a'),
      encodePlainsTargeting('self-mountain', 'opp-bf-b'),
      encodePlainsTargeting('self-island'),
    ]))
  })

  it('plains can reuse forest with explicit nested graveyard target', () => {
    let state = createInitialGame(27)
    state.players[1].hand = []
    state.players[0].graveyard = [
      { id: 'grave-a', name: 'Swamp', type: 'land' },
      { id: 'grave-b', name: 'Mountain', type: 'land' },
    ]
    state.players[0].battlefield = [
      { instanceId: 'self-forest', card: { id: 'bf-forest', name: 'Forest', type: 'land' } },
    ]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]

    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'plains-play',
      effectTargetId: encodePlainsTargeting('self-forest', 'grave-b'),
    })

    expect(state.players[0].hand.some((card) => card.id === 'grave-b')).toBe(true)
    expect(state.players[0].graveyard.some((card) => card.id === 'grave-b')).toBe(false)
  })

  it('plains can reuse swamp with explicit nested opponent hand target', () => {
    let state = createInitialGame(28)
    state.players[0].battlefield = [
      { instanceId: 'self-swamp', card: { id: 'bf-swamp', name: 'Swamp', type: 'land' } },
    ]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[1].hand = [
      { id: 'opp-a', name: 'Forest', type: 'land' },
      { id: 'opp-b', name: 'Mountain', type: 'land' },
    ]

    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'plains-play',
      effectTargetId: encodePlainsTargeting('self-swamp', 'opp-b'),
    })

    expect(state.players[1].hand.map((card) => card.id)).toEqual(['opp-a'])
    expect(state.players[1].graveyard.some((card) => card.id === 'opp-b')).toBe(true)
  })

  it('plains can reuse mountain with explicit nested enemy battlefield target', () => {
    let state = createInitialGame(29)
    state.players[0].battlefield = [
      { instanceId: 'self-mountain', card: { id: 'bf-mountain', name: 'Mountain', type: 'land' } },
    ]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[1].hand = []
    state.players[1].battlefield = [
      { instanceId: 'opp-a', card: { id: 'opp-card-a', name: 'Forest', type: 'land' } },
      { instanceId: 'opp-b', card: { id: 'opp-card-b', name: 'Island', type: 'land' } },
    ]

    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'plains-play',
      effectTargetId: encodePlainsTargeting('self-mountain', 'opp-b'),
    })

    expect(state.players[1].battlefield.map((entry) => entry.instanceId)).toEqual(['opp-a'])
    expect(state.players[1].graveyard.some((card) => card.id === 'opp-card-b')).toBe(true)
  })

  it('plains can reuse island without nested target', () => {
    let state = createInitialGame(30)
    state.players[1].hand = []
    state.players[0].battlefield = [
      { instanceId: 'self-island', card: { id: 'bf-island', name: 'Island', type: 'land' } },
    ]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    const deckBefore = state.players[0].deck.length

    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'plains-play',
      effectTargetId: encodePlainsTargeting('self-island'),
    })

    expect(state.players[0].deck.length).toBe(deckBefore - 1)
  })

  it('plains nested targeting safely ignores malformed composite target ids', () => {
    let state = createInitialGame(31)
    state.players[0].battlefield = [
      { instanceId: 'self-forest', card: { id: 'bf-forest', name: 'Forest', type: 'land' } },
    ]
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].graveyard = []
    state.players[1].hand = [{ id: 'opp-a', name: 'Forest', type: 'land' }]

    const handBefore = state.players[1].hand.length
    state = applyAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'plains-play',
      effectTargetId: '::bad',
    })

    expect(state.players[1].hand).toHaveLength(handBefore)
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
