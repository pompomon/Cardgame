import { describe, expect, it } from 'vitest'

import { isLegalActionForState } from '../app/action-validation'
import { canonicalActionClasses } from '../game/ai-action-classes'
import { weightVector } from '../game/ai-features'
import type { AiSearchBudget } from '../game/ai-policy-types'
import {
  HARD_AI_DEFAULT_BUDGET,
  bestClassIndex,
  pairedDifference,
  resolveSearchBudget,
  searchActionValues,
  type AiSearchOptions,
  type AiSearchResult,
} from '../game/ai-search'
import { HARD_AI_WEIGHTS } from '../game/ai-weights'
import { activeActor, applyAction, createInitialGame, getLegalActions } from '../game/engine'
import type { BasicLand, BattlefieldCard, GameState } from '../game/types'
import { deepFreeze } from './helpers/deep-freeze'
import { TEST_DECK_KINDS, randomDecisionStates, reverseDeckOrder, reverseZoneOrder } from './helpers/seeded-games'

const WEIGHTS = weightVector(HARD_AI_WEIGHTS)
const SMALL_BUDGET = resolveSearchBudget({ determinizations: 4, rolloutTurns: 2 })

function options(searchSeed: number, budget: AiSearchBudget = SMALL_BUDGET): AiSearchOptions {
  return { searchSeed, budget, rootWeights: WEIGHTS, opponentWeights: WEIGHTS, opponentSeesHand: false }
}

function search(state: GameState, searchSeed = 1, budget: AiSearchBudget = SMALL_BUDGET): AiSearchResult {
  const actor = activeActor(state)
  return searchActionValues(state, actor, getLegalActions(state, actor), options(searchSeed, budget))
}

function classCount(state: GameState): number {
  return canonicalActionClasses(state, getLegalActions(state, activeActor(state))).length
}

/** Decision states with a real choice, from every deck kind. */
function sampleStates(): GameState[] {
  return TEST_DECK_KINDS.flatMap((kind, index) =>
    randomDecisionStates(1300 + index, kind, 160).filter((state, step) => step % 4 === 0 && classCount(state) >= 2),
  )
}

function battlefield(seat: number, names: readonly BasicLand[]): BattlefieldCard[] {
  return names.map((name, index) => ({ instanceId: `p${seat}-bf-${index}`, card: { id: `p${seat}-bf-card-${index}`, name, type: 'land' } }))
}

/** Player 0 to act with Forest, Mountain, Plains and Swamp out and an Island in hand. */
function winningIslandState(opponentHand: GameState['players'][number]['hand']): GameState {
  const state = createInitialGame(80)
  state.players[0].hand = [
    { id: 'p0-win', name: 'Island', type: 'land' },
    { id: 'p0-other', name: 'Forest', type: 'land' },
  ]
  state.players[0].battlefield = battlefield(0, ['Forest', 'Mountain', 'Plains', 'Swamp'])
  state.players[1].hand = opponentHand
  return state
}

describe('AI search budget', () => {
  it('fills missing or non-finite fields with the defaults and clamps the rest', () => {
    expect(resolveSearchBudget()).toEqual(HARD_AI_DEFAULT_BUDGET)
    expect(Object.isFrozen(HARD_AI_DEFAULT_BUDGET)).toBe(true)
    expect(resolveSearchBudget({ determinizations: Number.NaN, rolloutTurns: Infinity, rolloutEpsilon: -Infinity })).toEqual(HARD_AI_DEFAULT_BUDGET)
    expect(resolveSearchBudget({ determinizations: 0, rolloutTurns: 99, rolloutEpsilon: -1, maxEngineSteps: 2.7 })).toEqual({
      determinizations: 1,
      rolloutTurns: 32,
      rolloutEpsilon: 0,
      maxEngineSteps: 2,
    })
    expect(resolveSearchBudget({ determinizations: 3.9, rolloutEpsilon: 0.25, maxEngineSteps: 1e9 })).toEqual({
      ...HARD_AI_DEFAULT_BUDGET,
      determinizations: 3,
      rolloutEpsilon: 0.25,
      maxEngineSteps: 1_000_000,
    })
  })
})

