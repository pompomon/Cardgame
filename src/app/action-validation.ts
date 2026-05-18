// Action shape & legality validation used by the controller and recording
// importer. Lives in `src/app/` (not `src/game/`) because it bridges
// untrusted input (P2P payloads, imported recordings) into the engine's
// strict types — the engine itself trusts its inputs.
//
// Extracted from `src/app/controller.ts` so the controller can focus on
// state machine + side effects.

import { canAct, getLegalActions } from '../game/engine'
import type { GameAction, GameState } from '../game/types'
import { isNonNegativeInteger } from './validators'

export function isGameAction(payload: unknown): payload is GameAction {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  const action = payload as {
    type?: unknown
    actor?: unknown
    cardId?: unknown
    effectTargetId?: unknown
    discardCardId?: unknown
  }
  if (typeof action.type !== 'string' || typeof action.actor !== 'number') {
    return false
  }
  if (action.type === 'play_land') {
    if (typeof action.cardId !== 'string') {
      return false
    }
    return action.effectTargetId === undefined || typeof action.effectTargetId === 'string'
  }
  if (action.type === 'resolve_plains_reuse') {
    return action.effectTargetId === undefined || typeof action.effectTargetId === 'string'
  }
  if (action.type === 'counter_land') {
    return action.discardCardId === undefined || typeof action.discardCardId === 'string'
  }
  return action.type === 'end_turn' || action.type === 'pass_response'
}

export function isSameAction(left: GameAction, right: GameAction): boolean {
  if (left.type !== right.type || left.actor !== right.actor) {
    return false
  }
  if (left.type === 'play_land' && right.type === 'play_land') {
    return left.cardId === right.cardId && left.effectTargetId === right.effectTargetId
  }
  if (left.type === 'resolve_plains_reuse' && right.type === 'resolve_plains_reuse') {
    return left.effectTargetId === right.effectTargetId
  }
  if (left.type === 'counter_land' && right.type === 'counter_land') {
    return left.discardCardId === right.discardCardId
  }
  return true
}

export function isLegalActionForState(state: GameState, action: GameAction): boolean {
  if (!canAct(state, action.actor)) {
    return false
  }
  return getLegalActions(state, action.actor).some((candidate) => isSameAction(candidate, action))
}

export function isSeedPayload(payload: unknown): payload is { seed: number } {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  // Seeds cross the P2P trust boundary and feed `createInitialGame`, which
  // would happily accept `Infinity`/`NaN`/fractions and produce a corrupt
  // shared game state. Constrain to non-negative integers, matching how
  // the controller generates seeds locally (`Date.now()`).
  return isNonNegativeInteger((payload as { seed?: unknown }).seed)
}
