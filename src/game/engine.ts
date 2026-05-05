import { createStarterDeck } from './cards'
import type { BattlefieldCard, Card, GameAction, GameState, PlayerState, Winner } from './types'

const STARTING_HAND = 5
const PLAINS_TARGET_SEPARATOR = '::'

function encodePlainsEffectTargetId(reuseTargetId: string, reusedEffectTargetId?: string): string {
  if (!reusedEffectTargetId) {
    return reuseTargetId
  }
  return `${reuseTargetId}${PLAINS_TARGET_SEPARATOR}${reusedEffectTargetId}`
}

function decodePlainsEffectTargetId(effectTargetId?: string): { reuseTargetId?: string; reusedEffectTargetId?: string } {
  if (!effectTargetId) {
    return {}
  }
  const separatorIndex = effectTargetId.indexOf(PLAINS_TARGET_SEPARATOR)
  if (separatorIndex < 0) {
    return { reuseTargetId: effectTargetId }
  }
  return {
    reuseTargetId: effectTargetId.slice(0, separatorIndex),
    reusedEffectTargetId: effectTargetId.slice(separatorIndex + PLAINS_TARGET_SEPARATOR.length),
  }
}

function cloneState(state: GameState): GameState {
  return structuredClone(state)
}

function createPlayer(id: number, seed: number): PlayerState {
  return {
    id,
    deck: createStarterDeck(id, seed),
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
    state.log.push(`Player ${playerId + 1} loses by drawing from empty deck.`)
    return
  }
  player.hand.push(next)
  state.log.push(`Player ${playerId + 1} draws ${next.name}.`)
}

