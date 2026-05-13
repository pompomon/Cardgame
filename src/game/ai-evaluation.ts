import { applyAction } from './engine'
import type { BasicLand, GameAction, GameState, PlayerState } from './types'
import type { AiPolicyContext } from './ai-policy-types'
import { normalizeActionForVisibility } from './ai-visibility'
import { cardNameForPlayAction, reusedCardNameForPlainsReuseAction } from './ai-action-utils'

function opponentOf(actor: number): 0 | 1 {
  return actor === 0 ? 1 : 0
}

function progressForPlayer(player: PlayerState): { uniqueCount: number; maxOfKind: number; score: number } {
  const names = player.battlefield.map((entry) => entry.card.name)
  const uniqueCount = new Set(names).size
  const counts = new Map<string, number>()
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const maxOfKind = [...counts.values()].reduce((max, value) => Math.max(max, value), 0)
  return {
    uniqueCount,
    maxOfKind,
    score: Math.max(uniqueCount, maxOfKind),
  }
}

function isNearWin(state: GameState, playerId: number): boolean {
  const progress = progressForPlayer(state.players[playerId])
  return progress.uniqueCount >= 4 || progress.maxOfKind >= 4
}

function immediateWinningCardCount(state: GameState, playerId: number): number {
  const player = state.players[playerId]
  const names = player.battlefield.map((entry) => entry.card.name)
  const unique = new Set(names)
  const counts = new Map<string, number>()
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  let winning = 0
  for (const card of player.hand) {
    const uniqueAfter = new Set(unique)
    uniqueAfter.add(card.name)
    const countAfter = (counts.get(card.name) ?? 0) + 1
    if (uniqueAfter.size >= 5 || countAfter >= 5) {
      winning += 1
    }
  }
  return winning
}

function findPlainsReusedLandName(
  state: GameState,
  actor: number,
  effectTargetId: string | undefined,
): BasicLand | null {
  if (!effectTargetId) {
    return null
  }
  const reused = state.players[actor].battlefield.find((entry) => entry.instanceId === effectTargetId)
  return reused?.card.name ?? null
}

function disruptionHintForAction(state: GameState, actor: number, action: GameAction): number {
  if (action.type === 'counter_land') {
    return 4
  }
  if (action.type === 'resolve_plains_reuse') {
    const reusedLand = reusedCardNameForPlainsReuseAction(state, action)
    if (reusedLand === 'Mountain') {
      return 3
    }
    if (reusedLand === 'Swamp') {
      return 2
    }
    return 0
  }
  if (action.type !== 'play_land') {
    return 0
  }
  const cardName = cardNameForPlayAction(state, actor, action)
  if (cardName === 'Mountain') {
    return 3
  }
  if (cardName === 'Swamp') {
    return 2
  }
  if (cardName === 'Plains') {
    const reusedLand = findPlainsReusedLandName(state, actor, action.effectTargetId)
    if (reusedLand === 'Mountain') {
      return 2.5
    }
    if (reusedLand === 'Swamp') {
      return 1.5
    }
  }
  return 0
}

function trimDeckForEvaluation(state: GameState, playerId: 0 | 1): PlayerState['deck'] {
  const deck = state.players[playerId].deck
  return deck.length > 0 ? [deck[0]] : []
}

function toEvaluationState(state: GameState): GameState {
  // AI scoring only needs immediate action outcomes, not full log history or
  // deep deck contents. Keeping one top card preserves single-draw behavior
  // while reducing per-candidate structuredClone payload size in applyAction.
  return {
    ...state,
    log: [],
    events: [],
    players: [
      {
        ...state.players[0],
        deck: trimDeckForEvaluation(state, 0),
      },
      {
        ...state.players[1],
        deck: trimDeckForEvaluation(state, 1),
      },
    ],
  }
}

export function chooseStrategicAction(
  state: GameState,
  actor: number,
  actions: GameAction[],
  context: AiPolicyContext,
): GameAction | null {
  if (actions.length === 0) {
    return null
  }

  const enemy = opponentOf(actor)
  const ownBefore = progressForPlayer(state.players[actor])
  const enemyBefore = progressForPlayer(state.players[enemy])
  const enemyNearWin = isNearWin(state, enemy)
  const knownEnemyThreatBefore = context.visibility.canInspectOpponentHand
    ? immediateWinningCardCount(state, enemy)
    : 0
  const evaluationState = toEvaluationState(state)

  let bestAction: GameAction | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  let bestIndex = Number.POSITIVE_INFINITY
  actions.forEach((action, index) => {
    const visibleAction = normalizeActionForVisibility(state, actor, action, context)
    const next = applyAction(evaluationState, visibleAction)
    const ownAfter = progressForPlayer(next.players[actor])
    const enemyAfter = progressForPlayer(next.players[enemy])
    const knownEnemyThreatAfter = context.visibility.canInspectOpponentHand
      ? immediateWinningCardCount(next, enemy)
      : 0

    const ownProgressDelta = ownAfter.score - ownBefore.score
    const enemyProgressReduction = enemyBefore.score - enemyAfter.score
    const knownThreatReduction = knownEnemyThreatBefore - knownEnemyThreatAfter
    const disruptionHint = disruptionHintForAction(state, actor, visibleAction)

    let score = 0
    if (next.winner === actor) {
      score += 10000
    } else if (next.winner !== null && next.winner !== 'draw') {
      score -= 10000
    }
    score += ownProgressDelta * 40
    score += ownAfter.score * 2
    score += enemyProgressReduction * (enemyNearWin ? 140 : 35)
    score += knownThreatReduction * (enemyNearWin ? 200 : 80)
    score += disruptionHint * (enemyNearWin ? 30 : 10)

    if (visibleAction.type === 'end_turn') {
      score -= 12
    } else if (visibleAction.type === 'pass_response') {
      score -= 5
    }

    if (score > bestScore || (score === bestScore && index < bestIndex)) {
      bestAction = action
      bestScore = score
      bestIndex = index
    }
  })

  return bestAction
}
