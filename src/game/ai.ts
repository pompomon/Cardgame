import { getLegalActions } from './engine'
import type { GameAction, GameState } from './types'

export function chooseAiAction(state: GameState, actor: number): GameAction | null {
  const actions = getLegalActions(state, actor)
  if (actions.length === 0) {
    return null
  }

  const playLand = actions.find((action) => action.type === 'play_land')
  if (playLand) {
    return playLand
  }

  const castActions = actions.filter((action): action is Extract<GameAction, { type: 'cast_creature' }> => action.type === 'cast_creature')
  if (castActions.length > 0) {
    return castActions[castActions.length - 1]
  }

  const attackersAction = actions.find((action): action is Extract<GameAction, { type: 'declare_attackers' }> => action.type === 'declare_attackers' && action.attackerIds.length > 0)
  if (attackersAction) {
    return attackersAction
  }

  const blockersAction = actions.find((action): action is Extract<GameAction, { type: 'declare_blockers' }> => action.type === 'declare_blockers')
  if (blockersAction) {
    return blockersAction
  }

  return actions[0]
}
