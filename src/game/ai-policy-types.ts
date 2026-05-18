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

export interface AiPolicyInput {
  state: GameState
  actor: number
  actions: GameAction[]
  context: AiPolicyContext
}

export type AiPolicy = (input: AiPolicyInput) => GameAction | null
