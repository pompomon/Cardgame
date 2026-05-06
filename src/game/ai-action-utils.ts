import type { GameAction, GameState } from './types'

export function cardNameForPlayAction(
  state: GameState,
  actor: number,
  action: Extract<GameAction, { type: 'play_land' }>,
): string | null {
  const card = state.players[actor].hand.find((entry) => entry.id === action.cardId)
  return card?.name ?? null
}
