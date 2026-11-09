import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStarterDeck, createTutorialDecks, lcg } from '../game/cards'
import {
  DEFAULT_OPENING_HAND_SIZE,
  applyAction,
  canAct,
  createInitialGame,
  getLegalActions,
  remainingCounterGrowth,
  type InitialGameOptions,
} from '../game/engine'
import type { BasicLand, Card, GameState } from '../game/types'
import { compatibilityDecks, compatibilitySeed } from './fixtures/compatibility-scenario'

interface OpeningCase {
  readonly label: string
  readonly seed: number
  readonly decks?: () => [Card[], Card[]]
}

function landDeck(owner: string, land: BasicLand, length: number): Card[] {
  return Array.from({ length }, (_, index) => ({ id: `${owner}-${index}`, name: land, type: 'land' }))
}

/**
 * One case per kind of `createInitialGame` caller: starter decks (normal,
 * CLI, P2P and AI games), tutorial decks, fixed decks (the compatibility
 * replay scenario) and a short deck that runs out during the opening draws.
 */
const DEFAULT_OPENING_CASES: readonly OpeningCase[] = [
  ...[0, 77, 2 ** 31, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER, 1_760_000_000_000].map((seed) => ({
    label: `starter decks, seed ${seed}`,
    seed,
  })),
  { label: 'tutorial decks, seed 1', seed: 1, decks: createTutorialDecks },
  { label: `compatibility decks, seed ${compatibilitySeed}`, seed: compatibilitySeed, decks: compatibilityDecks },
  {
    label: 'three-card opponent deck, seed 5',
    seed: 5,
    decks: () => [landDeck('short-p0', 'Forest', 50), landDeck('short-p1', 'Swamp', 3)],
  },
]

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function openingCharacterization(state: GameState) {
  return {
    sha256: await sha256Hex(JSON.stringify(state)),
    phase: state.phase,
    winner: state.winner,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    nextInstanceId: state.nextInstanceId,
    hands: state.players.map((player) => player.hand.map((card) => `${card.id}:${card.name}`)),
    deckSizes: state.players.map((player) => player.deck.length),
    log: state.log,
  }
}

/** Event kinds in order, with the drawing player for each draw. */
function eventOrder(state: GameState): string[] {
  return state.events.map((event) => (event.kind === 'draw' ? `draw ${event.actor}` : event.kind))
}

