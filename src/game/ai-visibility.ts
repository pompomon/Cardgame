import type { GameAction, GameState } from './types'
import type { AiPolicyContext } from './ai-policy-types'
import { cardNameForPlayAction, reusedCardNameForPlainsReuseAction } from './ai-action-utils'

export function normalizeActionForVisibility(
  state: GameState,
  actor: number,
  action: GameAction,
  context: AiPolicyContext,
): GameAction {
  if (context.visibility.kind === 'full') {
    return action
  }
  if (action.type !== 'play_land' && action.type !== 'resolve_plains_reuse') {
    return action
  }
  if (!action.effectTargetId) {
    return action
  }

  const cardName = action.type === 'play_land'
    ? cardNameForPlayAction(state, actor, action)
    : reusedCardNameForPlainsReuseAction(state, action)
  // Advanced mode can react to hidden-hand effects but should not choose among
  // hidden-card targets using unseen card identity.
  if (cardName === 'Swamp') {
    return { ...action, effectTargetId: undefined }
  }
  return action
}