describe('AI search', () => {
  const states = sampleStates()

  it('samples decision states from every phase', () => {
    expect(new Set(states.map((state) => state.phase))).toEqual(new Set(['main', 'respond', 'plains_target', 'swamp_target']))
  })

  it('returns at once when there is a single class', () => {
    const state = createInitialGame(4)
    state.players[0].hand = []
    const result = search(state)
    expect(result.outcome).toBe('single')
    expect(result.steps).toBe(0)
    expect(result.worlds).toBe(0)
    expect(result.classes).toHaveLength(1)
    expect(result.classes[0]).toMatchObject({ action: { type: 'end_turn', actor: 0 }, finalist: true, winsNow: false })
    expect(bestClassIndex(result)).toBe(0)
  })

  it('takes a win that cannot be answered without sampling worlds', () => {
    const result = search(winningIslandState([]))
    expect(result.outcome).toBe('win')
    expect(result.worlds).toBe(0)
    const best = result.classes[bestClassIndex(result)]
    expect(best).toMatchObject({ action: { type: 'play_land', actor: 0, cardId: 'p0-win' }, winsNow: true, finalist: true, mean: 1 })
    expect(result.classes.filter((entry) => entry.finalist)).toEqual([best])
  })

  it('searches a winning play that the opponent can counter', () => {
    const state = winningIslandState([
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-forest', name: 'Forest', type: 'land' },
    ])
    const result = search(state)
    expect(result.outcome).toBe('searched')
    expect(result.classes.every((entry) => !entry.winsNow)).toBe(true)
  })

  it('counters a land that would win, because passing loses in every world', () => {
    let state = winningIslandState([
      { id: 'p1-island', name: 'Island', type: 'land' },
      { id: 'p1-forest', name: 'Forest', type: 'land' },
    ])
    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'p0-win' })
    expect(state.phase).toBe('respond')
    const result = search(state, 9)
    expect(result.outcome).toBe('searched')
    const pass = result.classes.find((entry) => entry.action.type === 'pass_response')
    expect(pass).toMatchObject({ mean: 0, standardError: 0 })
    expect(result.classes[bestClassIndex(result)].action).toMatchObject({ type: 'counter_land', actor: 1 })
  })

  it('chooses a legal class representative and keeps values in range', () => {
    for (const state of states) {
      const result = search(state)
      const best = result.classes[bestClassIndex(result)]
      expect(isLegalActionForState(state, best.action)).toBe(true)
      expect(canonicalActionClasses(state, getLegalActions(state, activeActor(state))).map((entry) => entry.representative)).toContainEqual(best.action)
      expect(result.values).toHaveLength(result.worlds * result.classes.length)
      for (const entry of result.classes) {
        expect(entry.mean).toBeGreaterThanOrEqual(0)
        expect(entry.mean).toBeLessThanOrEqual(1)
        expect(entry.standardError).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('repeats a search for the same seed and varies it for others', () => {
    let differs = 0
    for (const state of states.slice(0, 40)) {
      const first = search(state, 21)
      expect(search(state, 21)).toEqual(first)
      if (first.outcome !== 'searched') continue
      if (search(state, 22).classes.some((entry, index) => entry.mean !== first.classes[index].mean)) {
        differs += 1
      }
    }
    expect(differs).toBeGreaterThan(5)
  })

  it('ignores the hidden deck order and the order of cards within zones', () => {
    // A counter's representative may name a different Island in another hand
    // order, so actions are compared by legality and everything else exactly.
    const comparable = (result: AiSearchResult) => ({ ...result, classes: result.classes.map(({ action: _action, ...rest }) => rest) })
    for (const state of states.slice(0, 60)) {
      const result = search(state, 5)
      expect(search(reverseDeckOrder(state), 5)).toEqual(result)
      const reversed = reverseZoneOrder(state)
      const reorderedResult = search(reversed, 5)
      expect(comparable(reorderedResult)).toEqual(comparable(result))
      for (const entry of reorderedResult.classes) {
        expect(isLegalActionForState(reversed, entry.action)).toBe(true)
      }
    }
  })

  it('values a counter by the cards it spends, whichever Island comes first in hand', () => {
    let state = winningIslandState([
      { id: 'p1-island-b', name: 'Island', type: 'land' },
      { id: 'p1-island-a', name: 'Island', type: 'land' },
      { id: 'p1-forest', name: 'Forest', type: 'land' },
    ])
    state = applyAction(state, { type: 'play_land', actor: 0, cardId: 'p0-win' })
    const counters = (candidate: GameState) => search(candidate, 2).classes.filter((entry) => entry.action.type === 'counter_land')
    const original = counters(state)
    const reordered = counters(reverseZoneOrder(state))
    expect(original.map((entry) => entry.key)).toEqual(['counter|Forest', 'counter|Island'])
    expect(reordered.map(({ key, mean }) => ({ key, mean }))).toEqual(original.map(({ key, mean }) => ({ key, mean })))
    // Both counters spend the Island that comes first plus the chosen card.
    for (const entry of original) {
      const next = applyAction(state, entry.action)
      expect(next.phase).toBe('main')
      expect(next.players[1].hand).toHaveLength(1)
    }
  })

  it('does not modify the state it searches', () => {
    for (const state of states.slice(0, 20)) {
      const expected = search(state, 3)
      const frozen = deepFreeze(structuredClone(state))
      expect(search(frozen, 3)).toEqual(expected)
    }
  })

  it('keeps within the step cap, give or take one rollout decision per class', () => {
    let capped = 0
    for (const state of states.slice(0, 60)) {
      const width = classCount(state)
      const full = search(state, 8, resolveSearchBudget({ determinizations: 8 }))
      for (const cap of [40, 150, 600]) {
        const result = search(state, 8, resolveSearchBudget({ determinizations: 8, maxEngineSteps: cap }))
        expect(result.steps).toBeLessThanOrEqual(Math.max(cap, 16 * width) + 80 * width)
        if (result.outcome !== 'searched') continue
        expect(result.worlds).toBeGreaterThanOrEqual(1)
        if (full.steps > 2 * cap) {
          expect(result.worlds).toBeLessThan(full.worlds)
          capped += 1
        }
      }
    }
    expect(capped).toBeGreaterThan(10)
  })

  it('halves many classes down to at least three finalists that see every world', () => {
    const wide = states.filter((state) => classCount(state) >= 6).slice(0, 8)
    expect(wide.length).toBeGreaterThan(0)
    for (const state of wide) {
      const result = search(state, 13, resolveSearchBudget({ determinizations: 8 }))
      expect(result.outcome).toBe('searched')
      const finalists = result.classes.filter((entry) => entry.finalist)
      expect(finalists.length).toBeGreaterThanOrEqual(3)
      expect(finalists.length).toBeLessThan(result.classes.length)
      for (const entry of result.classes) {
        expect(entry.samples).toBeGreaterThanOrEqual(1)
        expect(entry.samples === result.worlds).toBe(entry.finalist)
      }
      expect(result.classes[bestClassIndex(result)].finalist).toBe(true)
    }
  })
})

describe('AI search statistics', () => {
  const entry = (key: string, mean: number, finalist: boolean) => ({
    key,
    action: { type: 'end_turn' as const, actor: 0 },
    samples: 1,
    mean,
    standardError: 0,
    finalist,
    winsNow: false,
  })
  const result = (classes: AiSearchResult['classes'], worlds = 1, values = new Float64Array(0)): AiSearchResult => ({
    outcome: 'searched',
    classes,
    worlds,
    steps: 0,
    values,
  })

  it('pairs differences over the worlds both classes were played in', () => {
    const searched = result([entry('a', 0, true), entry('b', 0, true)], 3, Float64Array.from([0.6, 0.5, 0.7, 0.4, Number.NaN, 0.3]))
    const difference = pairedDifference(searched, 0, 1)
    expect(difference.samples).toBe(2)
    expect(difference.mean).toBeCloseTo(0.2, 12)
    expect(difference.standardError).toBeCloseTo(0.1, 12)
    expect(pairedDifference(searched, 1, 0).mean).toBeCloseTo(-0.2, 12)
    expect(pairedDifference(searched, 0, 0)).toEqual({ mean: 0, standardError: 0, samples: 2 })
  })

  it('picks the best finalist, ties going to key order', () => {
    expect(bestClassIndex(result([entry('a', 0.4, true), entry('b', 0.9, false), entry('c', 0.6, true), entry('d', 0.6, true)]))).toBe(2)
    expect(bestClassIndex(result([entry('a', 0.4, false)]))).toBe(-1)
  })
})
