import { getLegalActions } from './engine'
import type { GameAction, GameState } from './types'
import { DEFAULT_AI_LEVEL, type AiLevel } from './ai-levels'
import type { AiPolicy, AiPolicyContext } from './ai-policy-types'
import { basicPolicy } from './ai-policies/basic'
import { advancedPolicy } from './ai-policies/advanced'
import { hardPolicy } from './ai-policies/hard'

interface AiPolicyRegistration {
  context: AiPolicyContext
  policy: AiPolicy
}

export const AI_POLICY_REGISTRY: Record<AiLevel, AiPolicyRegistration> = {
  basic: {
    context: {
      level: 'basic',
      visibility: {
        kind: 'partial',
        canInspectOpponentHand: false,
      },
    },
    policy: basicPolicy,
  },
  advanced: {
    context: {
      level: 'advanced',
      visibility: {
        kind: 'partial',
        canInspectOpponentHand: false,
      },
    },
    policy: advancedPolicy,
  },
  hard: {
    context: {
      level: 'hard',
      visibility: {
        kind: 'full',
        canInspectOpponentHand: true,
      },
    },
    policy: hardPolicy,
  },
}

export function chooseAiAction(
  state: GameState,
  actor: number,
  options: { level: AiLevel } = { level: DEFAULT_AI_LEVEL },
): GameAction | null {
  const actions = getLegalActions(state, actor)
  if (actions.length === 0) {
    return null
  }
  const registration = AI_POLICY_REGISTRY[options.level] ?? AI_POLICY_REGISTRY[DEFAULT_AI_LEVEL]
  return registration.policy({
    state,
    actor,
    actions,
    context: registration.context,
  })
}
