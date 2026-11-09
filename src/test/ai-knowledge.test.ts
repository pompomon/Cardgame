import { describe, expect, it } from 'vitest'

import { determinize, projectKnowledge } from '../game/ai-knowledge'
import { createAiRng } from '../game/ai-random'
import { activeActor, getLegalActions } from '../game/engine'
import type { AiVisibilityProfile } from '../game/ai-policy-types'
import type { Card, GameState } from '../game/types'
import { deepFreeze } from './helpers/deep-freeze'
import { TEST_DECK_KINDS, randomDecisionStates, reverseDeckOrder, reverseZoneOrder } from './helpers/seeded-games'

const FULL: AiVisibilityProfile = { kind: 'full', canInspectOpponentHand: true }
const PARTIAL: AiVisibilityProfile = { kind: 'partial', canInspectOpponentHand: false }

function ids(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id).sort()
}

function sampleStates(): GameState[] {
  return TEST_DECK_KINDS.flatMap((kind, index) => randomDecisionStates(900 + index, kind, 60).filter((_, step) => step % 7 === 3))
}

describe('projectKnowledge', () => {
  const states = sampleStates()

  it('drops logs and hides deck order and the order of cards within zones', () => {
    for (const state of states) {
      for (const actor of [0, 1] as const) {
        const knowledge = projectKnowledge(state, actor, FULL)
        expect(knowledge.root.log).toEqual([])
        expect(knowledge.root.events).toEqual([])
        expect(projectKnowledge(reverseDeckOrder(state), actor, FULL)).toEqual(knowledge)
        expect(projectKnowledge(reverseZoneOrder(state), actor, FULL)).toEqual(knowledge)
        expect(knowledge.hiddenOpponentHandSize).toBeNull()
        knowledge.root.players.forEach((player, seat) => {
          expect(ids(player.deck)).toEqual(ids(state.players[seat].deck))
          expect(ids(player.hand)).toEqual(ids(state.players[seat].hand))
        })
      }
    }
  })

  it('pools a hidden opponent hand into that deck', () => {
    for (const state of states) {
      const knowledge = projectKnowledge(state, 0, PARTIAL)
      const opponent = state.players[1]
      expect(knowledge.hiddenOpponentHandSize).toBe(opponent.hand.length)
      expect(knowledge.root.players[1].hand).toEqual([])
      expect(ids(knowledge.root.players[1].deck)).toEqual(ids([...opponent.deck, ...opponent.hand]))
      expect(ids(knowledge.root.players[0].hand)).toEqual(ids(state.players[0].hand))
    }
  })

  it('does not mutate its input', () => {
    const state = deepFreeze(structuredClone(states[states.length - 1]))
    expect(() => projectKnowledge(state, 1, PARTIAL)).not.toThrow()
    expect(() => projectKnowledge(state, 0, FULL)).not.toThrow()
  })
})

describe('determinize', () => {
  const states = sampleStates()

  it('keeps every multiset and deals a hidden hand from its pool', () => {
    for (const state of states) {
      for (const visibility of [FULL, PARTIAL]) {
        const knowledge = deepFreeze(projectKnowledge(state, 0, visibility))
        const world = determinize(knowledge, createAiRng(3))
        world.players.forEach((player, seat) => {
          const real = state.players[seat]
          expect(ids([...player.deck, ...player.hand])).toEqual(ids([...real.deck, ...real.hand]))
          expect(player.hand.length).toBe(real.hand.length)
          expect(player.deck.length).toBe(real.deck.length)
        })
        expect(ids(world.players[0].hand)).toEqual(ids(state.players[0].hand))
        if (visibility === FULL) {
          expect(ids(world.players[1].hand)).toEqual(ids(state.players[1].hand))
        }
        expect(getLegalActions(world, activeActor(world)).length).toBeGreaterThan(0)
      }
    }
  })

  it('repeats for the same seed and varies between seeds', () => {
    const state = states[0]
    const knowledge = projectKnowledge(state, 0, PARTIAL)
    const first = determinize(knowledge, createAiRng(11))
    expect(determinize(knowledge, createAiRng(11))).toEqual(first)
    const orders = new Set<string>()
    for (let seed = 0; seed < 8; seed += 1) {
      const world = determinize(knowledge, createAiRng(seed))
      orders.add(world.players[1].hand.map((card) => card.id).join(','))
    }
    expect(orders.size).toBeGreaterThan(1)
  })
})
