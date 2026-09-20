import { isLegalActionForState } from '../../app/action-validation'
import { applyAction, createInitialGame } from '../../game/engine'
import type { BasicLand, Card, GameAction } from '../../game/types'

// Synthetic, ordered 50-card decks; every subsequent state is reached by legal
// actions, not hand-authored pending snapshots or a captured historical game.
export const compatibilitySeed = 1700

function deck(player: number, opening: BasicLand[]): Card[] {
  return Array.from({ length: 50 }, (_, index) => ({
    id: `fixture-p${player}-card-${index}`,
    name: opening[index] ?? 'Forest',
    type: 'land',
  }))
}

export function createCompatibilityInitialState() {
  return createInitialGame(compatibilitySeed, [
    deck(0, ['Island', 'Forest', 'Mountain', 'Swamp', 'Plains', 'Plains', 'Plains', 'Plains', 'Island']),
    deck(1, ['Island', 'Forest', 'Forest', 'Mountain', 'Swamp', 'Island', 'Mountain', 'Forest', 'Swamp']),
  ])
}

export const compatibilityActions: readonly GameAction[] = [
  { type: 'play_land', actor: 0, cardId: 'fixture-p0-card-0' },
  { type: 'counter_land', actor: 1, discardCardId: 'fixture-p1-card-1' },
  { type: 'end_turn', actor: 0 },
  { type: 'play_land', actor: 1, cardId: 'fixture-p1-card-2', effectTargetId: 'fixture-p1-card-1' },
  { type: 'end_turn', actor: 1 },
  { type: 'play_land', actor: 0, cardId: 'fixture-p0-card-1', effectTargetId: 'fixture-p0-card-0' },
  { type: 'pass_response', actor: 1 },
  { type: 'end_turn', actor: 0 },
  { type: 'play_land', actor: 1, cardId: 'fixture-p1-card-3', effectTargetId: 'p0-2' },
  { type: 'counter_land', actor: 0, discardCardId: 'fixture-p0-card-5' },
  { type: 'end_turn', actor: 1 },
  { type: 'play_land', actor: 0, cardId: 'fixture-p0-card-2', effectTargetId: 'p1-1' },
  { type: 'pass_response', actor: 1 },
  { type: 'end_turn', actor: 0 },
  { type: 'play_land', actor: 1, cardId: 'fixture-p1-card-1', effectTargetId: 'fixture-p1-card-3' },
  { type: 'end_turn', actor: 1 },
  { type: 'play_land', actor: 0, cardId: 'fixture-p0-card-3' },
  { type: 'pass_response', actor: 1 },
  { type: 'resolve_swamp_discard', actor: 0, effectTargetId: 'fixture-p1-card-6' },
  { type: 'end_turn', actor: 0 },
  { type: 'end_turn', actor: 1 },
  { type: 'play_land', actor: 0, cardId: 'fixture-p0-card-4', effectTargetId: 'p0-2' },
  { type: 'pass_response', actor: 1 },
  { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'fixture-p0-card-5' },
  { type: 'end_turn', actor: 0 },
  { type: 'end_turn', actor: 1 },
  { type: 'play_land', actor: 0, cardId: 'fixture-p0-card-6', effectTargetId: 'p0-3' },
  { type: 'pass_response', actor: 1 },
  { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'p1-4' },
  { type: 'end_turn', actor: 0 },
  { type: 'end_turn', actor: 1 },
  { type: 'play_land', actor: 0, cardId: 'fixture-p0-card-7', effectTargetId: 'p0-5' },
  { type: 'pass_response', actor: 1 },
  { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'fixture-p1-card-4' },
  { type: 'end_turn', actor: 0 },
  { type: 'end_turn', actor: 1 },
  { type: 'play_land', actor: 0, cardId: 'fixture-p0-card-8' },
  { type: 'pass_response', actor: 1 },
]

export function compatibilityTimeline() {
  const initial = createCompatibilityInitialState()
  let state = initial
  const steps = compatibilityActions.map((action) => {
    if (!isLegalActionForState(state, action)) {
      throw new Error(`Illegal compatibility fixture action: ${JSON.stringify(action)}`)
    }
    const before = state
    state = applyAction(state, action)
    return { action, before, state }
  })
  return { initial, steps }
}

export const compatibilityDecisions = compatibilityTimeline().steps.flatMap((step, index) => (
  step.before.phase === 'respond'
  || step.before.phase === 'swamp_target'
  || step.before.phase === 'plains_target'
    ? [{
      label: `${index}: ${step.before.phase} ${step.before.pendingPlainsReuse?.reusedCardName
        ?? step.before.pendingLandPlay?.card.name ?? 'Swamp'}`,
      index,
      finishesGame: step.state.phase === 'gameOver',
    }]
    : []
))
