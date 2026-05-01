import { createStarterDeck } from './cards'
import type { BattlefieldCard, Card, GameAction, GameState, PlayerState, Winner } from './types'

const STARTING_LIFE = 20
const STARTING_HAND = 5

function cloneState(state: GameState): GameState {
  return structuredClone(state)
}

function createPlayer(id: number, seed: number): PlayerState {
  return {
    id,
    life: STARTING_LIFE,
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
    state.log.push(`Player ${playerId + 1} loses by drawing from empty deck.`)
    return
  }
  player.hand.push(next)
  state.log.push(`Player ${playerId + 1} draws ${next.name}.`)
}

function beginTurn(state: GameState): void {
  const active = state.players[state.currentPlayer]
  active.landsPlayedThisTurn = 0
  active.battlefield = active.battlefield.map((card) => ({
    ...card,
    tapped: false,
    summoningSickness: false,
  }))
  drawCard(state, state.currentPlayer)
  if (state.phase !== 'gameOver') {
    state.phase = 'main'
    state.log.push(`Turn ${state.turn}: Player ${state.currentPlayer + 1} main phase.`)
  }
}

function availableMana(player: PlayerState): number {
  return player.battlefield.filter((entry) => entry.card.type === 'land' && !entry.tapped).length
}

function spendMana(player: PlayerState, amount: number): boolean {
  let remaining = amount
  for (const permanent of player.battlefield) {
    if (remaining <= 0) {
      break
    }
    if (permanent.card.type === 'land' && !permanent.tapped) {
      permanent.tapped = true
      remaining -= 1
    }
  }
  return remaining === 0
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
    tapped: false,
    summoningSickness: card.type === 'creature',
  }
  state.nextInstanceId += 1
  player.battlefield.push(instance)
  return instance
}

function checkWinner(state: GameState): Winner {
  const [p1, p2] = state.players
  if (p1.life <= 0 && p2.life <= 0) {
    return 'draw'
  }
  if (p1.life <= 0) {
    return 1
  }
  if (p2.life <= 0) {
    return 0
  }
  return null
}

export function createInitialGame(seed = Date.now()): GameState {
  const state: GameState = {
    players: [createPlayer(0, seed), createPlayer(1, seed + 1)],
    turn: 1,
    currentPlayer: 0,
    nextInstanceId: 1,
    phase: 'main',
    attackers: [],
    winner: null,
    log: ['Game started.'],
  }

  for (let index = 0; index < STARTING_HAND; index += 1) {
    drawCard(state, 0)
    drawCard(state, 1)
  }

  state.log.push('Player 1 starts.')
  return state
}

export function canAct(state: GameState, actor: number): boolean {
  if (actor !== 0 && actor !== 1) {
    return false
  }
  if (state.phase === 'gameOver') {
    return false
  }
  if (state.phase === 'declareBlockers') {
    return actor === (state.currentPlayer === 0 ? 1 : 0)
  }
  return actor === state.currentPlayer
}

export function getLegalActions(state: GameState, actor: number): GameAction[] {
  if (!canAct(state, actor)) {
    return []
  }

  const actions: GameAction[] = []
  const me = state.players[actor]

  if (state.phase === 'main') {
    if (me.landsPlayedThisTurn < 1) {
      for (const card of me.hand.filter((entry) => entry.type === 'land')) {
        actions.push({ type: 'play_land', actor, cardId: card.id })
      }
    }

    const mana = availableMana(me)
    for (const card of me.hand.filter((entry) => entry.type === 'creature' && entry.cost <= mana)) {
      actions.push({ type: 'cast_creature', actor, cardId: card.id })
    }

    actions.push({ type: 'end_main', actor })
  }

  if (state.phase === 'declareAttackers') {
    const candidates = me.battlefield
      .filter((entry) => entry.card.type === 'creature' && !entry.tapped && !entry.summoningSickness)
      .map((entry) => entry.instanceId)
    actions.push({ type: 'declare_attackers', actor, attackerIds: candidates })
    actions.push({ type: 'declare_attackers', actor, attackerIds: [] })
  }

  if (state.phase === 'declareBlockers') {
    const enemy = state.players[state.currentPlayer]
    const blockers = me.battlefield
      .filter((entry) => entry.card.type === 'creature' && !entry.tapped)
      .map((entry) => entry.instanceId)

    const blocks: Record<string, string | null> = {}
    let cursor = 0
    for (const attacker of state.attackers) {
      blocks[attacker] = blockers[cursor] ?? null
      cursor += 1
    }

    actions.push({ type: 'declare_blockers', actor, blocks })
    actions.push({ type: 'declare_blockers', actor, blocks: Object.fromEntries(state.attackers.map((id) => [id, null])) })
    if (enemy.battlefield.length === 0) {
      actions.push({ type: 'declare_blockers', actor, blocks: {} })
    }
  }

  return actions
}

