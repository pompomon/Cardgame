import type { AiPolicy } from '../ai-policy-types'

export const tutorialPolicy: AiPolicy = ({ actions }) => {
  const counter = actions.find((action) => action.type === 'counter_land')
  if (counter) {
    return counter
  }

  const pass = actions.find((action) => action.type === 'pass_response')
  if (pass) {
    return pass
  }

  const plainsReuse = actions.find((action) => action.type === 'resolve_plains_reuse')
  if (plainsReuse) {
    return plainsReuse
  }

  const safePlay = actions.find((action) => action.type === 'play_land' && action.effectTargetId === undefined)
  if (safePlay) {
    return safePlay
  }

  const endTurn = actions.find((action) => action.type === 'end_turn')
  if (endTurn) {
    return endTurn
  }

  return actions[0] ?? null
}
