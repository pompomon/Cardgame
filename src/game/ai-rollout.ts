import { canonicalActionClasses } from './ai-action-classes'
import { FULL_VIEW, evaluatePosition, type AiFeatureView } from './ai-features'
import type { AiRng } from './ai-random'
import { activeActor, applyActionForSearch, getLegalActions } from './engine'
import type { GameAction, GameState } from './types'

// One-step action values and the rollout policy of the Hard search. Both
// players choose by the evaluator one action ahead. They resolve a played
// land as if it were not countered, and any target choice that follows as its
// chooser prefers. Values never look at the order of a sampled deck: a card
// an Island draws counts only toward hand size, and End Turn is scored before
// its draw.

/** Counts engine steps against the search budget. */
export interface StepMeter {
  steps: number
}

export interface RolloutSettings {
  /** The searching player. */
  readonly root: number
  readonly rootWeights: Float64Array
  readonly opponentWeights: Float64Array
  /** When false, the opponent sees only the size of the root player's hand. */
  readonly opponentSeesHand: boolean
  /** Chance of a uniformly random main-phase class, unless a win is in hand. */
  readonly epsilon: number
  /** Turns to play before scoring; rollouts stop at the root player's turn. */
  readonly turns: number
  /** Steps after which a rollout is scored where it stands. */
  readonly maxRolloutSteps: number
}

export function searchStep(meter: StepMeter, state: GameState, action: GameAction): GameState {
  meter.steps += 1
  return applyActionForSearch(state, action)
}

function otherPlayer(player: number): number {
  return player === 0 ? 1 : 0
}

/** The player who starts the next turn once the current one ends. */
function nextMover(state: GameState): number {
  return otherPlayer(state.currentPlayer)
}

/** The top card a land could draw if it is an Island or reuses one. */
function possibleDrawId(state: GameState, action: GameAction): string | undefined {
  if (action.type === 'play_land') {
    return state.players[action.actor].deck[0]?.id
  }
  if (action.type === 'pass_response' && state.pendingLandPlay) {
    return state.players[state.pendingLandPlay.actor].deck[0]?.id
  }
  return undefined
}

/**
 * The value of `action` for `chooser` once the game is back in the main
 * phase, scored for the next turn's player.
 */
export function actionValue(
  meter: StepMeter,
  state: GameState,
  action: GameAction,
  chooser: number,
  weights: Float64Array,
  view: AiFeatureView,
): number {
  if (action.type === 'end_turn') {
    return evaluatePosition(state, chooser, nextMover(state), weights, view)
  }
  const drawId = possibleDrawId(state, action)
  const scoredView: AiFeatureView = drawId === undefined ? view : { hiddenHandSeat: view.hiddenHandSeat, maskedCardId: drawId }
  let next = searchStep(meter, state, action)
  if (next.phase === 'respond') {
    next = searchStep(meter, next, { type: 'pass_response', actor: activeActor(next) })
  }
  if (next.phase === 'plains_target' || next.phase === 'swamp_target') {
    const targetChooser = activeActor(next)
    const maximize = targetChooser === chooser
    let best = maximize ? -1 : 2
    for (const target of getLegalActions(next, targetChooser)) {
      const value = evaluatePosition(searchStep(meter, next, target), chooser, nextMover(next), weights, scoredView)
      best = maximize ? Math.max(best, value) : Math.min(best, value)
    }
    return best
  }
  return evaluatePosition(next, chooser, nextMover(next), weights, scoredView)
}

