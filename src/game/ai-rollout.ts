import { canonicalActionClasses } from './ai-action-classes'
import { FULL_VIEW, evaluatePosition, type AiFeatureView } from './ai-features'
import type { AiRng } from './ai-random'
import { activeActor, applyActionForSearch, getLegalActions } from './engine'
import { BASIC_LANDS, type BasicLand, type GameAction, type GameState, type PlayerState } from './types'

// One-step action values and the rollout policy of the Hard search. Both
// players choose by the evaluator one action ahead. They resolve a played
// land as if it were not countered, and any target choice that follows as its
// chooser prefers. Values never look at the order of a sampled deck: a card
// an Island draws counts only toward hand size, and End Turn is scored before
// its draw. A blind opponent sees the root player's hand only while choosing
// a Swamp discard, direct or reused by Plains, where the game reveals it.
// Before the reveal, it values a Swamp by the best discard it can expect.

/** Counts engine steps against the search budget. */
export interface StepMeter {
  steps: number
}

export interface RolloutSettings {
  /** The searching player. */
  readonly root: number
  readonly rootWeights: Float64Array
  readonly opponentWeights: Float64Array
  /**
   * When false, the opponent sees only the size of the root player's hand,
   * except while choosing a Swamp discard.
   */
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
    const targets = getLegalActions(next, targetChooser)
    const discard = targets[0]
    const discardedId = discard && 'effectTargetId' in discard ? discard.effectTargetId : undefined
    if (
      targetChooser === chooser
      && view.hiddenHandSeat === otherPlayer(chooser)
      && isSwampDiscardChoice(next)
      && discardedId !== undefined
    ) {
      return blindDiscardValue(meter, next, discard, discardedId, chooser, weights, scoredView)
    }
    const maximize = targetChooser === chooser
    let best = maximize ? -1 : 2
    for (const target of targets) {
      const value = evaluatePosition(searchStep(meter, next, target), chooser, nextMover(next), weights, scoredView)
      best = maximize ? Math.max(best, value) : Math.min(best, value)
    }
    return best
  }
  return evaluatePosition(next, chooser, nextMover(next), weights, scoredView)
}

/**
 * The chance that a hand of `hand` cards dealt from `pool` cards holds none
 * of `excluded` particular cards.
 */
function chanceOfNone(pool: number, excluded: number, hand: number): number {
  let chance = 1
  for (let dealt = 0; dealt < hand; dealt += 1) {
    const allowed = pool - dealt - excluded
    if (allowed <= 0) {
      return 0
    }
    chance *= allowed / (pool - dealt)
  }
  return chance
}

/** `state` with a card of `name` from the victim's deck or hand swapped for the discarded card. */
function withDiscardedName(state: GameState, victim: number, discardedIndex: number, name: BasicLand): GameState {
  const player = state.players[victim]
  const discarded = player.graveyard[discardedIndex]
  const graveyard = player.graveyard.slice()
  let { deck, hand } = player
  const deckIndex = deck.findIndex((card) => card.name === name)
  if (deckIndex >= 0) {
    graveyard[discardedIndex] = deck[deckIndex]
    deck = deck.slice()
    deck[deckIndex] = discarded
  } else {
    const handIndex = hand.findIndex((card) => card.name === name)
    graveyard[discardedIndex] = hand[handIndex]
    hand = hand.slice()
    hand[handIndex] = discarded
  }
  const renamed: PlayerState = { ...player, deck, hand, graveyard }
  const players: [PlayerState, PlayerState] = victim === 0 ? [renamed, state.players[1]] : [state.players[0], renamed]
  return { ...state, players }
}

/**
 * The value of a Swamp discard to a chooser who has not seen the victim's
 * hand yet. The game will reveal the hand and the chooser will take its best
 * card, so this is the best discard expected over the hands that the
 * victim's hand and deck could deal. Seen blind, the position after a discard
 * depends only on the discarded card's name, because the evaluator pools a
 * hidden hand with its deck, so each name is scored once.
 */
function blindDiscardValue(
  meter: StepMeter,
  state: GameState,
  discard: GameAction,
  discardedId: string,
  chooser: number,
  weights: Float64Array,
  view: AiFeatureView,
): number {
  const victim = otherPlayer(chooser)
  const { hand, deck } = state.players[victim]
  const toMove = nextMover(state)
  const after = searchStep(meter, state, discard)
  const discardedIndex = after.players[victim].graveyard.findIndex((card) => card.id === discardedId)
  if (discardedIndex < 0) {
    return evaluatePosition(after, chooser, toMove, weights, view)
  }
  const discardedName = after.players[victim].graveyard[discardedIndex].name
  const options: Array<{ count: number; value: number }> = []
  for (const name of BASIC_LANDS) {
    let count = 0
    for (const card of hand) if (card.name === name) count += 1
    for (const card of deck) if (card.name === name) count += 1
    if (count === 0) continue
    const position = name === discardedName ? after : withDiscardedName(after, victim, discardedIndex, name)
    options.push({ count, value: evaluatePosition(position, chooser, toMove, weights, view) })
  }
  options.sort((left, right) => right.value - left.value)
  const pool = hand.length + deck.length
  let value = 0
  let noneSoFar = 1
  let excluded = 0
  for (const option of options) {
    excluded += option.count
    const none = chanceOfNone(pool, excluded, hand.length)
    value += (noneSoFar - none) * option.value
    noneSoFar = none
  }
  return value
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

/**
 * Whether the decision is a Swamp discard, direct or reused by Plains. The
 * game reveals the enemy hand to a human for both, so the chooser sees it.
 */
export function isSwampDiscardChoice(state: GameState): boolean {
  return state.phase === 'swamp_target'
    || (state.phase === 'plains_target' && state.pendingPlainsReuse?.reusedCardName === 'Swamp')
}

/** The evaluator view of a player at a rollout decision. */
function chooserView(settings: RolloutSettings, player: number, state: GameState): AiFeatureView {
  if (player === settings.root || settings.opponentSeesHand || isSwampDiscardChoice(state)) {
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
  const weights = actor === settings.root ? settings.rootWeights : settings.opponentWeights
  return chooseByValue(meter, state, actor, weights, chooserView(settings, actor, state), settings.epsilon, rng)
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