function hasShortDeck(entry: OpeningCase): boolean {
  return entry.decks?.().some((deck) => deck.length < DEFAULT_OPENING_HAND_SIZE) ?? false
}

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
    })
    expect(state.phase).toBe('swamp_target')

    state = applyAction(state, {
      type: 'resolve_swamp_discard',
      actor: 0,
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

  it('countering swamp prevents swamp_target prompt and discard resolution', () => {
    let state = createInitialGame(33)
    state.players[0].hand = [{ id: 'swamp-play', name: 'Swamp', type: 'land' }]
    state.players[1].hand = [
      { id: 'opp-island', name: 'Island', type: 'land' },
      { id: 'opp-discard', name: 'Forest', type: 'land' },
      { id: 'opp-keep', name: 'Mountain', type: 'land' },
    ]

    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'swamp-play' })
    expect(state.phase).toBe('respond')

    state = applyAction(state, { type: 'counter_land', actor: 1, discardCardId: 'opp-discard' })
    expect(state.phase).toBe('main')
    expect(state.pendingSwampDiscard).toBeNull()
    expect(state.players[0].graveyard.some((card) => card.id === 'swamp-play')).toBe(true)
    expect(state.players[1].hand.some((card) => card.id === 'opp-keep')).toBe(true)
    expect(state.players[1].hand.some((card) => card.id === 'opp-discard')).toBe(false)
    expect(state.players[1].graveyard.some((card) => card.id === 'opp-discard')).toBe(true)
    expect(state.players[1].graveyard.some((card) => card.id === 'opp-island')).toBe(true)
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

describe('createInitialGame opening hands', () => {
  it('matches the default openings captured before opening-hand options existed', async () => {
    const cases = []
    for (const entry of DEFAULT_OPENING_CASES) {
      cases.push({ label: entry.label, ...await openingCharacterization(createInitialGame(entry.seed, entry.decks?.())) })
    }

    // `sha256` covers the exact JSON of each state, key order included. The
    // other fields make a change readable. Calls without options must keep
    // matching this file byte for byte.
    await expect(JSON.stringify({
      provenance: {
        kind: 'default-initial-game-characterization',
        capturedRevision: 'ae4bd91',
        note: 'Captured on the engine before createInitialGame accepted opening-hand options.',
      },
      cases,
    }, null, 2)).toMatchFileSnapshot('./fixtures/engine-initial-game.characterization.json')
  })

  it('keeps the default opening when the options are omitted, empty or [5, 5]', () => {
    expect(DEFAULT_OPENING_HAND_SIZE).toBe(5)
    for (const entry of DEFAULT_OPENING_CASES) {
      const expected = JSON.stringify(createInitialGame(entry.seed, entry.decks?.()))
      expect(JSON.stringify(createInitialGame(entry.seed, entry.decks?.(), {})), entry.label).toBe(expected)
      expect(JSON.stringify(createInitialGame(entry.seed, entry.decks?.(), { openingHandSizes: undefined })), entry.label)
        .toBe(expected)
      const explicit = () => createInitialGame(entry.seed, entry.decks?.(), { openingHandSizes: [5, 5] })
      if (hasShortDeck(entry)) {
        // Only the default keeps the historical loss from an empty deck; an
        // explicit count must fit the deck.
        expect(explicit, entry.label).toThrow(RangeError)
      } else {
        expect(JSON.stringify(explicit()), entry.label).toBe(expected)
      }
    }
  })

  it.each([6, 8])('changes only player 0 when the hand sizes are [%i, 5]', (size) => {
    const extra = size - DEFAULT_OPENING_HAND_SIZE
    const pairs = Array.from({ length: DEFAULT_OPENING_HAND_SIZE }, () => ['draw 0', 'draw 1']).flat()
    for (const entry of DEFAULT_OPENING_CASES.filter((candidate) => !hasShortDeck(candidate))) {
      const base = createInitialGame(entry.seed, entry.decks?.())
      const state = createInitialGame(entry.seed, entry.decks?.(), { openingHandSizes: [size, 5] })
      const extraCards = base.players[0].deck.slice(0, extra)

      expect(state.players[0].hand, entry.label).toEqual([...base.players[0].hand, ...extraCards])
      expect(state.players[0].deck, entry.label).toEqual(base.players[0].deck.slice(extra))
      expect(state.players[1], entry.label).toEqual(base.players[1])
      for (const key of ['turn', 'currentPlayer', 'nextInstanceId', 'phase', 'winner', 'pendingLandPlay', 'pendingPlainsReuse', 'pendingSwampDiscard'] as const) {
        expect(state[key], `${entry.label}: ${key}`).toEqual(base[key])
      }
      expect(eventOrder(state), entry.label).toEqual([
        'game_started',
        ...pairs,
        ...Array.from({ length: extra }, () => 'draw 0'),
        'game_start_skip_draw',
      ])
      expect(state.events.slice(1 + pairs.length, 1 + pairs.length + extra), entry.label)
        .toEqual(extraCards.map((card) => ({ kind: 'draw', actor: 0, cardName: card.name })))
      expect(state.log, entry.label).toEqual([
        ...base.log.slice(0, -1),
        ...extraCards.map((card) => `Player 1 draws ${card.name}.`),
        ...base.log.slice(-1),
      ])
    }
  })

  it("draws a larger hand's extra cards after the alternating draws", () => {
    const state = createInitialGame(9, undefined, { openingHandSizes: [2, 4] })

    expect(eventOrder(state)).toEqual([
      'game_started', 'draw 0', 'draw 1', 'draw 0', 'draw 1', 'draw 1', 'draw 1', 'game_start_skip_draw',
    ])
    expect(state.players.map((player) => [player.hand.length, player.deck.length])).toEqual([[2, 48], [4, 46]])
  })

  it('accepts hand sizes from 0 up to each deck size', () => {
    const empty = createInitialGame(9, undefined, { openingHandSizes: [0, 0] })
    expect(empty.players.map((player) => [player.hand.length, player.deck.length])).toEqual([[0, 50], [0, 50]])
    expect(empty.log).toEqual(['Game started.', 'Player 1 starts and skips first draw step.'])

    const whole = createInitialGame(9, undefined, { openingHandSizes: [50, 50] })
    expect(whole.players.map((player) => [player.hand.length, player.deck.length])).toEqual([[50, 0], [50, 0]])
    expect([whole.phase, whole.winner]).toEqual(['main', null])

    const fitted = createInitialGame(9, [landDeck('fit-p0', 'Island', 6), landDeck('fit-p1', 'Swamp', 2)], {
      openingHandSizes: [6, 2],
    })
    expect(fitted.players.map((player) => [player.hand.length, player.deck.length])).toEqual([[6, 0], [2, 0]])
    expect([fitted.phase, fitted.winner]).toEqual(['main', null])
  })

  it('rejects hand sizes that are not integers from 0 to each deck size', () => {
    const invalid: unknown[] = [
      [-1, 5], [5, -1], [5.5, 5], [5, 0.5], [Number.NaN, 5], [Number.POSITIVE_INFINITY, 5], [5, Number.NEGATIVE_INFINITY],
      [51, 5], [5, 51], ['5', 5], [5, null], [5, undefined], new Array(2), [5], [5, 5, 5], [], 6, null, '5,5',
      { 0: 5, 1: 5, length: 2 },
    ]
    invalid.forEach((openingHandSizes, index) => {
      const options = { openingHandSizes } as unknown as InitialGameOptions
      expect(() => createInitialGame(9, undefined, options), `case ${index}`).toThrow(RangeError)
    })

    const sixCardDeck = (): [Card[], Card[]] => [landDeck('six-p0', 'Island', 6), landDeck('six-p1', 'Swamp', 50)]
    expect(() => createInitialGame(9, sixCardDeck(), { openingHandSizes: [7, 5] })).toThrow(RangeError)
    expect(createInitialGame(9, sixCardDeck(), { openingHandSizes: [6, 5] }).players[0].hand).toHaveLength(6)
  })

  it('reads the decks and options without changing them', () => {
    const decks: [Card[], Card[]] = [landDeck('frozen-p0', 'Forest', 50), landDeck('frozen-p1', 'Swamp', 50)]
    const before = JSON.stringify(decks)
    for (const deck of decks) {
      deck.forEach((card) => Object.freeze(card))
      Object.freeze(deck)
    }
    const options: InitialGameOptions = Object.freeze({ openingHandSizes: Object.freeze([8, 5] as const) })

    const state = createInitialGame(9, decks, options)

    expect(state.players.map((player) => player.hand.length)).toEqual([8, 5])
    expect(JSON.stringify(decks)).toBe(before)
    expect(options.openingHandSizes).toEqual([8, 5])
    expect(state.players[0].hand[0]).not.toBe(decks[0][0])
  })
})

describe('remainingCounterGrowth', () => {
  type Potential = { turn: number; nextInstanceId: number }

  function cardsLeftToDraw(state: GameState): number {
    return state.players[0].deck.length + state.players[1].deck.length
  }

  function potential(state: GameState): Potential {
    const growth = remainingCounterGrowth(state)
    return { turn: state.turn + growth.turn, nextInstanceId: state.nextInstanceId + growth.nextInstanceId }
  }

  /** An edit a hand-written save may make: the current player's first hand card waits as a land play, and another land is still allowed. */
  function withExtraPendingLand(state: GameState, phase: 'main' | 'respond'): GameState | null {
    const edited = structuredClone(state)
    const player = edited.players[edited.currentPlayer]
    const card = player.hand.shift()
    if (!card) return null
    edited.pendingLandPlay = { actor: player.id, card }
    edited.phase = phase
    player.landsPlayedThisTurn = 0
    return edited
  }

  it('allows a draw for every card left, one more End Turn, and the lands this turn can still add', () => {
    const fresh = createInitialGame(21, [landDeck('p0', 'Forest', 12), landDeck('p1', 'Island', 12)])
    const cards = cardsLeftToDraw(fresh)
    expect(remainingCounterGrowth(fresh)).toEqual({ turn: cards + 1, nextInstanceId: cards + 1 })

    // Player 2 holds Islands, so Player 1's land waits for a response.
    const waiting = applyAction(fresh, { type: 'play_land', actor: 0, cardId: fresh.players[0].hand[0].id })
    expect([waiting.phase, waiting.players[0].landsPlayedThisTurn]).toEqual(['respond', 1])
    expect(remainingCounterGrowth(waiting)).toEqual({ turn: cards + 1, nextInstanceId: cards + 1 })

    const resolved = applyAction(waiting, { type: 'pass_response', actor: 1 })
    expect(resolved.nextInstanceId).toBe(fresh.nextInstanceId + 1)
    expect(remainingCounterGrowth(resolved)).toEqual({ turn: cards + 1, nextInstanceId: cards })

    const edited = withExtraPendingLand(resolved, 'main')
    expect(edited && remainingCounterGrowth(edited)).toEqual({ turn: cards + 1, nextInstanceId: cards + 2 })

    expect(remainingCounterGrowth({ ...resolved, phase: 'gameOver', winner: 0 })).toEqual({ turn: 0, nextInstanceId: 0 })
  })

  it('leaves room for the End Turn that ends the game on an empty deck', () => {
    let state = createInitialGame(22, [landDeck('p0', 'Forest', 5), landDeck('p1', 'Mountain', 5)])
    expect(cardsLeftToDraw(state)).toBe(0)
    const before = potential(state)

    state = applyAction(state, { type: 'end_turn', actor: 0 })

    expect([state.phase, state.winner, state.events.at(-1)?.kind]).toEqual(['gameOver', 0, 'deck_empty_loss'])
    expect(state.turn).toBe(before.turn)
    expect(potential(state)).toEqual({ turn: before.turn, nextInstanceId: state.nextInstanceId })
  })

  it('never lets a counter plus its remaining growth rise, however the game is played', () => {
    const random = lcg(0x5eed_06c0)
    const problems: string[] = []
    const seen = new Set<string>()
    for (let game = 0; game < 90; game += 1) {
      const seed = 4_000 + game
      // Every third game uses short decks, so some games end on an empty deck.
      const decks: [Card[], Card[]] | undefined = game % 3 === 2
        ? [createStarterDeck(0, seed).slice(0, 9), createStarterDeck(1, seed + 1).slice(0, 9)]
        : undefined
      let state = createInitialGame(seed, decks)
      const editAt = game % 2 === 0 ? 3 + (game % 7) : -1
      for (let step = 0; step < 3_000 && state.phase !== 'gameOver'; step += 1) {
        if (step === editAt && state.phase === 'main') {
          state = withExtraPendingLand(state, game % 4 === 0 ? 'main' : 'respond') ?? state
          seen.add('edited save')
        }
        const actor = canAct(state, 0) ? 0 : 1
        const legal = getLegalActions(state, actor)
        if (legal.length === 0) {
          problems.push(`game ${game} step ${step}: no legal action in ${state.phase}`)
          break
        }
        const action = legal[Math.floor(random() * legal.length)]
        const next = applyAction(state, action)
        const [was, now] = [potential(state), potential(next)]
        if (now.turn > was.turn || now.nextInstanceId > was.nextInstanceId) {
          problems.push(`game ${game} step ${step}: ${action.type} in ${state.phase} raised ${JSON.stringify(was)} to ${JSON.stringify(now)}`)
        }
        seen.add(action.type)
        state = next
      }
      if (state.phase !== 'gameOver') problems.push(`game ${game}: did not end`)
      if (state.events.some((event) => event.kind === 'deck_empty_loss')) seen.add('empty deck')
      if (state.events.some((event) => event.kind === 'ability_plains_reuse')) seen.add('Plains reuse')
    }

    expect(problems).toEqual([])
    expect([...seen].sort()).toEqual([
      'Plains reuse',
      'counter_land',
      'edited save',
      'empty deck',
      'end_turn',
      'pass_response',
      'play_land',
      'resolve_plains_reuse',
      'resolve_swamp_discard',
    ])
  })
})

describe('game engine boundary', () => {
  const gameDir = resolve(__dirname, '..', 'game')
  const sources = [gameDir, resolve(gameDir, 'ai-policies')].flatMap((dir) => readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ dir, name, source: readFileSync(resolve(dir, name), 'utf8') })))

  it('imports only other game modules', () => {
    expect(sources.length).toBeGreaterThanOrEqual(13)
    for (const { dir, name, source } of sources) {
      for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)) {
        expect(specifier, name).toMatch(/^\.\.?\//)
        expect(resolve(dir, specifier).startsWith(gameDir), `${name} imports ${specifier}`).toBe(true)
      }
    }
  })

  it('names no Adventure, reward or relic concept, so setup stays generic', () => {
    for (const { name, source } of sources) {
      expect(source, name).not.toMatch(/adventure|relic|reward|\bboons?\b|charm/i)
    }
  })
})
