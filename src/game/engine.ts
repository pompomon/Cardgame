import { createStarterDeck } from './cards'
import type { BattlefieldCard, Card, GameAction, GameState, LogEvent, PlayerState, Winner } from './types'

/** Opening hand size of each player when `createInitialGame` gets no hand sizes. */
export const DEFAULT_OPENING_HAND_SIZE = 5

/** Optional game setup. An omitted field keeps the default. */
export interface InitialGameOptions {
  /**
   * Opening hand sizes of players 0 and 1. Each is an integer from 0 to that
   * player's deck size. Defaults to `[5, 5]`.
   */
  readonly openingHandSizes?: readonly [number, number]
}

function cloneState(state: GameState): GameState {
  return structuredClone(state)
}

function clonePlayerForSearch(player: PlayerState): PlayerState {
  return {
    ...player,
    deck: player.deck.slice(),
    hand: player.hand.slice(),
    battlefield: player.battlefield.slice(),
    graveyard: player.graveyard.slice(),
  }
}

// Copies everything the engine mutates: the state and player objects, the
// zone arrays and the pending slots. Card and battlefield entries are shared,
// because the engine never writes to them. The log and event lists start
// empty, so a search state holds only the latest action's entries.
function cloneStateForSearch(state: GameState): GameState {
  return {
    ...state,
    players: [clonePlayerForSearch(state.players[0]), clonePlayerForSearch(state.players[1])],
    pendingLandPlay: state.pendingLandPlay ? { ...state.pendingLandPlay } : null,
    pendingPlainsReuse: state.pendingPlainsReuse ? { ...state.pendingPlainsReuse } : null,
    pendingSwampDiscard: state.pendingSwampDiscard ? { ...state.pendingSwampDiscard } : null,
    log: [],
    events: [],
  }
}

function pushLog(state: GameState, message: string, event: LogEvent): void {
  state.log.push(message)
  state.events.push(event)
}

function createPlayer(id: number, seed: number, deckOverride?: Card[]): PlayerState {
  return {
    id,
    deck: deckOverride ? deckOverride.map((card) => ({ ...card })) : createStarterDeck(id, seed),
    hand: [],
    battlefield: [],
    graveyard: [],
    landsPlayedThisTurn: 0,
  }
}

function drawCard(state: GameState, playerId: number): void {
  const player = state.players[playerId]
  const next = player.deck.shift()
  if (!next) {
    state.winner = playerId === 0 ? 1 : 0
    state.phase = 'gameOver'
    state.pendingLandPlay = null
    state.pendingPlainsReuse = null
    state.pendingSwampDiscard = null
    pushLog(state, `Player ${playerId + 1} loses by drawing from empty deck.`, { kind: 'deck_empty_loss', actor: playerId })
    return
  }
  player.hand.push(next)
  pushLog(state, `Player ${playerId + 1} draws ${next.name}.`, { kind: 'draw', actor: playerId, cardName: next.name })
}

function beginTurn(state: GameState): void {
  const active = state.players[state.currentPlayer]
  active.landsPlayedThisTurn = 0
  drawCard(state, state.currentPlayer)
  if (state.phase !== 'gameOver') {
    state.phase = 'main'
    pushLog(state, `Turn ${state.turn}: Player ${state.currentPlayer + 1} main phase.`, { kind: 'turn_start', turn: state.turn, actor: state.currentPlayer })
  }
}

function removeFromHand(player: PlayerState, cardId: string): Card | null {
  const index = player.hand.findIndex((card) => card.id === cardId)
  if (index < 0) {
    return null
  }
  const [card] = player.hand.splice(index, 1)
  return card
}

function addToBattlefield(state: GameState, player: PlayerState, card: Card): BattlefieldCard {
  const instance: BattlefieldCard = {
    instanceId: `p${player.id}-${state.nextInstanceId}`,
    card,
  }
  state.nextInstanceId += 1
  player.battlefield.push(instance)
  return instance
}

function moveBattlefieldCardToGraveyard(player: PlayerState, instanceId: string): Card | null {
  const index = player.battlefield.findIndex((entry) => entry.instanceId === instanceId)
  if (index < 0) {
    return null
  }
  const [entry] = player.battlefield.splice(index, 1)
  player.graveyard.push(entry.card)
  return entry.card
}

function playerHasWinningBoard(player: PlayerState): boolean {
  const names = player.battlefield.map((entry) => entry.card.name)
  const unique = new Set(names)
  if (unique.size === 5) {
    return true
  }

  const counts = new Map<string, number>()
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.values()].some((count) => count >= 5)
}

