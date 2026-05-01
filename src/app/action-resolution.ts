import type { GameAction } from '../game/types'
import type { GameUiState } from './types'

export type DragDropResolution =
  | { kind: 'invalid' }
  | { kind: 'single'; action: Extract<GameAction, { type: 'play_land' }> }
  | {
      kind: 'needs_target'
      actor: number
      cardId: string
      options: Array<{ effectTargetId?: string; label: string }>
    }

export function resolvePlayLandDrop(game: GameUiState, cardId: string): DragDropResolution {
  const options = game.legal.playLandByCard[cardId]
  if (!options || options.length === 0) {
    return { kind: 'invalid' }
  }

  if (options.length === 1) {
    return { kind: 'single', action: options[0].action }
  }

  return {
    kind: 'needs_target',
    actor: game.actor,
    cardId,
    options: options.map((option) => ({
      effectTargetId: option.action.effectTargetId,
      label: option.label,
    })),
  }
}

export function resolveTargetedPlayLandAction(
  game: GameUiState,
  cardId: string,
  effectTargetId?: string,
): Extract<GameAction, { type: 'play_land' }> | null {
  const options = game.legal.playLandByCard[cardId]
  if (!options || options.length === 0) {
    return null
  }

  const match = options.find((option) => option.action.effectTargetId === effectTargetId)
  return match?.action ?? null
}
