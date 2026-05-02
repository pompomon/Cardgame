import type { GameState } from '../game/types'

export function activeActor(game: GameState): number {
  if (game.phase === 'respond' && game.pendingLandPlay) {
    return game.pendingLandPlay.actor === 0 ? 1 : 0
  }
  return game.currentPlayer
}
