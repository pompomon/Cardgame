import { buildAdventureOpponentPools } from '../../app/adventure-map'
import { createAiRng, deriveAiSeed } from '../../game/ai-random'
import { shuffle } from '../../game/cards'
import { activeActor, applyAction, createInitialGame, getLegalActions } from '../../game/engine'
import { BASIC_LANDS, type Card, type GameAction, type GameState } from '../../game/types'

/**
 * Opponent deck kinds of Adventure mode, plus the regular starter deck.
 * `mono` is fifty of one creature, as Adventure bosses were before their
 * rebuild, kept as the most lopsided decks for the AI tests and tools.
 */
export type TestDeckKind = 'starter' | 'standard' | 'dual' | 'random' | 'mono'

export const TEST_DECK_KINDS: readonly TestDeckKind[] = ['starter', 'standard', 'dual', 'random', 'mono']

const DECK_VARIANT_WORD = 0x64656b76

/**
 * The default mono or dual deck variant of `seed`. It is mixed rather than
 * taken from the seed, because callers that cycle the five kinds with
 * consecutive seeds would otherwise meet one mono deck and two dual decks.
 */
export function deckVariantOfSeed(seed: number): number {
  return deriveAiSeed(seed, DECK_VARIANT_WORD)
}

/**
 * Fifty of one creature with the card ids and shuffle of the old Adventure
 * boss decks, so seeded AI games and tuning corpora are unchanged.
 */
function monoDeck(seed: number, index: number): Card[] {
  const land = BASIC_LANDS[index]
  const cards: Card[] = Array.from({ length: 50 }, (_, card) => ({
    id: `opp-boss-${index}-${land.toLowerCase()}-${card}`,
    name: land,
    type: 'land',
  }))
  return shuffle(cards, seed + 900 + index * 13)
}

/**
 * A deck of `kind` built from `seed`; `undefined` means the engine's seeded
 * starter deck. The other non-mono decks reuse the Adventure pools. `variant`
 * picks the mono or dual deck; pass `seed` to cycle them evenly over
 * consecutive seeds when the kind is fixed.
 */
export function deckOfKind(kind: TestDeckKind, seed: number, variant = deckVariantOfSeed(seed)): Card[] | undefined {
  const pick = (count: number) => Math.abs(variant) % count
  if (kind === 'starter') {
    return undefined
  }
  if (kind === 'mono') {
    return monoDeck(seed, pick(BASIC_LANDS.length))
  }
  const pools = buildAdventureOpponentPools(seed)
  switch (kind) {
    case 'standard':
      return pools.nonBoss.find((deck) => deck.kind === 'standard')!.deck
    case 'dual': {
      const duals = pools.nonBoss.filter((deck) => deck.kind === 'dual')
      return duals[pick(duals.length)].deck
    }
    case 'random':
      return pools.nonBoss.find((deck) => deck.kind === 'random')!.deck
    default:
      return undefined
  }
}

/**
 * A game where one seat (alternating with the seed) uses the starter deck
 * and the other a deck of `kind`, so card ids never clash between players.
 */
export function createTestGame(seed: number, kind: TestDeckKind): GameState {
  const deck = deckOfKind(kind, seed)
  const decks: [Card[] | undefined, Card[] | undefined] = seed % 2 === 0 ? [undefined, deck] : [deck, undefined]
  return createInitialGame(seed, decks)
}

/** A uniformly random legal action of the seat to act. */
export function randomLegalAction(state: GameState, rng: ReturnType<typeof createAiRng>): GameAction | null {
  const actions = getLegalActions(state, activeActor(state))
  if (actions.length === 0) {
    return null
  }
  return actions[rng.nextInt(actions.length)]
}

/**
 * Plays uniformly random legal actions from a new game and returns every
 * decision state that was reached, the start included.
 */
export function randomDecisionStates(seed: number, kind: TestDeckKind, maxSteps = 400): GameState[] {
  const rng = createAiRng(seed)
  let state = createTestGame(seed, kind)
  const states: GameState[] = []
  for (let step = 0; step < maxSteps && state.phase !== 'gameOver'; step += 1) {
    states.push(state)
    const action = randomLegalAction(state, rng)
    if (!action) {
      break
    }
    state = applyAction(state, action)
  }
  return states
}

/** Reverses the order of hand, battlefield and graveyard cards of both players. */
export function reverseZoneOrder(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hand: [...player.hand].reverse(),
      battlefield: [...player.battlefield].reverse(),
      graveyard: [...player.graveyard].reverse(),
    })) as GameState['players'],
  }
}

/** Reverses both decks, a different hidden order with the same contents. */
export function reverseDeckOrder(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      deck: [...player.deck].reverse(),
    })) as GameState['players'],
  }
}
