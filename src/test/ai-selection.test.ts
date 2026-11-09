import { describe, expect, it } from 'vitest'

import { isLegalActionForState } from '../app/action-validation'
import { canonicalActionClasses } from '../game/ai-action-classes'
import { weightVector } from '../game/ai-features'
import { createAiRng, type AiRng } from '../game/ai-random'
import { bestClassIndex, resolveSearchBudget, searchActionValues, type AiSearchResult } from '../game/ai-search'
import {
  HARD_AI_DEFAULT_SELECTION,
  boardProgress,
  decisionCriticality,
  resolveSelectionSettings,
  selectSearchedClass,
  type AiSelectionSettings,
} from '../game/ai-selection'
import { HARD_AI_WEIGHTS } from '../game/ai-weights'
import { activeActor, createInitialGame, getLegalActions } from '../game/engine'
import type { BasicLand, BattlefieldCard, GameState, PlayerState } from '../game/types'
import { TEST_DECK_KINDS, randomDecisionStates } from './helpers/seeded-games'

const SETTINGS: AiSelectionSettings = { temperature: 0.05, margin: 0.03, criticalThreshold: 1 }

/** An rng whose `next()` returns the given values in turn, counting the calls. */
function scriptedRng(...values: number[]): AiRng & { calls: number } {
  const rng = {
    calls: 0,
    next() {
      const value = values[rng.calls % values.length]
      rng.calls += 1
      return value
    },
    nextUint32() {
      return Math.floor(rng.next() * 2 ** 32)
    },
    nextInt(bound: number) {
      return Math.floor(rng.next() * bound)
    },
  }
  return rng
}

function battlefield(seat: number, names: readonly BasicLand[]): BattlefieldCard[] {
  return names.map((name, index) => ({ instanceId: `p${seat}-bf-${index}`, card: { id: `p${seat}-bf-card-${index}`, name, type: 'land' } }))
}

function playerWith(names: readonly BasicLand[]): PlayerState {
  const player = createInitialGame(1).players[0]
  player.battlefield = battlefield(0, names)
  return player
}

/**
 * A searched result over `columns` (one array of world values per class).
 * Classes without values in a world have NaN there; `finalists` defaults to
 * every class.
 */
function searched(columns: readonly (readonly number[])[], finalists: readonly boolean[] = columns.map(() => true)): AiSearchResult {
  const worlds = Math.max(...columns.map((column) => column.length))
  const width = columns.length
  const values = new Float64Array(worlds * width).fill(Number.NaN)
  columns.forEach((column, index) => column.forEach((value, world) => (values[world * width + index] = value)))
  return {
    outcome: 'searched',
    worlds,
    steps: 0,
    values,
    classes: columns.map((column, index) => ({
      key: `class-${index}`,
      action: { type: 'end_turn', actor: 0 },
      samples: column.length,
      mean: column.reduce((sum, value) => sum + value, 0) / column.length,
      standardError: 0,
      finalist: finalists[index],
      winsNow: false,
    })),
  }
}

function choiceCounts(result: AiSearchResult, criticality: number, settings: AiSelectionSettings, draws = 2000): number[] {
  const counts = result.classes.map(() => 0)
  const rng = createAiRng(99)
  for (let draw = 0; draw < draws; draw += 1) {
    counts[selectSearchedClass(result, criticality, settings, rng).index] += 1
  }
  return counts
}

describe('AI selection settings', () => {
  it('fills missing or non-finite fields with the defaults and clamps the rest', () => {
    expect(Object.isFrozen(HARD_AI_DEFAULT_SELECTION)).toBe(true)
    expect(resolveSelectionSettings()).toEqual(HARD_AI_DEFAULT_SELECTION)
    expect(resolveSelectionSettings({ temperature: Number.NaN, margin: Infinity, criticalThreshold: -Infinity })).toEqual(
      HARD_AI_DEFAULT_SELECTION,
    )
    expect(resolveSelectionSettings({ temperature: -1, margin: 3, criticalThreshold: 2 })).toEqual({
      temperature: 0,
      margin: 1,
      criticalThreshold: 1,
    })
    expect(resolveSelectionSettings({ temperature: 0.2, criticalThreshold: 0.5 })).toEqual({
      ...HARD_AI_DEFAULT_SELECTION,
      temperature: 0.2,
      criticalThreshold: 0.5,
    })
  })
})

