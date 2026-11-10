// Canonical action classes.
//
// Cards with the same name are mechanically identical: a card is only a land
// name, and battlefield entries carry no other state. Legal actions that move
// cards of the same names therefore lead to equivalent positions, so the AI
// scores each class once. Classes are sorted by key and represented by the
// member with the smallest card ids, which makes choices independent of the
// order of cards within a zone.

import type { GameAction, GameState } from './types'

export interface AiActionClass {
  /** The action type plus the names of every card the action names. */
  readonly key: string
  /** A legal member chosen by card ids alone. */
  readonly representative: GameAction
  /** How many legal actions share the key. */
  readonly size: number
}

function opponentOf(actor: number): 0 | 1 {
  return actor === 0 ? 1 : 0
}

function nameOfTarget(found: { name: string } | undefined, targetId: string): string {
  return found ? found.name : `#${targetId}`
}

// The name of the card or land an effect of `effectName` targets.
function effectTargetName(
  state: GameState,
  actor: number,
  effectName: string | undefined,
  targetId: string | undefined,
): string {
  if (targetId === undefined) {
    return ''
  }
  const me = state.players[actor]
  const enemy = state.players[opponentOf(actor)]
  switch (effectName) {
    case 'Forest':
      return nameOfTarget(me.graveyard.find((card) => card.id === targetId), targetId)
    case 'Mountain':
      return nameOfTarget(enemy.battlefield.find((entry) => entry.instanceId === targetId)?.card, targetId)
    case 'Swamp':
      return nameOfTarget(enemy.hand.find((card) => card.id === targetId), targetId)
    case 'Plains':
      return nameOfTarget(me.battlefield.find((entry) => entry.instanceId === targetId)?.card, targetId)
    default:
      return `#${targetId}`
  }
}

/** The class key of one legal action in `state`. */
export function actionClassKey(state: GameState, action: GameAction): string {
  const me = state.players[action.actor]
  if (!me) {
    return `invalid-actor|${action.actor}`
  }
  switch (action.type) {
    case 'play_land': {
      const name = me.hand.find((card) => card.id === action.cardId)?.name ?? `#${action.cardId}`
      return `play|${name}|${effectTargetName(state, action.actor, name, action.effectTargetId)}`
    }
    case 'resolve_plains_reuse': {
      const reused = state.pendingPlainsReuse?.reusedCardName
      return `plains|${reused ?? ''}|${effectTargetName(state, action.actor, reused, action.effectTargetId)}`
    }
    case 'resolve_swamp_discard':
      return `swamp|${effectTargetName(state, action.actor, 'Swamp', action.effectTargetId)}`
    case 'counter_land': {
      const discard = action.discardCardId
      const name = discard === undefined ? '' : nameOfTarget(me.hand.find((card) => card.id === discard), discard)
      return `counter|${name}`
    }
    case 'pass_response':
      return 'pass'
    case 'end_turn':
      return 'end'
    default:
      return `unknown|${(action as { type?: unknown }).type}`
  }
}

function idOrder(action: GameAction): string {
  switch (action.type) {
    case 'play_land':
      return `${action.cardId}|${action.effectTargetId ?? ''}`
    case 'resolve_plains_reuse':
    case 'resolve_swamp_discard':
      return action.effectTargetId ?? ''
    case 'counter_land':
      return action.discardCardId ?? ''
    default:
      return ''
  }
}

/** Groups legal actions into classes sorted by key. */
export function canonicalActionClasses(state: GameState, actions: readonly GameAction[]): AiActionClass[] {
  const byKey = new Map<string, { representative: GameAction; order: string; size: number }>()
  for (const action of actions) {
    const key = actionClassKey(state, action)
    const order = idOrder(action)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { representative: action, order, size: 1 })
      continue
    }
    existing.size += 1
    if (order < existing.order) {
      existing.representative = action
      existing.order = order
    }
  }
  const keys = [...byKey.keys()].sort()
  return keys.map((key) => {
    const entry = byKey.get(key)!
    return { key, representative: entry.representative, size: entry.size }
  })
}
