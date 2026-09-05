import type { GameAction, GameState, PlayerState } from '../game/types'
import type { ControllerKind, UiBattlefieldCard, UiCard } from './types'
import { HIDDEN_HAND_CARD_NAME } from './types'

export interface PlayerPresentationSummary {
  readonly id: number
  readonly handCount: number
  readonly deckCount: number
  readonly graveyardCount: number
  readonly handCards: readonly Readonly<UiCard>[]
  readonly graveyardCards: readonly Readonly<UiCard>[]
  readonly battlefield: readonly Readonly<UiBattlefieldCard>[]
}

export interface LabeledGameAction {
  readonly action: GameAction
  readonly label: string
}

export function shouldHideHandFromViewer(
  controllers: readonly [ControllerKind, ControllerKind],
  playerIndex: number,
): boolean {
  return controllers[playerIndex] === 'ai' && controllers[1 - playerIndex] === 'human'
}

export function projectHandCards(
  hand: ReadonlyArray<{ id: string; name: string }>,
  controllers: readonly [ControllerKind, ControllerKind],
  playerIndex: number,
): UiCard[] {
  if (shouldHideHandFromViewer(controllers, playerIndex)) {
    return hand.map((card) => ({ id: card.id, name: HIDDEN_HAND_CARD_NAME }))
  }
  return hand.map((card) => ({ id: card.id, name: card.name }))
}

export function projectPlayerPresentation(
  player: PlayerState,
  controllers: readonly [ControllerKind, ControllerKind],
  playerIndex: 0 | 1,
): PlayerPresentationSummary {
  const handCards = projectHandCards(player.hand, controllers, playerIndex)
    .map((card) => Object.freeze(card))
  const graveyardCards = player.graveyard
    .map((card) => Object.freeze({ id: card.id, name: card.name }))
  const battlefield = player.battlefield
    .map((entry) => Object.freeze({
      instanceId: entry.instanceId,
      cardId: entry.card.id,
      name: entry.card.name,
    }))

  return Object.freeze({
    id: player.id,
    handCount: player.hand.length,
    deckCount: player.deck.length,
    graveyardCount: player.graveyard.length,
    handCards: Object.freeze(handCards),
    graveyardCards: Object.freeze(graveyardCards),
    battlefield: Object.freeze(battlefield),
  })
}

export function projectPlayersForPresentation(
  game: GameState,
  controllers: readonly [ControllerKind, ControllerKind],
): readonly [PlayerPresentationSummary, PlayerPresentationSummary] {
  return Object.freeze([
    projectPlayerPresentation(game.players[0], controllers, 0),
    projectPlayerPresentation(game.players[1], controllers, 1),
  ])
}

export function shouldRevealEnemyHandForSwamp(
  game: GameState,
  actor: number,
  controllers: readonly [ControllerKind, ControllerKind],
  replayActive = false,
): boolean {
  if (replayActive || controllers[actor] !== 'human') {
    return false
  }
  if (game.phase === 'swamp_target') {
    return game.pendingSwampDiscard?.actor === actor
  }
  return game.phase === 'plains_target'
    && game.pendingPlainsReuse?.actor === actor
    && game.pendingPlainsReuse.reusedCardName === 'Swamp'
}

export function revealedEnemyHandForSwamp(
  game: GameState,
  actor: number,
  controllers: readonly [ControllerKind, ControllerKind],
  replayActive = false,
): ReadonlyArray<Readonly<UiCard>> | null {
  if (!shouldRevealEnemyHandForSwamp(game, actor, controllers, replayActive)) {
    return null
  }
  const enemy = actor === 0 ? 1 : 0
  return Object.freeze(
    game.players[enemy].hand.map((card) => Object.freeze({ id: card.id, name: card.name })),
  )
}

function nestedTargetLabel(
  game: GameState,
  actor: number,
  cardName: 'Forest' | 'Mountain' | 'Swamp',
  effectTargetId: string | undefined,
  controllers: readonly [ControllerKind, ControllerKind],
  revealEnemyHand: boolean,
): string | null {
  if (!effectTargetId) {
    return null
  }
  const me = game.players[actor]
  const enemyIndex = actor === 0 ? 1 : 0
  const enemy = game.players[enemyIndex]
  if (cardName === 'Forest') {
    const target = me.graveyard.find((entry) => entry.id === effectTargetId)
    return target ? `return ${target.name}` : null
  }
  if (cardName === 'Mountain') {
    const target = enemy.battlefield.find((entry) => entry.instanceId === effectTargetId)
    return target ? `destroy ${target.card.name}` : null
  }
  const target = enemy.hand.find((entry) => entry.id === effectTargetId)
  if (!target) {
    return null
  }
  const hideName = shouldHideHandFromViewer(controllers, enemyIndex) && !revealEnemyHand
  return `discard ${hideName ? 'hidden card' : target.name}`
}