function beginTurn(state: GameState): void {
  const active = state.players[state.currentPlayer]
  active.landsPlayedThisTurn = 0
  drawCard(state, state.currentPlayer)
  if (state.phase !== 'gameOver') {
    state.phase = 'main'
    state.log.push(`Turn ${state.turn}: Player ${state.currentPlayer + 1} main phase.`)
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
  state.log.push(winner === 'draw' ? 'Game ends in a draw.' : `Player ${winner + 1} wins.`)
}

function opponentCanCounterWithIsland(player: PlayerState): boolean {
  const islandCount = player.hand.filter((card) => card.name === 'Island').length
  return islandCount >= 1 && player.hand.length >= 2
}

function discardForIslandCounter(player: PlayerState, discardCardId?: string): boolean {
  const island = player.hand.find((card) => card.name === 'Island')
  if (!island) {
    return false
  }
  const other = discardCardId
    ? player.hand.find((card) => card.id === discardCardId && card.id !== island.id)
    : player.hand.find((card) => card.id !== island.id)
  if (!other) {
    return false
  }
  removeFromHand(player, island.id)
  removeFromHand(player, other.id)
  player.graveyard.push(island, other)
  return true
}

function applyLandEffect(state: GameState, actor: number, playedCard: Card, effectTargetId?: string): void {
  const me = state.players[actor]
  const enemy = state.players[actor === 0 ? 1 : 0]

  if (playedCard.name === 'Forest') {
    const targetIndex = effectTargetId
      ? me.graveyard.findIndex((card) => card.id === effectTargetId)
      : me.graveyard.length - 1
    const target = targetIndex >= 0 ? me.graveyard.splice(targetIndex, 1)[0] : undefined
    if (target) {
      me.hand.push(target)
      state.log.push(`Forest returns ${target.name} from graveyard to hand.`)
    }
    return
  }

  if (playedCard.name === 'Swamp') {
    const target = effectTargetId ? enemy.hand.find((card) => card.id === effectTargetId) : enemy.hand[0]
    if (target) {
      removeFromHand(enemy, target.id)
      enemy.graveyard.push(target)
      state.log.push(`Swamp makes Player ${enemy.id + 1} discard ${target.name}.`)
    }
    return
  }

  if (playedCard.name === 'Mountain') {
    const target = effectTargetId
      ? enemy.battlefield.find((entry) => entry.instanceId === effectTargetId)
      : enemy.battlefield[0]
    if (target) {
      moveBattlefieldCardToGraveyard(enemy, target.instanceId)
      state.log.push(`Mountain destroys Player ${enemy.id + 1}'s ${target.card.name}.`)
    }
    return
  }

  if (playedCard.name === 'Island') {
    drawCard(state, actor)
    return
  }

  const plainsTargets = decodePlainsEffectTargetId(effectTargetId)
  const target = plainsTargets.reuseTargetId
    ? me.battlefield.find((entry) => entry.instanceId === plainsTargets.reuseTargetId && entry.card.name !== 'Plains')
    : me.battlefield.find((entry) => entry.card.name !== 'Plains')
  if (!target) {
    return
  }
  state.log.push(`Plains reuses ${target.card.name}.`)
  applyLandEffect(state, actor, target.card, plainsTargets.reusedEffectTargetId)
}

function resolvePendingLandPlay(state: GameState): void {
  const pending = state.pendingLandPlay
  if (!pending) {
    return
  }
  const me = state.players[pending.actor]
  addToBattlefield(state, me, pending.card)
  state.log.push(`Player ${pending.actor + 1} plays ${pending.card.name}.`)
  applyLandEffect(state, pending.actor, pending.card, pending.effectTargetId)
  state.pendingLandPlay = null
  if (state.phase !== 'gameOver') {
    finalizeWinnerIfAny(state)
  }
}

function responseActorFor(state: GameState): number | null {
  if (state.phase !== 'respond' || !state.pendingLandPlay) {
    return null
  }
  return state.pendingLandPlay.actor === 0 ? 1 : 0
}

export function createInitialGame(seed = Date.now()): GameState {
  const state: GameState = {
    players: [createPlayer(0, seed), createPlayer(1, seed + 1)],
    turn: 1,
    currentPlayer: 0,
    nextInstanceId: 1,
    phase: 'main',
    pendingLandPlay: null,
    winner: null,
    log: ['Game started.'],
  }

  for (let index = 0; index < STARTING_HAND; index += 1) {
    drawCard(state, 0)
    drawCard(state, 1)
  }

  state.log.push('Player 1 starts and skips first draw step.')
  return state
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
  return actor === responseActorFor(state)
}

export function getLegalActions(state: GameState, actor: number): GameAction[] {
  if (!canAct(state, actor)) {
    return []
  }

  const actions: GameAction[] = []
  const me = state.players[actor]

  if (state.phase === 'main') {
    if (me.landsPlayedThisTurn < 1) {
      const enemy = state.players[actor === 0 ? 1 : 0]
      for (const card of me.hand) {
        if (card.name === 'Forest' && me.graveyard.length > 0) {
          for (const target of me.graveyard) {
            actions.push({ type: 'play_land', actor, cardId: card.id, effectTargetId: target.id })
          }
          continue
        }

        if (card.name === 'Mountain' && enemy.battlefield.length > 0) {
          for (const target of enemy.battlefield) {
            actions.push({ type: 'play_land', actor, cardId: card.id, effectTargetId: target.instanceId })
          }
          continue
        }

        if (card.name === 'Swamp' && enemy.hand.length > 0) {
          for (const target of enemy.hand) {
            actions.push({ type: 'play_land', actor, cardId: card.id, effectTargetId: target.id })
          }
          continue
        }

        if (card.name === 'Plains') {
          const targets = me.battlefield.filter((entry) => entry.card.name !== 'Plains')
          if (targets.length > 0) {
            for (const target of targets) {
              if (target.card.name === 'Forest' && me.graveyard.length > 0) {
                for (const nestedTarget of me.graveyard) {
                  actions.push({
                    type: 'play_land',
                    actor,
                    cardId: card.id,
                    effectTargetId: encodePlainsEffectTargetId(target.instanceId, nestedTarget.id),
                  })
                }
                continue
              }

              if (target.card.name === 'Mountain' && enemy.battlefield.length > 0) {
                for (const nestedTarget of enemy.battlefield) {
                  actions.push({
                    type: 'play_land',
                    actor,
                    cardId: card.id,
                    effectTargetId: encodePlainsEffectTargetId(target.instanceId, nestedTarget.instanceId),
                  })
                }
                continue
              }

              if (target.card.name === 'Swamp' && enemy.hand.length > 0) {
                for (const nestedTarget of enemy.hand) {
                  actions.push({
                    type: 'play_land',
                    actor,
                    cardId: card.id,
                    effectTargetId: encodePlainsEffectTargetId(target.instanceId, nestedTarget.id),
                  })
                }
                continue
              }

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
  const state = cloneState(inputState)

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
      state.log.push(`Player ${responder.id + 1} may counter ${card.name} with Island.`)
      return state
    }

    resolvePendingLandPlay(state)
    return state
  }

  if (action.type === 'counter_land' && state.phase === 'respond' && state.pendingLandPlay) {
    const responder = state.players[action.actor]
    if (!discardForIslandCounter(responder, action.discardCardId)) {
      return state
    }

    const pending = state.pendingLandPlay
    const caster = state.players[pending.actor]
    caster.graveyard.push(pending.card)
    state.log.push(`Player ${action.actor + 1} counters ${pending.card.name}.`)
    state.pendingLandPlay = null
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