function checkWinner(state: GameState): Winner {
  const p1Win = playerHasWinningBoard(state.players[0])
  const p2Win = playerHasWinningBoard(state.players[1])
  if (p1Win && p2Win) {
    return 'draw'
  }
  if (p1Win) {
    return 0
  }
  if (p2Win) {
    return 1
  }
  return null
}

function finalizeWinnerIfAny(state: GameState): void {
  const winner = checkWinner(state)
  if (winner === null) {
    return
  }
  state.winner = winner
  state.phase = 'gameOver'
  state.pendingLandPlay = null
  state.pendingPlainsReuse = null
  state.pendingSwampDiscard = null
  pushLog(
    state,
    winner === 'draw' ? 'Game ends in a draw.' : `Player ${winner + 1} wins.`,
    { kind: 'game_end', winner },
  )
}

function opponentCanCounterWithIsland(player: PlayerState): boolean {
  const islandCount = player.hand.filter((card) => card.name === 'Island').length
  return islandCount >= 1 && player.hand.length >= 2
}

function discardForIslandCounter(
  player: PlayerState,
  discardCardId?: string,
): { island: Card; additional: Card } | null {
  const island = player.hand.find((card) => card.name === 'Island')
  if (!island) {
    return null
  }
  const other = discardCardId
    ? player.hand.find((card) => card.id === discardCardId && card.id !== island.id)
    : player.hand.find((card) => card.id !== island.id)
  if (!other) {
    return null
  }
  removeFromHand(player, island.id)
  removeFromHand(player, other.id)
  player.graveyard.push(island, other)
  return { island, additional: other }
}

function enumerateEffectTargetIds(state: GameState, actor: number, cardName: Card['name']): string[] {
  const me = state.players[actor]
  const enemy = state.players[actor === 0 ? 1 : 0]

  if (cardName === 'Forest') {
    return me.graveyard.map((card) => card.id)
  }

  if (cardName === 'Mountain') {
    return enemy.battlefield.map((entry) => entry.instanceId)
  }

  if (cardName === 'Swamp') {
    return enemy.hand.map((card) => card.id)
  }

  return []
}

function applyLandEffect(
  state: GameState,
  actor: number,
  playedCard: Card,
  effectTargetId?: string,
  sourceInstanceId?: string,
): void {
  const me = state.players[actor]
  const enemy = state.players[actor === 0 ? 1 : 0]

  if (playedCard.name === 'Forest') {
    const targetIndex = effectTargetId
      ? me.graveyard.findIndex((card) => card.id === effectTargetId)
      : me.graveyard.length - 1
    const target = targetIndex >= 0 ? me.graveyard.splice(targetIndex, 1)[0] : undefined
    if (target) {
      me.hand.push(target)
      pushLog(state, `Forest returns ${target.name} from graveyard to hand.`, {
        kind: 'ability_forest_return',
        actor,
        cardName: target.name,
        sourceInstanceId,
        targetCardId: target.id,
      })
    }
    return
  }

  if (playedCard.name === 'Swamp') {
    const target = effectTargetId ? enemy.hand.find((card) => card.id === effectTargetId) : undefined
    if (target) {
      removeFromHand(enemy, target.id)
      enemy.graveyard.push(target)
      pushLog(state, `Swamp makes Player ${enemy.id + 1} discard ${target.name}.`, {
        kind: 'ability_swamp_discard',
        actor,
        target: enemy.id,
        cardName: target.name,
        sourceInstanceId,
        targetCardId: target.id,
      })
    }
    return
  }

  if (playedCard.name === 'Mountain') {
    const target = effectTargetId
      ? enemy.battlefield.find((entry) => entry.instanceId === effectTargetId)
      : enemy.battlefield[0]
    if (target) {
      moveBattlefieldCardToGraveyard(enemy, target.instanceId)
      pushLog(state, `Mountain destroys Player ${enemy.id + 1}'s ${target.card.name}.`, {
        kind: 'ability_mountain_destroy',
        actor,
        target: enemy.id,
        cardName: target.card.name,
        sourceInstanceId,
        targetInstanceId: target.instanceId,
      })
    }
    return
  }

  if (playedCard.name === 'Island') {
    drawCard(state, actor)
    return
  }

  const target = effectTargetId
    ? me.battlefield.find((entry) => entry.instanceId === effectTargetId && entry.card.name !== 'Plains')
    : me.battlefield.find((entry) => entry.card.name !== 'Plains')
  if (!target) {
    return
  }

  const nestedTargets = enumerateEffectTargetIds(state, actor, target.card.name)
  if (target.card.name === 'Island' || nestedTargets.length === 0) {
    pushLog(state, `Plains reuses ${target.card.name}.`, {
      kind: 'ability_plains_reuse',
      actor,
      reusedName: target.card.name,
      sourceInstanceId: target.instanceId,
    })
    applyLandEffect(state, actor, target.card, undefined, target.instanceId)
    return
  }

  state.pendingPlainsReuse = {
    actor,
    reusedInstanceId: target.instanceId,
    reusedCardName: target.card.name,
  }
  state.phase = 'plains_target'
}

