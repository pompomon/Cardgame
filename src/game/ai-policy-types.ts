import type { AiLevel } from './ai-levels'
import type { GameAction, GameState } from './types'

export interface AiVisibilityProfile {
  kind: 'partial' | 'full'
  canInspectOpponentHand: boolean
}

export interface AiPolicyContext {
  level: AiLevel
  visibility: AiVisibilityProfile
}

/**
 * Work limits of a search-based policy. A fixed budget, not a clock, bounds
 * each decision, so every device makes the same choice.
 */
export interface AiSearchBudget {
  /** Sampled deck orders (worlds) per decision. */
  readonly determinizations: number
  /** Turns each simulated continuation plays before its position is scored. */
  readonly rolloutTurns: number
  /** Chance that a simulated move is uniformly random instead of greedy. */
  readonly rolloutEpsilon: number
  /** Most engine steps one decision may take. */
  readonly maxEngineSteps: number
}

export interface AiPolicyInput {
  state: GameState
  actor: number
  actions: GameAction[]
  context: AiPolicyContext
  /**
   * The game seed. Seeded policies derive all randomness from it and the
   * decision state, so a decision repeats exactly for the same inputs.
   */
  seed?: number
  /** Search limits; omitted fields keep the policy's defaults. */
  budget?: Partial<AiSearchBudget>
}

export type AiPolicy = (input: AiPolicyInput) => GameAction | null
