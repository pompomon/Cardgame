import type { GameAction, GameState } from './types'
import type { AiPolicyContext } from './ai-policy-types'
import { cardNameForPlayAction } from './ai-action-utils'

export function normalizeActionForVisibility(
  state: GameState,
  actor: number,
  action: GameAction,
  context: AiPolicyContext,
): GameAction {
  if (context.visibility.kind === 'full' || action.type !== 'play_land' || !action.effectTargetId) {
    return action
  }
  const cardName = cardNameForPlayAction(state, actor, action)
  // Advanced mode can react to hidden-hand effects but should not choose among
  // hidden-card targets using unseen card identity.
  if (cardName === 'Swamp') {
    return { ...action, effectTargetId: undefined }
  }
  return action
}