function playLandLabelFor(
  game: GameState,
  actor: number,
  action: Extract<GameAction, { type: 'play_land' }>,
  controllers: readonly [ControllerKind, ControllerKind],
  revealEnemyHand: boolean,
): string {
  const me = game.players[actor]
  const card = me.hand.find((entry) => entry.id === action.cardId)
  if (!card) {
    return 'Play card'
  }

  let label = `Play ${card.name}`
  if (!action.effectTargetId) {
    return label
  }

  if (card.name === 'Forest' || card.name === 'Mountain' || card.name === 'Swamp') {
    const suffix = nestedTargetLabel(
      game,
      actor,
      card.name,
      action.effectTargetId,
      controllers,
      revealEnemyHand,
    )
    return suffix ? `${label} (${suffix})` : label
  }

  if (card.name === 'Plains') {
    const target = me.battlefield.find((entry) => entry.instanceId === action.effectTargetId)
    if (target) {
      label += ` (reuse ${target.card.name})`
    }
  }
  return label
}

function plainsReuseLabelFor(
  game: GameState,
  actor: number,
  action: Extract<GameAction, { type: 'resolve_plains_reuse' }>,
  controllers: readonly [ControllerKind, ControllerKind],
  revealEnemyHand: boolean,
): string {
  const reusedName = game.pendingPlainsReuse?.reusedCardName
  if (!reusedName) {
    return 'Resolve Plains reuse'
  }
  if (reusedName === 'Forest' || reusedName === 'Mountain' || reusedName === 'Swamp') {
    const suffix = nestedTargetLabel(
      game,
      actor,
      reusedName,
      action.effectTargetId,
      controllers,
      revealEnemyHand,
    )
    return suffix ? `Reuse ${reusedName} (${suffix})` : `Reuse ${reusedName}`
  }
  return `Reuse ${reusedName}`
}

function counterLabelFor(
  game: GameState,
  actor: number,
  action: Extract<GameAction, { type: 'counter_land' }>,
): string {
  const me = game.players[actor]
  const discard = action.discardCardId
    ? me.hand.find((card) => card.id === action.discardCardId)
    : undefined
  const suffix = discard ? ` + ${discard.name}` : ' + another land'
  return `Counter with Island (discard Island${suffix})`
}

export function labelGameAction(
  game: GameState,
  action: GameAction,
  controllers: readonly [ControllerKind, ControllerKind],
  revealEnemyHand = false,
): string {
  switch (action.type) {
    case 'play_land':
      return playLandLabelFor(game, action.actor, action, controllers, revealEnemyHand)
    case 'resolve_plains_reuse':
      return plainsReuseLabelFor(game, action.actor, action, controllers, revealEnemyHand)
    case 'resolve_swamp_discard': {
      const enemy = action.actor === 0 ? 1 : 0
      const target = action.effectTargetId
        ? game.players[enemy].hand.find((card) => card.id === action.effectTargetId)
        : undefined
      const hideName = shouldHideHandFromViewer(controllers, enemy) && !revealEnemyHand
      return target
        ? `Discard ${hideName ? 'hidden card' : target.name}`
        : 'Resolve Swamp discard'
    }
    case 'counter_land':
      return counterLabelFor(game, action.actor, action)
    case 'end_turn':
      return 'End turn'
    case 'pass_response':
      return 'Pass response'
    default:
      return 'Unknown action'
  }
}

export function labelGameActions(
  game: GameState,
  actions: readonly GameAction[],
  controllers: readonly [ControllerKind, ControllerKind],
  revealEnemyHand = false,
): readonly LabeledGameAction[] {
  const baseLabels = actions.map((action) =>
    labelGameAction(game, action, controllers, revealEnemyHand))
  const totals = new Map<string, number>()
  for (const label of baseLabels) {
    totals.set(label, (totals.get(label) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return Object.freeze(actions.map((action, index) => {
    const label = baseLabels[index]
    const occurrence = (seen.get(label) ?? 0) + 1
    seen.set(label, occurrence)
    const total = totals.get(label) ?? 1
    return Object.freeze({
      action,
      label: total > 1 ? `${label} [${occurrence}/${total}]` : label,
    })
  }))
}
