import type { AiRng } from './ai-random'
import { bestClassIndex, pairedDifference, type AiSearchResult } from './ai-search'
import type { GameState, PlayerState } from './types'

// How the Hard AI picks among searched action classes.
//
// Criticality says how close the game is to being decided, from what Hard can
// see: both hands and every public zone, never deck order. In critical
// positions Hard plays the class with the best estimate. Elsewhere it samples
// among the finalists whose estimates are within `margin` of the best; a
// softmax over the gaps makes nearer classes likelier, and it cools as
// criticality rises. A class is never sampled just because its estimate is
// noisy: measured against a larger search, that only added mistakes.

export interface AiSelectionSettings {
  /** Softmax temperature at criticality 0, in win probability. */
  readonly temperature: number
  /** How far a candidate's estimate may trail the best one, in win probability. */
  readonly margin: number
  /** Criticality from which the best class is always played. */
  readonly criticalThreshold: number
}

export const HARD_AI_DEFAULT_SELECTION: AiSelectionSettings = Object.freeze({
  temperature: 0.015,
  margin: 0.02,
  criticalThreshold: 1,
})

const SELECTION_LIMITS: Readonly<Record<keyof AiSelectionSettings, readonly [number, number]>> = Object.freeze({
  temperature: [0, 1],
  margin: [0, 1],
  criticalThreshold: [0, 1],
})

/** Complete settings: missing or non-finite fields take the defaults, others are clamped. */
export function resolveSelectionSettings(settings?: Partial<AiSelectionSettings>): AiSelectionSettings {
  const field = (name: keyof AiSelectionSettings): number => {
    const value = settings?.[name]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return HARD_AI_DEFAULT_SELECTION[name]
    }
    const [min, max] = SELECTION_LIMITS[name]
    return Math.min(max, Math.max(min, value))
  }
  return {
    temperature: field('temperature'),
    margin: field('margin'),
    criticalThreshold: field('criticalThreshold'),
  }
}

/** max(distinct names, copies of the most common name) on a player's battlefield. */
export function boardProgress(player: PlayerState): number {
  const counts = [0, 0, 0, 0, 0]
  for (const entry of player.battlefield) {
    switch (entry.card.name) {
      case 'Forest':
        counts[0] += 1
        break
      case 'Island':
        counts[1] += 1
        break
      case 'Mountain':
        counts[2] += 1
        break
      case 'Plains':
        counts[3] += 1
        break
      case 'Swamp':
        counts[4] += 1
        break
      default:
        break
    }
  }
  let distinct = 0
  let most = 0
  for (const count of counts) {
    if (count > 0) distinct += 1
    most = Math.max(most, count)
  }
  return Math.max(distinct, most)
}

// Criticality by the furthest player's progress, from zero to three lands;
// four lands or more is critical.
const CALM_CRITICALITY: readonly number[] = Object.freeze([0, 0, 0.25, 0.5])
// A deck this small can run out within two turns, and drawing from an empty
// deck loses.
const DECK_OUT_DANGER = 2

/**
 * How decided the game is, from 0 (calm) to 1 (critical). It is 1 when either
 * player is at four lands of a winning set, which covers every winning card in
 * hand and every land that wins on resolution, or can run out of cards within
 * two turns. Otherwise it grows with the furthest player's progress.
 */
export function decisionCriticality(state: GameState): number {
  if (state.phase === 'gameOver') {
    return 1
  }
  let progress = 0
  for (const player of state.players) {
    if (player.deck.length <= DECK_OUT_DANGER) {
      return 1
    }
    progress = Math.max(progress, boardProgress(player))
  }
  return CALM_CRITICALITY[progress] ?? 1
}

/** `win`, `critical` and `single` are deterministic rails; `sampled` used the selection stream. */
export type AiSelectionRail = 'single' | 'win' | 'critical' | 'sampled'

export interface AiSelectionCandidate {
  /** Index into the search result's classes. */
  readonly index: number
  /** How far the class trails the best, in win probability. */
  readonly gap: number
  /** Standard error of `gap`. */
  readonly gapError: number
  readonly probability: number
}

export interface AiSelection {
  /** Index of the chosen class; −1 when there is none. */
  readonly index: number
  readonly rail: AiSelectionRail
  /** The softmax temperature used; 0 on a rail. */
  readonly temperature: number
  readonly candidates: readonly AiSelectionCandidate[]
}

function onRail(index: number, rail: AiSelectionRail): AiSelection {
  return {
    index,
    rail,
    temperature: 0,
    candidates: index < 0 ? [] : [{ index, gap: 0, gapError: 0, probability: 1 }],
  }
}

/**
 * Chooses a class of `result`. Rails come first: a single class, the first
 * class that wins before the opponent can answer, then the best estimate when
 * `criticality` reaches the threshold. Otherwise one `rng.next()` samples the
 * candidates.
 */
export function selectSearchedClass(
  result: AiSearchResult,
  criticality: number,
  settings: AiSelectionSettings,
  rng: AiRng,
): AiSelection {
  switch (result.outcome) {
    case 'single':
      return onRail(result.classes.length > 0 ? 0 : -1, 'single')
    case 'win':
      return onRail(result.classes.findIndex((entry) => entry.winsNow), 'win')
    case 'searched':
      break
    default:
      return onRail(bestClassIndex(result), 'critical')
  }
  const best = bestClassIndex(result)
  const calm = 1 - Math.min(1, Math.max(0, Number.isFinite(criticality) ? criticality : 1))
  const temperature = settings.temperature * calm
  if (best < 0 || criticality >= settings.criticalThreshold || !(temperature > 0)) {
    return onRail(best, 'critical')
  }

  const candidates: { index: number; gap: number; gapError: number; weight: number }[] = []
  let total = 0
  for (let index = 0; index < result.classes.length; index += 1) {
    if (!result.classes[index].finalist) continue
    let gap = 0
    let gapError = 0
    if (index !== best) {
      const difference = pairedDifference(result, best, index)
      gap = Math.max(0, difference.mean)
      gapError = difference.standardError
      if (gap > settings.margin) continue
    }
    const weight = Math.exp(-gap / temperature)
    total += weight
    candidates.push({ index, gap, gapError, weight })
  }
  const draw = rng.next() * total
  let chosen = best
  let cumulative = 0
  for (const candidate of candidates) {
    cumulative += candidate.weight
    if (draw < cumulative) {
      chosen = candidate.index
      break
    }
  }
  return {
    index: chosen,
    rail: 'sampled',
    temperature,
    candidates: candidates.map(({ index, gap, gapError, weight }) => ({ index, gap, gapError, probability: weight / total })),
  }
}
