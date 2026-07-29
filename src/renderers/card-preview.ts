import type { GamePhase } from '../game/types'

export interface CardPreviewContext {
  readonly phase: GamePhase
  readonly pendingPlayLandTargetSelection: boolean
  readonly menuOpen: boolean
}

export function isCardPreviewSuppressed(context: CardPreviewContext): boolean {
  return context.menuOpen
    || context.pendingPlayLandTargetSelection
    || context.phase === 'plains_target'
    || context.phase === 'swamp_target'
}

export function canPreviewCard(context: CardPreviewContext, isTarget = false): boolean {
  return !isTarget && !isCardPreviewSuppressed(context)
}
