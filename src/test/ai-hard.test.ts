import { describe, expect, it } from 'vitest'

import { isLegalActionForState } from '../app/action-validation'
import { actionClassKey, canonicalActionClasses } from '../game/ai-action-classes'
import { explainHardDecision, hardSearchPolicy, type HardDecision, type HardDecisionOptions } from '../game/ai-hard'
import { AI_PERSONAS, personaForSeat } from '../game/ai-personas'
import type { AiPolicyContext } from '../game/ai-policy-types'
import { HARD_AI_DEFAULT_SELECTION, decisionCriticality } from '../game/ai-selection'
import { activeActor, applyAction, createInitialGame, getLegalActions } from '../game/engine'
import type { BasicLand, BattlefieldCard, Card, GameAction, GameState } from '../game/types'
import { deepFreeze } from './helpers/deep-freeze'
import { TEST_DECK_KINDS, createTestGame, randomDecisionStates, reverseDeckOrder, reverseZoneOrder } from './helpers/seeded-games'

// A small budget keeps the tests fast; the defaults are measured by the
// tournament tool.
const BUDGET = { determinizations: 4, rolloutTurns: 2 } as const
const CONTEXT: AiPolicyContext = { level: 'hard', visibility: { kind: 'full', canInspectOpponentHand: true } }

function decide(state: GameState, seed: number, options: HardDecisionOptions = {}): HardDecision {
  const actor = activeActor(state)
  return explainHardDecision(state, actor, getLegalActions(state, actor), { seed, budget: BUDGET, ...options })
}

function classOf(state: GameState, decision: HardDecision): string {
  return decision.action ? actionClassKey(state, decision.action) : 'none'
}

function isCritical(state: GameState): boolean {
  return decisionCriticality(state) >= HARD_AI_DEFAULT_SELECTION.criticalThreshold
}

function card(id: string, name: BasicLand): Card {
  return { id, name, type: 'land' }
}

function lands(seat: number, names: readonly BasicLand[]): BattlefieldCard[] {
  return names.map((name, index) => ({ instanceId: `p${seat}-bf-${index}`, card: card(`p${seat}-bf-card-${index}`, name) }))
}

interface CriticalFixture {
  readonly name: string
  readonly state: GameState
  readonly expected: Partial<GameAction>
}

/** Positions with one right play, where Hard holds the first seat. */
function criticalFixtures(): CriticalFixture[] {
  const winNow = createInitialGame(90)
  winNow.players[0].hand = [card('ai-island', 'Island'), card('ai-forest', 'Forest')]
  winNow.players[0].battlefield = lands(0, ['Forest', 'Mountain', 'Plains', 'Swamp'])
  winNow.players[1].hand = [card('p1-forest', 'Forest')]

  // The opponent's Swamp would complete five different lands next turn.
  const mustAnswer = createInitialGame(91)
  mustAnswer.players[0].hand = [card('ai-forest', 'Forest'), card('ai-mountain', 'Mountain')]
  mustAnswer.players[1].hand = [card('p1-swamp', 'Swamp')]
  mustAnswer.players[1].battlefield = lands(1, ['Forest', 'Island', 'Mountain', 'Plains'])

  // Here the opponent plays it into Hard's Island.
  const counter = createInitialGame(92)
  counter.currentPlayer = 1
  counter.players[0].hand = [card('ai-island', 'Island'), card('ai-forest', 'Forest')]
  counter.players[1].hand = [card('p1-swamp', 'Swamp')]
  counter.players[1].battlefield = lands(1, ['Forest', 'Island', 'Mountain', 'Plains'])

  return [
    { name: 'win now', state: winNow, expected: { type: 'play_land', actor: 0, cardId: 'ai-island' } },
    { name: 'answer with Mountain', state: mustAnswer, expected: { type: 'play_land', actor: 0, cardId: 'ai-mountain' } },
    {
      name: 'counter a winning land',
      state: applyAction(counter, { type: 'play_land', actor: 1, cardId: 'p1-swamp' }),
      expected: { type: 'counter_land', actor: 0, discardCardId: 'ai-forest' },
    },
  ]
}

/** Decision states with a real choice, from two random games of every deck kind. */
function decisionStates(): GameState[] {
  return [3100, 3200]
    .flatMap((seed) => TEST_DECK_KINDS.flatMap((kind, index) => randomDecisionStates(seed + index, kind, 240)))
    .filter((state, step) => step % 3 === 0 && canonicalActionClasses(state, getLegalActions(state, activeActor(state))).length >= 2)
}