/** Whether a card in the player's hand completes a winning board. */
export function holdsWinningCard(state: GameState, player: number): boolean {
  const me = state.players[player]
  let unique = 0
  let forest = 0
  let island = 0
  let mountain = 0
  let plains = 0
  let swamp = 0
  for (const entry of me.battlefield) {
    switch (entry.card.name) {
      case 'Forest':
        forest += 1
        break
      case 'Island':
        island += 1
        break
      case 'Mountain':
        mountain += 1
        break
      case 'Plains':
        plains += 1
        break
      case 'Swamp':
        swamp += 1
        break
      default:
        break
    }
  }
  const board = { Forest: forest, Island: island, Mountain: mountain, Plains: plains, Swamp: swamp }
  for (const count of [forest, island, mountain, plains, swamp]) {
    if (count > 0) unique += 1
  }
  return me.hand.some((card) => {
    const onBoard = board[card.name] ?? 0
    return onBoard === 4 || (unique === 4 && onBoard === 0)
  })
}

/** The evaluator view and weights of a player in a rollout. */
function chooserView(settings: RolloutSettings, player: number): AiFeatureView {
  if (player === settings.root || settings.opponentSeesHand) {
    return FULL_VIEW
  }
  return { hiddenHandSeat: settings.root, maskedCardId: undefined }
}

/**
 * The highest-valued class representative, ties going to the first class in
 * key order. `rng` explores in the main phase; pass `null` for pure greed.
 */
export function chooseByValue(
  meter: StepMeter,
  state: GameState,
  actor: number,
  weights: Float64Array,
  view: AiFeatureView,
  epsilon: number,
  rng: AiRng | null,
): GameAction | null {
  const legal = getLegalActions(state, actor)
  if (legal.length <= 1) {
    return legal[0] ?? null
  }
  const classes = canonicalActionClasses(state, legal)
  if (classes.length === 1) {
    return classes[0].representative
  }
  if (rng && epsilon > 0 && state.phase === 'main' && rng.next() < epsilon && !holdsWinningCard(state, actor)) {
    return classes[rng.nextInt(classes.length)].representative
  }
  let bestAction = classes[0].representative
  let bestValue = -1
  for (const entry of classes) {
    const value = actionValue(meter, state, entry.representative, actor, weights, view)
    if (value > bestValue) {
      bestValue = value
      bestAction = entry.representative
    }
  }
  return bestAction
}

/** The rollout policy's action for the player to act. */
export function rolloutAction(meter: StepMeter, settings: RolloutSettings, state: GameState, rng: AiRng): GameAction | null {
  const actor = activeActor(state)
  const isRoot = actor === settings.root
  if (state.phase === 'swamp_target' && !isRoot && !settings.opponentSeesHand) {
    // A uniformly random card, drawn by class so the order of the hand does not matter.
    const legal = getLegalActions(state, actor)
    if (legal.length === 0) {
      return null
    }
    let pick = rng.nextInt(legal.length)
    const classes = canonicalActionClasses(state, legal)
    for (const entry of classes) {
      if (pick < entry.size) {
        return entry.representative
      }
      pick -= entry.size
    }
    return classes[classes.length - 1].representative
  }
  const weights = isRoot ? settings.rootWeights : settings.opponentWeights
  return chooseByValue(meter, state, actor, weights, chooserView(settings, actor), settings.epsilon, rng)
}

/**
 * Plays the rollout policy from `state` until `settings.turns` turns after
 * `startTurn` have passed and the root player is about to act, the game ends,
 * or the rollout step limit is reached. Returns the root player's value.
 */
export function playRollout(meter: StepMeter, settings: RolloutSettings, state: GameState, startTurn: number, rng: AiRng): number {
  const stepLimit = meter.steps + settings.maxRolloutSteps
  let current = state
  while (current.phase !== 'gameOver' && meter.steps < stepLimit) {
    if (
      current.turn - startTurn >= settings.turns
      && current.phase === 'main'
      && current.currentPlayer === settings.root
      && current.players[settings.root].landsPlayedThisTurn === 0
    ) {
      break
    }
    const action = rolloutAction(meter, settings, current, rng)
    if (!action) {
      break
    }
    current = searchStep(meter, current, action)
  }
  return evaluatePosition(current, settings.root, activeActor(current), settings.rootWeights, FULL_VIEW)
}
