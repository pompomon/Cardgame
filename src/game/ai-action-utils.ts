import type { BasicLand, GameAction, GameState } from './types'

export function cardNameForPlayAction(
  state: GameState,
  actor: number,
  action: Extract<GameAction, { type: 'play_land' }>,
): string | null {
  const card = state.players[actor].hand.find((entry) => entry.id === action.cardId)
  return card?.name ?? null
}

export function reusedCardNameForPlainsReuseAction(
  state: GameState,
  action: Extract<GameAction, { type: 'resolve_plains_reuse' }>,
): BasicLand | null {
  const pending = state.pendingPlainsReuse
  if (!pending || pending.actor !== action.actor) {
    return null
  }
  return pending.reusedCardName
}