describe('Hard AI decisions', () => {
  const states = decisionStates()
  const calm = states.filter((state) => !isCritical(state))
  const critical = states.filter(isCritical)

  it('samples calm and critical decisions', () => {
    expect(calm.length).toBeGreaterThanOrEqual(40)
    expect(critical.length).toBeGreaterThanOrEqual(15)
  })

  it('returns no action when there is none', () => {
    const state = createTestGame(1, 'starter')
    const decision = explainHardDecision(state, 0, [], { seed: 1 })
    expect(decision.action).toBeNull()
    expect(decision.selection).toEqual({ index: -1, rail: 'single', temperature: 0, candidates: [] })
    expect(hardSearchPolicy({ state, actor: 0, actions: [], context: CONTEXT, seed: 1 })).toBeNull()
  })

  it('repeats a decision for the same state, seat and seed, also after a JSON round trip', () => {
    for (const state of states.slice(0, 40)) {
      const decision = decide(state, 77)
      expect(decide(state, 77)).toEqual(decision)
      expect(decide(JSON.parse(JSON.stringify(state)) as GameState, 77)).toEqual(decision)
    }
  })

  it('ignores the hidden deck order and the order of cards within zones', () => {
    for (const state of states.slice(0, 40)) {
      const decision = decide(state, 31)
      expect(decide(reverseDeckOrder(state), 31)).toEqual(decision)
      // A counter may name a different Island in another hand order, so the
      // action is compared by its class.
      const reversed = reverseZoneOrder(state)
      const reordered = decide(reversed, 31)
      expect(classOf(reversed, reordered)).toBe(classOf(state, decision))
      expect(isLegalActionForState(reversed, reordered.action!)).toBe(true)
      expect(reordered.selection).toEqual(decision.selection)
    }
  })

  it('varies calm decisions from game to game', () => {
    const sample = calm.slice(0, 40)
    let varied = 0
    for (const state of sample) {
      const classes = new Set(Array.from({ length: 16 }, (_, seed) => classOf(state, decide(state, 1000 + seed * 7919))))
      varied += classes.size >= 2 ? 1 : 0
    }
    expect(varied / sample.length).toBeGreaterThanOrEqual(0.3)
  })

  it('meets a critical position the same way in every game', () => {
    for (const state of critical.slice(0, 20)) {
      const first = decide(state, 0)
      expect(first.criticality).toBe(1)
      for (let game = 1; game < 32; game += 1) {
        const decision = decide(state, game * 7919)
        expect({ ...decision, persona: first.persona }).toEqual(first)
      }
    }
  })

  it.each(criticalFixtures())('plays the one right move to $name in every game', ({ state, expected }) => {
    expect(activeActor(state)).toBe(0)
    const first = decide(state, 0)
    expect(first.criticality).toBe(1)
    expect(first.action).toMatchObject(expected)
    for (let game = 1; game < 32; game += 1) {
      const decision = decide(state, game * 7919)
      expect({ ...decision, persona: first.persona }).toEqual(first)
    }
  })

  it('judges calm positions by the seat persona and critical ones by the fitted weights', () => {
    for (const state of states.slice(0, 30)) {
      expect(decide(state, 5).persona).toBe(personaForSeat(5, activeActor(state)))
      expect(decide(state, 5, { persona: 'hoarder' }).persona).toBe('hoarder')
    }
    for (const state of critical.slice(0, 10)) {
      const searches = AI_PERSONAS.map((persona) => decide(state, 5, { persona }).search)
      for (const search of searches) {
        expect(search).toEqual(searches[0])
      }
    }
    let changed = 0
    for (const state of calm.slice(0, 20)) {
      const [balanced, ...others] = AI_PERSONAS.map((persona) => decide(state, 5, { persona }).search)
      if (balanced.outcome !== 'searched') continue
      if (others.some((search) => search.classes.some((entry, index) => entry.mean !== balanced.classes[index].mean))) {
        changed += 1
      }
    }
    expect(changed).toBeGreaterThan(5)
  })

  it('chooses among its candidates and reports their probabilities', () => {
    for (const state of states.slice(0, 60)) {
      const decision = decide(state, 9)
      const candidates = decision.selection.candidates.map((candidate) => candidate.index)
      expect(candidates).toContain(decision.selection.index)
      expect(decision.action).toEqual(decision.search.classes[decision.selection.index].action)
      const total = decision.selection.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)
      expect(total).toBeCloseTo(1, 12)
      expect(decision.selection.rail === 'sampled').toBe(decision.search.outcome === 'searched' && decision.criticality < 1)
    }
  })

  it('does not modify the state it decides on', () => {
    for (const state of states.slice(0, 20)) {
      const expected = decide(state, 3)
      expect(decide(deepFreeze(structuredClone(state)), 3)).toEqual(expected)
    }
  })

  it('plays only legal actions through whole games', () => {
    let decisions = 0
    for (let game = 0; game < 40; game += 1) {
      const seed = 4000 + game
      let state = createTestGame(seed, TEST_DECK_KINDS[game % TEST_DECK_KINDS.length])
      for (let step = 0; step < 2000 && state.phase !== 'gameOver'; step += 1) {
        const actor = activeActor(state)
        const actions = getLegalActions(state, actor)
        const action = hardSearchPolicy({ state, actor, actions, context: CONTEXT, seed, budget: BUDGET })
        expect(action).not.toBeNull()
        expect(isLegalActionForState(state, action!)).toBe(true)
        decisions += 1
        // Logs are dropped as in the tournament harness; no policy reads them.
        state = { ...applyAction(state, action!), log: [], events: [] }
      }
      expect(state.phase).toBe('gameOver')
    }
    expect(decisions).toBeGreaterThanOrEqual(1000)
  })
})
