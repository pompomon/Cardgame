import { chooseStrategicAction } from '../ai-evaluation'
import type { AiPolicy } from '../ai-policy-types'

export const hardPolicy: AiPolicy = ({ state, actor, actions, context }) =>
  chooseStrategicAction(state, actor, actions, context)