function resolvePendingLandPlay(state: GameState): void {
  const pending = state.pendingLandPlay
  if (!pending) {
    return
  }
  const me = state.players[pending.actor]
  const enemy = state.players[pending.actor === 0 ? 1 : 0]
  const playedInstance = addToBattlefield(state, me, pending.card)
  pushLog(state, `Player ${pending.actor + 1} plays ${pending.card.name}.`, {
    kind: 'play_land',
    actor: pending.actor,
    cardName: pending.card.name,
    sourceInstanceId: playedInstance.instanceId,
  })
  state.pendingLandPlay = null
  if (pending.card.name === 'Swamp' && pending.effectTargetId === undefined && enemy.hand.length > 0) {
    state.pendingSwampDiscard = { actor: pending.actor }
    state.phase = 'swamp_target'
    return
  }
  applyLandEffect(state, pending.actor, pending.card, pending.effectTargetId, playedInstance.instanceId)
  if (state.phase === 'main') {
    finalizeWinnerIfAny(state)
  }
}

function resolvePendingSwampDiscard(state: GameState, actor: number, effectTargetId?: string): void {
  const pending = state.pendingSwampDiscard
  if (!pending || pending.actor !== actor) {
    return
  }
  const enemy = state.players[actor === 0 ? 1 : 0]
  const target = effectTargetId
    ? enemy.hand.find((card) => card.id === effectTargetId)
    : enemy.hand[0]
  if (target) {
    removeFromHand(enemy, target.id)
    enemy.graveyard.push(target)
    const source = state.players[actor].battlefield.findLast((entry) => entry.card.name === 'Swamp')
    pushLog(state, `Swamp makes Player ${enemy.id + 1} discard ${target.name}.`, {
      kind: 'ability_swamp_discard',
      actor,
      target: enemy.id,
      cardName: target.name,
      sourceInstanceId: source?.instanceId,
      targetCardId: target.id,
    })
  }
  state.pendingSwampDiscard = null
  state.phase = 'main'
  finalizeWinnerIfAny(state)
}

function responseActorFor(state: GameState): number | null {
  if (state.phase !== 'respond' || !state.pendingLandPlay) {
    return null
  }
  return state.pendingLandPlay.actor === 0 ? 1 : 0
}

function openingHandSizes(state: GameState, options: InitialGameOptions | undefined): [number, number] {
  const sizes: unknown = options?.openingHandSizes
  if (sizes === undefined) {
    return [DEFAULT_OPENING_HAND_SIZE, DEFAULT_OPENING_HAND_SIZE]
  }
  if (!Array.isArray(sizes) || sizes.length !== 2) {
    throw new RangeError('Opening hand sizes must give one count for each of the two players.')
  }
  const checked: [number, number] = [0, 0]
  for (const playerId of [0, 1]) {
    const size: unknown = sizes[playerId]
    const deckSize = state.players[playerId].deck.length
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > deckSize) {
      throw new RangeError(`Player ${playerId + 1}'s opening hand size must be an integer from 0 to their deck size, ${deckSize}.`)
    }
    checked[playerId] = size
  }
  return checked
}

/**
 * Creates a game. Decks default to seeded starter decks. Players 0 and 1
 * draw their opening hands alternately; when one hand is larger, its extra
 * cards are drawn after the alternating draws. Player 0 then starts without
 * a draw. Hand sizes outside 0 to the deck size throw a `RangeError`.
 * Without `openingHandSizes`, both players draw five cards exactly as before
 * the option existed, even when a deck runs out during the opening draws.
 */
export function createInitialGame(
  seed = Date.now(),
  decks?: [Card[] | undefined, Card[] | undefined],
  options?: InitialGameOptions,
): GameState {
  const [player0Deck, player1Deck] = decks ?? [undefined, undefined]
  const state: GameState = {
    players: [createPlayer(0, seed, player0Deck), createPlayer(1, seed + 1, player1Deck)],
    turn: 1,
    currentPlayer: 0,
    nextInstanceId: 1,
    phase: 'main',
    pendingLandPlay: null,
    pendingPlainsReuse: null,
    pendingSwampDiscard: null,
    winner: null,
    log: ['Game started.'],
    events: [{ kind: 'game_started' }],
  }

  const [player0HandSize, player1HandSize] = openingHandSizes(state, options)
  for (let index = 0; index < Math.max(player0HandSize, player1HandSize); index += 1) {
    if (index < player0HandSize) {
      drawCard(state, 0)
    }
    if (index < player1HandSize) {
      drawCard(state, 1)
    }
  }

  pushLog(state, 'Player 1 starts and skips first draw step.', { kind: 'game_start_skip_draw', actor: 0 })
  return state
}

