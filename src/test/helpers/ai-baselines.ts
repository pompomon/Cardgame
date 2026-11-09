import { chooseAiAction } from '../../game/ai'
import { chooseStrategicAction } from '../../game/ai-evaluation'
import type { AiPolicyContext } from '../../game/ai-policy-types'
import { getLegalActions } from '../../game/engine'
import type { TournamentEntrant } from './ai-tournament'

// Reference opponents for AI measurements. `legacy-hard` freezes the Hard
// level as it was before search (Advanced's one-step scorer with full
// visibility), so later changes are always measured against it.

const LEGACY_HARD_CONTEXT: AiPolicyContext = {
  level: 'hard',
  visibility: { kind: 'full', canInspectOpponentHand: true },
}

export const LEGACY_HARD: TournamentEntrant = {
  name: 'legacy-hard',
  policy: (state, actor) => chooseStrategicAction(state, actor, getLegalActions(state, actor), LEGACY_HARD_CONTEXT),
}

export const ADVANCED: TournamentEntrant = {
  name: 'advanced',
  policy: (state, actor, seed) => chooseAiAction(state, actor, { level: 'advanced', seed }),
}

export const BASIC: TournamentEntrant = {
  name: 'basic',
  policy: (state, actor, seed) => chooseAiAction(state, actor, { level: 'basic', seed }),
}

/** The registered Hard level, whatever policy it currently uses. */
export const HARD: TournamentEntrant = {
  name: 'hard',
  policy: (state, actor, seed) => chooseAiAction(state, actor, { level: 'hard', seed }),
}
