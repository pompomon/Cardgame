import { describe, expect, it } from 'vitest'

import {
  AI_RANDOM_STREAM,
  createAiRng,
  decisionFingerprint,
  deriveAiSeed,
  shuffleInPlace,
} from '../game/ai-random'
import { applyAction, getLegalActions } from '../game/engine'
import type { GameState } from '../game/types'
import { createTestGame, randomDecisionStates, reverseDeckOrder, reverseZoneOrder } from './helpers/seeded-games'

describe('createAiRng', () => {
  it('produces the pinned mulberry32 sequence', () => {
    const zero = createAiRng(0)
    expect([zero.nextUint32(), zero.nextUint32(), zero.nextUint32()]).toEqual([1144304738, 1416247, 958946056])
    const other = createAiRng(123456789)
    expect([other.nextUint32(), other.nextUint32(), other.nextUint32()]).toEqual([1107202814, 4169434471, 3372958138])
  })

  it('repeats for the same seed and keeps values in range', () => {
    const first = createAiRng(42)
    const second = createAiRng(42)
    for (let index = 0; index < 1000; index += 1) {
      const value = first.next()
      expect(second.next()).toBe(value)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      const bounded = first.nextInt(7)
      expect(second.nextInt(7)).toBe(bounded)
      expect(Number.isInteger(bounded) && bounded >= 0 && bounded < 7).toBe(true)
    }
  })

  it('reaches every value of a small bound', () => {
    const rng = createAiRng(9)
    const seen = new Set<number>()
    for (let index = 0; index < 200; index += 1) {
      seen.add(rng.nextInt(5))
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4])
  })
})

describe('shuffleInPlace', () => {
  it('permutes in place and repeats for the same seed', () => {
    const items = Array.from({ length: 20 }, (_, index) => index)
    const shuffled = shuffleInPlace(items.slice(), createAiRng(5))
    expect(shuffled).not.toEqual(items)
    expect([...shuffled].sort((left, right) => left - right)).toEqual(items)
    expect(shuffleInPlace(items.slice(), createAiRng(5))).toEqual(shuffled)
    const target = items.slice()
    expect(shuffleInPlace(target, createAiRng(6))).toBe(target)
  })
})

describe('deriveAiSeed', () => {
  it('produces pinned unsigned 32-bit seeds', () => {
    expect(deriveAiSeed(0)).toBe(121698849)
    expect(deriveAiSeed(1)).toBe(325639728)
    expect(deriveAiSeed(77, 1)).toBe(4000297498)
    expect(deriveAiSeed(1_700_000_000_000, 0, 1)).toBe(3322235891)
  })

  it('separates clock seeds that differ by a multiple of 2^32', () => {
    const base = 1_700_000_000_000
    expect(deriveAiSeed(base + 2 ** 32, 0, 1)).toBe(1199680183)
    expect(deriveAiSeed(base + 2 ** 32, 0, 1)).not.toBe(deriveAiSeed(base, 0, 1))
  })

  it('separates signs, words, word order and streams', () => {
    expect(deriveAiSeed(-5)).not.toBe(deriveAiSeed(5))
    expect(deriveAiSeed(3, 1, 2)).not.toBe(deriveAiSeed(3, 2, 1))
    expect(deriveAiSeed(3, 1)).not.toBe(deriveAiSeed(3, 1, 0))
    const streams = Object.values(AI_RANDOM_STREAM).map((stream) => deriveAiSeed(3, 0, stream))
    expect(new Set(streams).size).toBe(streams.length)
  })

  it('treats non-finite values as zero and truncates fractions', () => {
    expect(deriveAiSeed(Number.NaN)).toBe(deriveAiSeed(0))
    expect(deriveAiSeed(Number.POSITIVE_INFINITY)).toBe(deriveAiSeed(0))
    expect(deriveAiSeed(12.75)).toBe(deriveAiSeed(12))
    for (const value of [0, 1, -1, 2 ** 40, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      const seed = deriveAiSeed(value, 7)
      expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true)
    }
  })
})

function withOpponentCardsSwapped(state: GameState, actor: 0 | 1): GameState {
  const opponent = actor === 0 ? 1 : 0
  const player = state.players[opponent]
  const handIndex = player.hand.length - 1
  const deckIndex = player.deck.findIndex((card) => card.name !== player.hand[handIndex].name)
  const hand = [...player.hand]
  const deck = [...player.deck]
  const moved = hand[handIndex]
  hand[handIndex] = deck[deckIndex]
  deck[deckIndex] = moved
  const players = [...state.players] as GameState['players']
  players[opponent] = { ...player, hand, deck }
  return { ...state, players }
}

describe('decisionFingerprint', () => {
  const states = randomDecisionStates(31, 'starter', 40).filter((state) => state.players.every((player) => player.hand.length > 0))

  it('ignores zone order, deck order, logs and the hidden opponent hand', () => {
    expect(states.length).toBeGreaterThan(10)
    for (const state of states) {
      for (const actor of [0, 1] as const) {
        const fingerprint = decisionFingerprint(state, actor)
        expect(decisionFingerprint(reverseZoneOrder(state), actor)).toBe(fingerprint)
        expect(decisionFingerprint(reverseDeckOrder(state), actor)).toBe(fingerprint)
        expect(decisionFingerprint({ ...state, log: [], events: [] }, actor)).toBe(fingerprint)
        expect(decisionFingerprint(withOpponentCardsSwapped(state, actor), actor)).toBe(fingerprint)
      }
    }
  })

  it('changes with the seat, its own hand and the public state', () => {
    const state = createTestGame(8, 'starter')
    const fingerprint = decisionFingerprint(state, 0)
    expect(decisionFingerprint(state, 1)).not.toBe(fingerprint)
    expect(decisionFingerprint(withOpponentCardsSwapped(state, 1), 0)).not.toBe(fingerprint)
    const played = applyAction(state, getLegalActions(state, 0).find((action) => action.type === 'play_land')!)
    expect(decisionFingerprint(played, 0)).not.toBe(fingerprint)
    expect(decisionFingerprint({ ...state, turn: state.turn + 2 }, 0)).not.toBe(fingerprint)
  })
})