/**
 * The most `turn` and `nextInstanceId` can still grow before the game ends.
 * Only End Turn raises `turn`, and it draws a card or ends the game. A land
 * enters play only from the pending play, and each turn allows one play.
 * Each bound therefore falls at least as fast as its counter grows. When a
 * state's counters plus these bounds stay within `Number.MAX_SAFE_INTEGER`,
 * that also holds for every state legal actions reach from it.
 */
export function remainingCounterGrowth(state: GameState): { turn: number; nextInstanceId: number } {
  if (state.phase === 'gameOver') {
    return { turn: 0, nextInstanceId: 0 }
  }
  const cardsLeftToDraw = state.players[0].deck.length + state.players[1].deck.length
  const landsStillToEnter = (state.pendingLandPlay ? 1 : 0)
    + (state.players[state.currentPlayer].landsPlayedThisTurn < 1 ? 1 : 0)
  return {
    turn: cardsLeftToDraw + 1,
    nextInstanceId: cardsLeftToDraw + landsStillToEnter,
  }
}

/** The seat whose decision the game is waiting for. */
export function activeActor(state: GameState): number {
  if (state.phase === 'respond' && state.pendingLandPlay) {
    return state.pendingLandPlay.actor === 0 ? 1 : 0
  }
  if (state.phase === 'plains_target' && state.pendingPlainsReuse) {
    return state.pendingPlainsReuse.actor
  }
  if (state.phase === 'swamp_target' && state.pendingSwampDiscard) {
    return state.pendingSwampDiscard.actor
  }
  return state.currentPlayer
}

export function canAct(state: GameState, actor: number): boolean {
  if (actor !== 0 && actor !== 1) {
    return false
  }
  if (state.phase === 'gameOver') {
    return false
  }
  if (state.phase === 'main') {
    return actor === state.currentPlayer
  }
  if (state.phase === 'plains_target') {
    return actor === state.pendingPlainsReuse?.actor
  }
  if (state.phase === 'swamp_target') {
    return actor === state.pendingSwampDiscard?.actor
  }
  return actor === responseActorFor(state)
}

export function getLegalActions(state: GameState, actor: number): GameAction[] {
  if (!canAct(state, actor)) {
    return []
  }

  const actions: GameAction[] = []
  const me = state.players[actor]

  if (state.phase === 'plains_target') {
    const pendingReuse = state.pendingPlainsReuse
    if (!pendingReuse) {
      return actions
    }
    const targets = enumerateEffectTargetIds(state, actor, pendingReuse.reusedCardName)
    if (pendingReuse.reusedCardName === 'Island' || targets.length === 0) {
      actions.push({ type: 'resolve_plains_reuse', actor })
      return actions
    }
    for (const targetId of targets) {
      actions.push({ type: 'resolve_plains_reuse', actor, effectTargetId: targetId })
    }
    return actions
  }

  if (state.phase === 'swamp_target') {
    const pending = state.pendingSwampDiscard
    if (!pending || pending.actor !== actor) {
      return actions
    }
    const enemy = state.players[actor === 0 ? 1 : 0]
    if (enemy.hand.length === 0) {
      actions.push({ type: 'resolve_swamp_discard', actor })
      return actions
    }
    for (const card of enemy.hand) {
      actions.push({ type: 'resolve_swamp_discard', actor, effectTargetId: card.id })
    }
    return actions
  }

  if (state.phase === 'main') {
    if (me.landsPlayedThisTurn < 1) {
      for (const card of me.hand) {
        if (card.name === 'Swamp') {
          actions.push({ type: 'play_land', actor, cardId: card.id })
          continue
        }
        if (card.name === 'Forest' || card.name === 'Mountain') {
          const targets = enumerateEffectTargetIds(state, actor, card.name)
          if (targets.length > 0) {
            for (const targetId of targets) {
              actions.push({ type: 'play_land', actor, cardId: card.id, effectTargetId: targetId })
            }
            continue
          }
        }

        if (card.name === 'Plains') {
          const targets = me.battlefield.filter((entry) => entry.card.name !== 'Plains')
          if (targets.length > 0) {
            for (const target of targets) {
              actions.push({ type: 'play_land', actor, cardId: card.id, effectTargetId: target.instanceId })
            }
            continue
          }
        }

        actions.push({ type: 'play_land', actor, cardId: card.id })
      }
    }
    actions.push({ type: 'end_turn', actor })
    return actions
  }

  if (state.phase === 'respond') {
    if (opponentCanCounterWithIsland(me)) {
      const island = me.hand.find((card) => card.name === 'Island')
      if (island) {
        for (const card of me.hand) {
          if (card.id !== island.id) {
            actions.push({ type: 'counter_land', actor, discardCardId: card.id })
          }
        }
      }
    }
    actions.push({ type: 'pass_response', actor })
  }

  return actions
}