function moveToGraveyard(player: PlayerState, instanceId: string): void {
  const index = player.battlefield.findIndex((entry) => entry.instanceId === instanceId)
  if (index >= 0) {
    const [entry] = player.battlefield.splice(index, 1)
    player.graveyard.push(entry.card)
  }
}

function resolveCombat(state: GameState, blocks: Record<string, string | null>): void {
  const attackerPlayer = state.players[state.currentPlayer]
  const defenderId = state.currentPlayer === 0 ? 1 : 0
  const defenderPlayer = state.players[defenderId]

  for (const attackerId of state.attackers) {
    const attacker = attackerPlayer.battlefield.find((entry) => entry.instanceId === attackerId)
    if (!attacker) {
      continue
    }

    attacker.tapped = true

    const blockerId = blocks[attackerId]
    if (!blockerId) {
      defenderPlayer.life -= attacker.card.power
      state.log.push(`${attacker.card.name} hits Player ${defenderId + 1} for ${attacker.card.power}.`)
      continue
    }

    const blocker = defenderPlayer.battlefield.find((entry) => entry.instanceId === blockerId)
    if (!blocker) {
      defenderPlayer.life -= attacker.card.power
      state.log.push(`${attacker.card.name} bypasses and hits for ${attacker.card.power}.`)
      continue
    }

    const attackerDies = blocker.card.power >= attacker.card.toughness
    const blockerDies = attacker.card.power >= blocker.card.toughness

    state.log.push(`${attacker.card.name} battles ${blocker.card.name}.`)

    if (attackerDies) {
      moveToGraveyard(attackerPlayer, attacker.instanceId)
      state.log.push(`${attacker.card.name} dies.`)
    }
    if (blockerDies) {
      moveToGraveyard(defenderPlayer, blocker.instanceId)
      state.log.push(`${blocker.card.name} dies.`)
    }
  }

  state.attackers = []

  const winner = checkWinner(state)
  if (winner !== null) {
    state.winner = winner
    state.phase = 'gameOver'
    state.log.push(winner === 'draw' ? 'Game ends in a draw.' : `Player ${winner + 1} wins.`)
    return
  }

  state.currentPlayer = defenderId
  state.turn += 1
  beginTurn(state)
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
    if (!card || card.type !== 'land') {
      return state
    }

    me.landsPlayedThisTurn += 1
    addToBattlefield(state, me, card)
    state.log.push(`Player ${action.actor + 1} plays a land.`)
    return state
  }

  if (action.type === 'cast_creature' && state.phase === 'main') {
    const me = state.players[action.actor]
    const card = me.hand.find((entry) => entry.id === action.cardId)
    if (!card || card.type !== 'creature') {
      return state
    }

    if (availableMana(me) < card.cost || !spendMana(me, card.cost)) {
      return state
    }

    removeFromHand(me, action.cardId)
    addToBattlefield(state, me, card)
    state.log.push(`Player ${action.actor + 1} casts ${card.name}.`)
    return state
  }

  if (action.type === 'end_main' && state.phase === 'main') {
    state.phase = 'declareAttackers'
    state.log.push(`Player ${action.actor + 1} moves to combat.`)
    return state
  }

  if (action.type === 'declare_attackers' && state.phase === 'declareAttackers') {
    const me = state.players[action.actor]
    const legal = new Set(
      me.battlefield
        .filter((entry) => entry.card.type === 'creature' && !entry.tapped && !entry.summoningSickness)
        .map((entry) => entry.instanceId),
    )

    const chosen = action.attackerIds.filter((id, index, arr) => legal.has(id) && arr.indexOf(id) === index)
    state.attackers = chosen
    state.phase = 'declareBlockers'
    state.log.push(`Player ${action.actor + 1} attacks with ${chosen.length} creature(s).`)
    return state
  }

  if (action.type === 'declare_blockers' && state.phase === 'declareBlockers') {
    resolveCombat(state, action.blocks)
    return state
  }

  return state
}
