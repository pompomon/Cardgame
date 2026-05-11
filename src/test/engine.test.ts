import { describe, expect, it } from 'vitest'
import { applyAction, canAct, createInitialGame, getLegalActions } from '../game/engine'
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

  it('uses explicit deck overrides when provided', () => {
    const playerDeck = Array.from({ length: 50 }, (_, index) => ({
      id: `player-forest-${index}`,
      name: 'Forest' as const,
      type: 'land' as const,
    }))
    const opponentDeck = Array.from({ length: 50 }, (_, index) => ({
      id: `opponent-swamp-${index}`,
      name: 'Swamp' as const,
      type: 'land' as const,
    }))
    const state = createInitialGame(456, [playerDeck, opponentDeck])
    const p0All = [...state.players[0].deck, ...state.players[0].hand]
    const p1All = [...state.players[1].deck, ...state.players[1].hand]
    expect(p0All.every((card) => card.name === 'Forest')).toBe(true)
    expect(p1All.every((card) => card.name === 'Swamp')).toBe(true)
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

    expect(state.phase).toBe('plains_target')
    state = applyAction(state, { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'grave-target' })

    expect(state.players[0].hand.some((card) => card.id === 'grave-target')).toBe(true)
    expect(state.players[1].hand.some((card) => card.id === 'opp-card')).toBe(true)
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

  it('plains to mountain prompts nested target after pass and resolves chosen target', () => {
    let state = createInitialGame(26)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{ instanceId: 'self-mountain', card: { id: 'self-mountain-card', name: 'Mountain', type: 'land' } }]
    state.players[1].hand = [
      { id: 'opp-island', name: 'Island', type: 'land' },
      { id: 'opp-forest', name: 'Forest', type: 'land' },
    ]
    state.players[1].battlefield = [
      { instanceId: 'enemy-a', card: { id: 'enemy-a-card', name: 'Forest', type: 'land' } },
      { instanceId: 'enemy-b', card: { id: 'enemy-b-card', name: 'Swamp', type: 'land' } },
    ]

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-mountain' })

    expect(state.phase).toBe('respond')
    state = applyAction(state, { type: 'pass_response', actor: 1 })

    expect(state.phase).toBe('plains_target')
    expect(state.pendingPlainsReuse?.reusedCardName).toBe('Mountain')
    const actions = getLegalActions(state, 0).filter((action) => action.type === 'resolve_plains_reuse')
    expect(actions.map((action) => action.effectTargetId)).toEqual(['enemy-a', 'enemy-b'])

    state = applyAction(state, { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'enemy-b' })
    expect(state.phase).toBe('main')
    expect(state.players[1].battlefield.map((entry) => entry.instanceId)).toEqual(['enemy-a'])
    expect(state.players[1].graveyard.some((card) => card.id === 'enemy-b-card')).toBe(true)
  })

  it('plains to swamp prompts nested target and discards selected card', () => {
    let state = createInitialGame(27)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{ instanceId: 'self-swamp', card: { id: 'self-swamp-card', name: 'Swamp', type: 'land' } }]
    state.players[1].hand = [
      { id: 'opp-1', name: 'Forest', type: 'land' },
      { id: 'opp-2', name: 'Mountain', type: 'land' },
    ]

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-swamp' })
    state = applyAction(state, { type: 'pass_response', actor: 1 })
    expect(state.phase).toBe('plains_target')

    state = applyAction(state, { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'opp-2' })
    expect(state.players[1].hand.map((card) => card.id)).toEqual(['opp-1'])
    expect(state.players[1].graveyard.some((card) => card.id === 'opp-2')).toBe(true)
  })

  it('plains to forest prompts nested target and returns selected graveyard card', () => {
    let state = createInitialGame(28)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{ instanceId: 'self-forest', card: { id: 'self-forest-card', name: 'Forest', type: 'land' } }]
    state.players[0].graveyard = [
      { id: 'g-1', name: 'Mountain', type: 'land' },
      { id: 'g-2', name: 'Swamp', type: 'land' },
    ]
    state.players[1].hand = []

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-forest' })
    state = applyAction(state, { type: 'pass_response', actor: 1 })
    expect(state.phase).toBe('plains_target')

    state = applyAction(state, { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'g-2' })
    expect(state.players[0].hand.some((card) => card.id === 'g-2')).toBe(true)
    expect(state.players[0].graveyard.some((card) => card.id === 'g-2')).toBe(false)
  })

  it('plains to island resolves immediately after pass without plains_target phase', () => {
    let state = createInitialGame(29)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{ instanceId: 'self-island', card: { id: 'self-island-card', name: 'Island', type: 'land' } }]
    state.players[0].deck = [{ id: 'drawn-card', name: 'Forest', type: 'land' }]
    state.players[1].hand = [{ id: 'opp-forest', name: 'Forest', type: 'land' }]

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-island' })
    state = applyAction(state, { type: 'pass_response', actor: 1 })

    expect(state.phase).toBe('main')
    expect(state.pendingPlainsReuse).toBeNull()
    expect(state.players[0].hand.some((card) => card.id === 'drawn-card')).toBe(true)
  })

  it('countering plains prevents plains_target prompt', () => {
    let state = createInitialGame(30)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{ instanceId: 'self-mountain', card: { id: 'self-mountain-card', name: 'Mountain', type: 'land' } }]
    state.players[1].hand = [
      { id: 'opp-island', name: 'Island', type: 'land' },
      { id: 'opp-discard', name: 'Forest', type: 'land' },
    ]

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-mountain' })
    expect(state.phase).toBe('respond')

    state = applyAction(state, { type: 'counter_land', actor: 1, discardCardId: 'opp-discard' })
    expect(state.phase).toBe('main')
    expect(state.pendingPlainsReuse).toBeNull()
    expect(state.players[0].graveyard.some((card) => card.id === 'plains-play')).toBe(true)
  })

  it('only active plains caster can act during plains_target', () => {
    let state = createInitialGame(31)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{ instanceId: 'self-swamp', card: { id: 'self-swamp-card', name: 'Swamp', type: 'land' } }]
    state.players[1].hand = [
      { id: 'opp-1', name: 'Forest', type: 'land' },
      { id: 'opp-2', name: 'Mountain', type: 'land' },
    ]

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-swamp' })
    state = applyAction(state, { type: 'pass_response', actor: 1 })
    expect(state.phase).toBe('plains_target')

    expect(canAct(state, 1)).toBe(false)
    const before = structuredClone(state)
    state = applyAction(state, { type: 'pass_response', actor: 1 })
    expect(state).toEqual(before)
  })

  it('plains_target legal actions only contain resolve_plains_reuse', () => {
    let state = createInitialGame(32)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{ instanceId: 'self-forest', card: { id: 'self-forest-card', name: 'Forest', type: 'land' } }]
    state.players[0].graveyard = [{ id: 'g-1', name: 'Mountain', type: 'land' }]
    state.players[1].hand = []

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-forest' })
    state = applyAction(state, { type: 'pass_response', actor: 1 })
    const legal = getLegalActions(state, 0)
    expect(legal.every((action) => action.type === 'resolve_plains_reuse')).toBe(true)
  })

  it('plains cannot target another plains for reuse', () => {
    const state = createInitialGame(34)
    state.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{ instanceId: 'self-plains', card: { id: 'self-plains-card', name: 'Plains', type: 'land' } }]
    const legal = getLegalActions(state, 0).filter((action) => action.type === 'play_land')
    expect(legal.some((action) => action.cardId === 'plains-play' && action.effectTargetId === 'self-plains')).toBe(false)
  })

  it('default plains reuse path with no effectTargetId matches legacy fallback', () => {
    let state = createInitialGame(33)
    state = {
      ...state,
      phase: 'plains_target',
      pendingLandPlay: null,
      pendingPlainsReuse: { actor: 0, reusedInstanceId: 'self-forest', reusedCardName: 'Forest' },
    }
    state.players[0].graveyard = [
      { id: 'g-1', name: 'Swamp', type: 'land' },
      { id: 'g-2', name: 'Mountain', type: 'land' },
    ]

    state = applyAction(state, { type: 'resolve_plains_reuse', actor: 0 })
    expect(state.players[0].hand.some((card) => card.id === 'g-2')).toBe(true)
  })
})