export function applyAction(inputState: GameState, action: GameAction): GameState {
  return applyActionToCopy(cloneState(inputState), action)
}

/**
 * Applies an action the same way as `applyAction`, for AI search. Instead of
 * a deep copy it copies only what the engine mutates and shares card and
 * battlefield entries with the input, so it is much cheaper. The returned
 * `log` and `events` hold only this action's entries. Treat both the input
 * and the result as read-only: advance a search state only through this
 * function.
 */
export function applyActionForSearch(inputState: GameState, action: GameAction): GameState {
  return applyActionToCopy(cloneStateForSearch(inputState), action)
}

function applyActionToCopy(state: GameState, action: GameAction): GameState {
  if (!canAct(state, action.actor)) {
    return state
  }

  if (action.type === 'play_land' && state.phase === 'main') {
    const me = state.players[action.actor]
    if (me.landsPlayedThisTurn >= 1) {
      return state
    }

    const card = removeFromHand(me, action.cardId)
    if (!card) {
      return state
    }

    me.landsPlayedThisTurn += 1
    state.pendingLandPlay = { actor: action.actor, card, effectTargetId: action.effectTargetId }

    const responder = state.players[action.actor === 0 ? 1 : 0]
    if (opponentCanCounterWithIsland(responder)) {
      state.phase = 'respond'
      pushLog(state, `Player ${responder.id + 1} may counter ${card.name} with Island.`, { kind: 'counter_offered', responder: responder.id, cardName: card.name })
      return state
    }

    resolvePendingLandPlay(state)
    return state
  }

  if (action.type === 'resolve_swamp_discard' && state.phase === 'swamp_target') {
    resolvePendingSwampDiscard(state, action.actor, action.effectTargetId)
    return state
  }

  if (action.type === 'resolve_plains_reuse' && state.phase === 'plains_target' && state.pendingPlainsReuse) {
    const pendingReuse = state.pendingPlainsReuse
    if (pendingReuse.actor !== action.actor) {
      return state
    }
    pushLog(state, `Plains reuses ${pendingReuse.reusedCardName}.`, {
      kind: 'ability_plains_reuse',
      actor: action.actor,
      reusedName: pendingReuse.reusedCardName,
      sourceInstanceId: pendingReuse.reusedInstanceId,
    })
    const reusedCard: Card = {
      id: `reused-${pendingReuse.reusedInstanceId}`,
      name: pendingReuse.reusedCardName,
      type: 'land',
    }
    state.pendingPlainsReuse = null
    state.phase = 'main'
    applyLandEffect(state, action.actor, reusedCard, action.effectTargetId, pendingReuse.reusedInstanceId)
    if (state.phase === 'main') {
      finalizeWinnerIfAny(state)
    }
    return state
  }

  if (action.type === 'counter_land' && state.phase === 'respond' && state.pendingLandPlay) {
    const responder = state.players[action.actor]
    const counterCost = discardForIslandCounter(responder, action.discardCardId)
    if (!counterCost) {
      return state
    }

    const pending = state.pendingLandPlay
    const caster = state.players[pending.actor]
    caster.graveyard.push(pending.card)
    pushLog(state, `Player ${action.actor + 1} counters ${pending.card.name}.`, {
      kind: 'counter_resolved',
      actor: action.actor,
      cardName: pending.card.name,
      discardCardName: counterCost.additional.name,
    })
    state.pendingLandPlay = null
    state.pendingPlainsReuse = null
    state.pendingSwampDiscard = null
    state.phase = 'main'
    return state
  }

  if (action.type === 'pass_response' && state.phase === 'respond') {
    state.phase = 'main'
    resolvePendingLandPlay(state)
    return state
  }

  if (action.type === 'end_turn' && state.phase === 'main') {
    state.currentPlayer = state.currentPlayer === 0 ? 1 : 0
    state.turn += 1
    beginTurn(state)
    return state
  }

  return state
}
