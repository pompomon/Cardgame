import { personaForSeat, personaWeightVector, type AiPersona } from './ai-personas'
import type { AiPolicy, AiSearchBudget } from './ai-policy-types'
import { AI_RANDOM_STREAM, createAiRng, decisionFingerprint, deriveAiSeed } from './ai-random'
import { resolveSearchBudget, searchActionValues, type AiSearchResult } from './ai-search'
import {
  decisionCriticality,
  resolveSelectionSettings,
  selectSearchedClass,
  type AiSelection,
  type AiSelectionSettings,
} from './ai-selection'
import type { GameAction, GameState } from './types'

// The Hard AI: a persona from the game seed, a determinized search of every
// action class, and a seeded choice among the classes the search cannot tell
// apart. Critical positions are searched with a seed that does not depend on
// the game and with the balanced weights, and played by best estimate, so
// Hard meets them the same way in every game.

// Seeds the search of critical positions in every game.
const CRITICAL_SEARCH_SEED = 0x48415244

export interface HardDecisionOptions {
  /** The game seed; without one, decisions vary only with the position. */
  readonly seed?: number
  readonly budget?: Partial<AiSearchBudget>
  readonly selection?: Partial<AiSelectionSettings>
  /** Replaces the persona the seed picks, for measurements. */
  readonly persona?: AiPersona
}

export interface HardDecision {
  readonly action: GameAction | null
  readonly persona: AiPersona
  /** 0 (calm) to 1 (critical); see `decisionCriticality`. */
  readonly criticality: number
  readonly searchSeed: number
  readonly search: AiSearchResult
  readonly selection: AiSelection
}

/**
 * The Hard AI's decision for `actor` with its statistics, criticality,
 * candidates and their probabilities. `actions` are the legal actions.
 */
export function explainHardDecision(
  state: GameState,
  actor: number,
  actions: readonly GameAction[],
  options: HardDecisionOptions = {},
): HardDecision {
  const seed = options.seed ?? 0
  const settings = resolveSelectionSettings(options.selection)
  const criticality = decisionCriticality(state)
  const critical = criticality >= settings.criticalThreshold
  const persona = options.persona ?? personaForSeat(seed, actor)
  const fingerprint = decisionFingerprint(state, actor)
  const searchSeed = deriveAiSeed(critical ? CRITICAL_SEARCH_SEED : seed, fingerprint, actor, AI_RANDOM_STREAM.search)
  const balanced = personaWeightVector('balanced')
  const search = searchActionValues(state, actor, actions, {
    searchSeed,
    budget: resolveSearchBudget(options.budget),
    rootWeights: critical ? balanced : personaWeightVector(persona),
    opponentWeights: balanced,
    opponentSeesHand: false,
  })
  const selection = selectSearchedClass(
    search,
    criticality,
    settings,
    createAiRng(deriveAiSeed(seed, fingerprint, actor, AI_RANDOM_STREAM.selection)),
  )
  return {
    action: search.classes[selection.index]?.action ?? null,
    persona,
    criticality,
    searchSeed,
    search,
    selection,
  }
}

export const hardSearchPolicy: AiPolicy = ({ state, actor, actions, seed, budget }) => {
  if (actions.length === 0) {
    return null
  }
  return explainHardDecision(state, actor, actions, { seed, budget }).action
}
