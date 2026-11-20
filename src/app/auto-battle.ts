// Auto battle: while it is on, the Hard AI plays the human's seat in a Human
// vs AI game (`local-hvai`) or an Adventure encounter (`adventure-hvai`).
//
// The flag overrides who acts for a seat; it never changes `controllers`.
// Redaction, board perspective, the log and recordings keep the real
// controllers, so the opponent's hand stays hidden while Hard plays. Only
// the AI scheduler, input gating (`actorControl`) and the Swamp reveal read
// the effective seats below.
//
// This is a leaf module with type-only imports: never storage, the DOM, the
// controller or a renderer.

import type { AiLevel, AppState, ControllerKind, Mode } from './types'

export type AutoBattleInput = Pick<AppState,
  'autoBattle' | 'mode' | 'replay' | 'game' | 'controllers' | 'adventure' | 'aiLevel'>

/** The level that plays the human's seat. The opponent keeps `aiLevel`. */
export const AUTO_BATTLE_AI_LEVEL: AiLevel = 'hard'

/** Human vs AI modes, the only ones that offer Auto battle. */
export function isAutoBattleMode(mode: Mode | null): boolean {
  return mode === 'local-hvai' || mode === 'adventure-hvai'
}

/**
 * Whether Auto battle may be on now: a Human vs AI mode outside replay, with
 * no Adventure result waiting to be saved and, in Adventure, a run still in
 * progress.
 */
export function canEnableAutoBattle(state: AutoBattleInput): boolean {
  if (!isAutoBattleMode(state.mode) || state.replay !== null || state.adventure.pendingCompletion !== null) {
    return false
  }
  if (state.mode !== 'adventure-hvai') {
    return true
  }
  const status = state.adventure.run?.status
  return status === 'active' || status === 'paused'
}

/** Whether Hard plays `actor`'s seat now: the human's seat, in a game that is not over. */
export function isAutoBattleSeat(state: AutoBattleInput, actor: number): boolean {
  return state.autoBattle
    && state.game !== null
    && state.game.phase !== 'gameOver'
    && state.controllers[actor] === 'human'
    && canEnableAutoBattle(state)
}

/** The level that plays `actor`'s seat, or null when a person plays it. */
export function aiLevelForSeat(state: AutoBattleInput, actor: number): AiLevel | null {
  if (isAutoBattleSeat(state, actor)) {
    return AUTO_BATTLE_AI_LEVEL
  }
  return state.controllers[actor] === 'ai' ? state.aiLevel : null
}

/** The seats as they act: a new tuple with the auto seat as `'ai'`. */
export function effectiveControllers(state: AutoBattleInput): [ControllerKind, ControllerKind] {
  return [
    isAutoBattleSeat(state, 0) ? 'ai' : state.controllers[0],
    isAutoBattleSeat(state, 1) ? 'ai' : state.controllers[1],
  ]
}
