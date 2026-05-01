import { getLegalActions } from './engine'
import type { GameAction, GameState } from './types'

export function chooseAiAction(state: GameState, actor: number): GameAction | null {
  const actions = getLegalActions(state, actor)
  if (actions.length === 0) {
    return null
  }

  const counterAction = actions.find((action) => action.type === 'counter_land')
  if (counterAction) {
    return counterAction
  }

  const playLand = actions.find((action) => action.type === 'play_land')
  if (playLand) {
    return playLand
  }

  const passResponse = actions.find((action) => action.type === 'pass_response')
  if (passResponse) {
    return passResponse
  }

  return actions[0]
}
