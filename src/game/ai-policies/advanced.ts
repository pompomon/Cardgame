import { chooseStrategicAction } from '../ai-evaluation'
import type { AiPolicy } from '../ai-policy-types'

export const advancedPolicy: AiPolicy = ({ state, actor, actions, context }) =>
  chooseStrategicAction(state, actor, actions, context)
