import type { AiPolicy } from '../ai-policy-types'

export const basicPolicy: AiPolicy = ({ actions }) => {
  if (actions.length === 0) {
    return null
  }
  return actions[0]
}