describe('AI decision criticality', () => {
  it('measures progress by distinct names or copies of one name', () => {
    expect(boardProgress(playerWith([]))).toBe(0)
    expect(boardProgress(playerWith(['Forest', 'Forest', 'Island']))).toBe(2)
    expect(boardProgress(playerWith(['Swamp', 'Swamp', 'Swamp']))).toBe(3)
    expect(boardProgress(playerWith(['Forest', 'Island', 'Mountain', 'Plains']))).toBe(4)
    expect(boardProgress(playerWith(['Plains', 'Plains', 'Plains', 'Plains', 'Island']))).toBe(4)
  })

  it('rises with the furthest player and is critical from four lands', () => {
    const at = (first: readonly BasicLand[], second: readonly BasicLand[]): number => {
      const state = createInitialGame(3)
      state.players[0].battlefield = battlefield(0, first)
      state.players[1].battlefield = battlefield(1, second)
      return decisionCriticality(state)
    }
    expect(at([], [])).toBe(0)
    expect(at(['Forest'], [])).toBe(0)
    expect(at(['Forest', 'Island'], ['Swamp'])).toBe(0.25)
    expect(at([], ['Swamp', 'Swamp', 'Swamp'])).toBe(0.5)
    expect(at(['Forest', 'Island', 'Mountain'], ['Swamp', 'Plains', 'Forest', 'Island'])).toBe(1)
    expect(at(['Forest', 'Forest', 'Forest', 'Forest'], [])).toBe(1)
  })

  it('is critical when a deck can run out within two turns or the game is over', () => {
    const lowDeck = createInitialGame(5)
    lowDeck.players[1].deck = lowDeck.players[1].deck.slice(0, 2)
    expect(decisionCriticality(lowDeck)).toBe(1)
    lowDeck.players[1].deck = createInitialGame(5).players[1].deck.slice(0, 3)
    expect(decisionCriticality(lowDeck)).toBe(0)
    const over = createInitialGame(6)
    over.phase = 'gameOver'
    over.winner = 0
    expect(decisionCriticality(over)).toBe(1)
  })
})

