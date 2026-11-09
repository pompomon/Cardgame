import { buildAdventureOpponentPools } from '../../app/adventure-map'
import { createAiRng, deriveAiSeed } from '../../game/ai-random'
import { activeActor, applyAction, createInitialGame, getLegalActions } from '../../game/engine'
import type { Card, GameAction, GameState } from '../../game/types'

/** Opponent deck kinds of Adventure mode, plus the regular starter deck. */
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
 * A deck of `kind` built from `seed`; `undefined` means the engine's seeded
 * starter deck. Adventure decks reuse the Adventure pools. `variant` picks the
 * mono or dual deck; pass `seed` to cycle them evenly over consecutive seeds
 * when the kind is fixed.
 */
export function deckOfKind(kind: TestDeckKind, seed: number, variant = deckVariantOfSeed(seed)): Card[] | undefined {
  if (kind === 'starter') {
    return undefined
  }
  const pools = buildAdventureOpponentPools(seed)
  const pick = (count: number) => Math.abs(variant) % count
  switch (kind) {
    case 'standard':
      return pools.nonBoss.find((deck) => deck.kind === 'standard')!.deck
    case 'dual': {
      const duals = pools.nonBoss.filter((deck) => deck.kind === 'dual')
      return duals[pick(duals.length)].deck
    }
    case 'random':
      return pools.nonBoss.find((deck) => deck.kind === 'random')!.deck
    case 'mono':
      return pools.boss[pick(pools.boss.length)].deck
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
