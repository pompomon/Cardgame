import { describe, expect, it } from 'vitest'

import {
  AI_FEATURE_COUNT,
  AI_FEATURE_NAMES,
  FULL_VIEW,
  evaluatePosition,
  featureDifferences,
  sigmoid,
  weightVector,
  type AiFeatureView,
} from '../game/ai-features'
import { HARD_AI_WEIGHTS, HARD_AI_WEIGHTS_VERSION } from '../game/ai-weights'
import { createInitialGame } from '../game/engine'
import type { BattlefieldCard, GameState, PlayerState } from '../game/types'
import { deepFreeze } from './helpers/deep-freeze'
import { TEST_DECK_KINDS, randomDecisionStates, reverseZoneOrder } from './helpers/seeded-games'

const WEIGHTS = weightVector(HARD_AI_WEIGHTS)

function sampleStates(): GameState[] {
  return TEST_DECK_KINDS.flatMap((kind, index) => randomDecisionStates(700 + index, kind, 200).filter((_, step) => step % 5 === 0))
}

function differences(state: GameState, perspective: number, toMove: number, view: AiFeatureView = FULL_VIEW): number[] {
  const out = new Float64Array(AI_FEATURE_COUNT)
  featureDifferences(state, perspective, toMove, out, view)
  return Array.from(out)
}

function withPlayer(state: GameState, seat: 0 | 1, update: (player: PlayerState) => PlayerState): GameState {
  const players = [...state.players] as GameState['players']
  players[seat] = update(players[seat])
  return { ...state, players }
}

/** Swaps the first hand card of `seat` with the first deck card of a different name. */
function swapHandAndDeck(state: GameState, seat: 0 | 1): { state: GameState; fromHand: string; fromDeck: string } | null {
  const player = state.players[seat]
  const handCard = player.hand[0]
  const deckIndex = player.deck.findIndex((card) => card.name !== handCard?.name)
  if (!handCard || deckIndex < 0) {
    return null
  }
  const deckCard = player.deck[deckIndex]
  const swapped = withPlayer(state, seat, (current) => ({
    ...current,
    hand: [deckCard, ...current.hand.slice(1)],
    deck: current.deck.map((card, index) => (index === deckIndex ? handCard : card)),
  }))
  return { state: swapped, fromHand: handCard.id, fromDeck: deckCard.id }
}

describe('AI evaluator features', () => {
  const states = sampleStates()

  it('has one finite frozen weight per feature, in feature order', () => {
    expect(Object.keys(HARD_AI_WEIGHTS).sort()).toEqual([...AI_FEATURE_NAMES].sort())
    expect(Object.isFrozen(HARD_AI_WEIGHTS)).toBe(true)
    expect(Number.isSafeInteger(HARD_AI_WEIGHTS_VERSION)).toBe(true)
    expect(Array.from(WEIGHTS)).toEqual(AI_FEATURE_NAMES.map((name) => HARD_AI_WEIGHTS[name]))
    expect(Array.from(WEIGHTS).every(Number.isFinite)).toBe(true)
  })

  it('scores finished games exactly', () => {
    const state = createInitialGame(5)
    expect(evaluatePosition({ ...state, phase: 'gameOver', winner: 0 }, 0, 0, WEIGHTS)).toBe(1)
    expect(evaluatePosition({ ...state, phase: 'gameOver', winner: 0 }, 1, 0, WEIGHTS)).toBe(0)
    expect(evaluatePosition({ ...state, phase: 'gameOver', winner: 'draw' }, 1, 0, WEIGHTS)).toBe(0.5)
  })

  it('gives the two players values that sum to one', () => {
    for (const state of states) {
      for (const toMove of [0, 1]) {
        expect(evaluatePosition(state, 0, toMove, WEIGHTS) + evaluatePosition(state, 1, toMove, WEIGHTS)).toBeCloseTo(1, 12)
        const mine = differences(state, 0, toMove)
        const theirs = differences(state, 1, toMove)
        expect(mine.map((value, index) => value + theirs[index]).every((sum) => Math.abs(sum) < 1e-12)).toBe(true)
      }
    }
  })

  it('stays within finite bounds and ignores the order of cards within zones', () => {
    for (const state of states) {
      const values = differences(state, 0, state.currentPlayer)
      expect(values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1)).toBe(true)
      expect(differences(reverseZoneOrder(state), 0, state.currentPlayer)).toEqual(values)
    }
  })

  it('cannot tell which cards of a hidden hand are in the hand or the deck', () => {
    let revealing = 0
    let checked = 0
    for (const state of states) {
      const swap = swapHandAndDeck(state, 1)
      if (!swap) continue
      checked += 1
      const hidden: AiFeatureView = { hiddenHandSeat: 1, maskedCardId: undefined }
      for (const perspective of [0, 1]) {
        expect(differences(swap.state, perspective, 0, hidden)).toEqual(differences(state, perspective, 0, hidden))
      }
      if (differences(swap.state, 0, 0).some((value, index) => value !== differences(state, 0, 0)[index])) {
        revealing += 1
      }
    }
    expect(checked).toBeGreaterThan(20)
    expect(revealing).toBeGreaterThan(0)
  })

  it('cannot tell a masked card from the deck it was drawn from', () => {
    let revealing = 0
    let checked = 0
    for (const state of states) {
      for (const seat of [0, 1] as const) {
        const swap = swapHandAndDeck(state, seat)
        if (!swap) continue
        checked += 1
        const before: AiFeatureView = { hiddenHandSeat: -1, maskedCardId: swap.fromHand }
        const after: AiFeatureView = { hiddenHandSeat: -1, maskedCardId: swap.fromDeck }
        expect(differences(swap.state, 0, seat, after)).toEqual(differences(state, 0, seat, before))
        if (differences(swap.state, 0, seat).some((value, index) => value !== differences(state, 0, seat)[index])) {
          revealing += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(40)
    expect(revealing).toBeGreaterThan(0)
  })

  it('does not modify the state', () => {
    for (const state of states.slice(0, 40)) {
      const frozen = deepFreeze(structuredClone(state))
      expect(() => evaluatePosition(frozen, 1, 0, WEIGHTS, { hiddenHandSeat: 0, maskedCardId: frozen.players[0].hand[0]?.id })).not.toThrow()
    }
  })

  it('strongly favours a player about to play an unanswerable winning land', () => {
    const state = createInitialGame(80)
    state.players[0].hand = [{ id: 'p0-win', name: 'Island', type: 'land' }]
    state.players[0].battlefield = [
      { instanceId: 'p0-1', card: { id: 'bf-forest', name: 'Forest', type: 'land' } },
      { instanceId: 'p0-2', card: { id: 'bf-mountain', name: 'Mountain', type: 'land' } },
      { instanceId: 'p0-3', card: { id: 'bf-plains', name: 'Plains', type: 'land' } },
      { instanceId: 'p0-4', card: { id: 'bf-swamp', name: 'Swamp', type: 'land' } },
    ] satisfies BattlefieldCard[]
    state.players[1].hand = []

    expect(evaluatePosition(state, 0, 0, WEIGHTS)).toBeGreaterThan(0.9)
    expect(evaluatePosition(state, 1, 0, WEIGHTS)).toBeLessThan(0.1)
  })

  it('clamps the logistic function', () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(1e6)).toBe(1)
    expect(sigmoid(-1e6)).toBe(0)
    expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1, 15)
  })
})