describe('AI selection', () => {
  it('takes the single class, or none, without randomness', () => {
    const rng = scriptedRng(0.5)
    const single: AiSearchResult = { ...searched([[0.5]]), outcome: 'single', worlds: 0, values: new Float64Array(0) }
    expect(selectSearchedClass(single, 0, SETTINGS, rng)).toMatchObject({ index: 0, rail: 'single', temperature: 0 })
    const none: AiSearchResult = { outcome: 'single', classes: [], worlds: 0, steps: 0, values: new Float64Array(0) }
    expect(selectSearchedClass(none, 0, SETTINGS, rng)).toEqual({ index: -1, rail: 'single', temperature: 0, candidates: [] })
    expect(rng.calls).toBe(0)
  })

  it('takes the first winning class without randomness', () => {
    const base = searched([[0.5], [0.5], [0.5]])
    const win: AiSearchResult = {
      ...base,
      outcome: 'win',
      classes: base.classes.map((entry, index) => ({ ...entry, winsNow: index > 0 })),
    }
    const rng = scriptedRng(0)
    expect(selectSearchedClass(win, 0, SETTINGS, rng)).toMatchObject({ index: 1, rail: 'win', candidates: [{ index: 1, probability: 1 }] })
    expect(rng.calls).toBe(0)
  })

  it('plays the best estimate at the critical threshold or without temperature', () => {
    const result = searched([
      [0.5, 0.5, 0.5],
      [0.52, 0.52, 0.52],
    ])
    const rng = scriptedRng(0)
    expect(selectSearchedClass(result, 1, SETTINGS, rng)).toMatchObject({ index: 1, rail: 'critical', temperature: 0 })
    expect(selectSearchedClass(result, 0.5, { ...SETTINGS, criticalThreshold: 0.5 }, rng)).toMatchObject({ index: 1, rail: 'critical' })
    expect(selectSearchedClass(result, 0, { ...SETTINGS, temperature: 0 }, rng)).toMatchObject({ index: 1, rail: 'critical' })
    expect(selectSearchedClass(result, Number.NaN, SETTINGS, rng)).toMatchObject({ index: 1, rail: 'critical' })
    expect(rng.calls).toBe(0)
  })

  it('samples only finalists within the margin of the best, however noisy the estimates', () => {
    const result = searched(
      [
        [0.6, 0.6, 0.6, 0.6], // best
        [0.59, 0.59, 0.59, 0.59], // 0.01 behind
        [0.3, 0.3, 0.3, 0.3], // far behind
        [0.6, 0.6], // as good, but halved away
        [0.7, 0.4, 0.7, 0.4], // 0.05 behind with a large standard error
        [0.62, 0.54, 0.62, 0.54], // 0.02 behind with a standard error
      ],
      [true, true, true, false, true, true],
    )
    const selection = selectSearchedClass(result, 0, SETTINGS, scriptedRng(0.5))
    expect(selection.rail).toBe('sampled')
    expect(selection.temperature).toBe(SETTINGS.temperature)
    expect(selection.candidates.map((candidate) => candidate.index)).toEqual([0, 1, 5])
    expect(selection.candidates[2].gap).toBeCloseTo(0.02, 12)
    expect(selection.candidates[2].gapError).toBeCloseTo(0.0231, 4)
    const total = selection.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)
    expect(total).toBeCloseTo(1, 12)
    const [best, near, further] = selection.candidates.map((candidate) => candidate.probability)
    expect(best).toBeGreaterThan(near)
    expect(near).toBeGreaterThan(further)

    const counts = choiceCounts(result, 0, SETTINGS)
    expect(counts[2]).toBe(0)
    expect(counts[3]).toBe(0)
    expect(counts[4]).toBe(0)
    expect(counts[0]).toBeGreaterThan(counts[1])
    expect(counts[1]).toBeGreaterThan(counts[5])
    expect(counts[5]).toBeGreaterThan(0)

    // A wider margin admits the noisy class, still never the halved-away one.
    const wide = selectSearchedClass(result, 0, { ...SETTINGS, margin: 0.06 }, scriptedRng(0.5))
    expect(wide.candidates.map((candidate) => candidate.index)).toEqual([0, 1, 4, 5])
  })

  it('uses one draw and maps it through the cumulative probabilities', () => {
    const result = searched([
      [0.5, 0.5],
      [0.5, 0.5],
    ])
    const low = scriptedRng(0.1)
    expect(selectSearchedClass(result, 0, SETTINGS, low).index).toBe(0)
    expect(low.calls).toBe(1)
    expect(selectSearchedClass(result, 0, SETTINGS, scriptedRng(0.9)).index).toBe(1)
    expect(selectSearchedClass(result, 0, SETTINGS, scriptedRng(0.9)).candidates.map((candidate) => candidate.probability)).toEqual([0.5, 0.5])
  })

  it('cools as criticality rises', () => {
    const result = searched([
      [0.6, 0.6, 0.6],
      [0.58, 0.58, 0.58],
    ])
    const calm = selectSearchedClass(result, 0, SETTINGS, scriptedRng(0))
    const tense = selectSearchedClass(result, 0.5, SETTINGS, scriptedRng(0))
    expect(tense.temperature).toBeCloseTo(SETTINGS.temperature / 2, 12)
    expect(tense.candidates[0].probability).toBeGreaterThan(calm.candidates[0].probability)
    const calmCounts = choiceCounts(result, 0, SETTINGS)
    const tenseCounts = choiceCounts(result, 0.5, SETTINGS)
    expect(tenseCounts[1]).toBeLessThan(calmCounts[1])
  })

  it('chooses a legal finalist among its candidates in real searches, and repeats for the same seed', () => {
    const weights = weightVector(HARD_AI_WEIGHTS)
    const budget = resolveSearchBudget({ determinizations: 4, rolloutTurns: 2 })
    const states = TEST_DECK_KINDS.flatMap((kind, index) => randomDecisionStates(2100 + index, kind, 80)).filter(
      (state, step) => step % 3 === 0 && canonicalActionClasses(state, getLegalActions(state, activeActor(state))).length >= 2,
    )
    expect(states.length).toBeGreaterThan(40)
    let sampledWithChoice = 0
    for (const [index, state] of states.entries()) {
      const actor = activeActor(state)
      const result = searchActionValues(state, actor, getLegalActions(state, actor), {
        searchSeed: index,
        budget,
        rootWeights: weights,
        opponentWeights: weights,
        opponentSeesHand: false,
      })
      const criticality = decisionCriticality(state)
      const selection = selectSearchedClass(result, criticality, SETTINGS, createAiRng(index))
      expect(selectSearchedClass(result, criticality, SETTINGS, createAiRng(index))).toEqual(selection)
      const chosen = result.classes[selection.index]
      expect(isLegalActionForState(state, chosen.action)).toBe(true)
      expect(selection.candidates.map((candidate) => candidate.index)).toContain(selection.index)
      if (selection.rail === 'win') continue
      expect(chosen.finalist).toBe(true)
      if (selection.rail !== 'sampled') {
        expect(selection.index).toBe(bestClassIndex(result))
        continue
      }
      expect(criticality).toBeLessThan(SETTINGS.criticalThreshold)
      const total = selection.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)
      expect(total).toBeCloseTo(1, 12)
      for (const candidate of selection.candidates) {
        expect(result.classes[candidate.index].finalist).toBe(true)
        expect(candidate.gap).toBeLessThanOrEqual(SETTINGS.margin + 1e-12)
      }
      sampledWithChoice += selection.candidates.length >= 2 ? 1 : 0
    }
    expect(sampledWithChoice).toBeGreaterThan(5)
  })
})

describe('AI decision criticality on game states', () => {
  it('is within [0, 1] for every sampled state', () => {
    const states: GameState[] = TEST_DECK_KINDS.flatMap((kind, index) => randomDecisionStates(2200 + index, kind, 60))
    for (const state of states) {
      const criticality = decisionCriticality(state)
      expect(criticality).toBeGreaterThanOrEqual(0)
      expect(criticality).toBeLessThanOrEqual(1)
    }
    expect(new Set(states.map(decisionCriticality)).size).toBeGreaterThanOrEqual(3)
  })
})
