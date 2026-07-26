import type { GameState } from '../game/types'

export function activeActor(game: GameState): number {
  if (game.phase === 'respond' && game.pendingLandPlay) {
    return game.pendingLandPlay.actor === 0 ? 1 : 0
  }
  if (game.phase === 'plains_target' && game.pendingPlainsReuse) {
    return game.pendingPlainsReuse.actor
  }
  if (game.phase === 'swamp_target' && game.pendingSwampDiscard) {
    return game.pendingSwampDiscard.actor
  }
  return game.currentPlayer
}
