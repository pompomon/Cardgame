import type {
  BasicLand,
  BattlefieldCard,
  Card,
  GameAction,
  GamePhase,
  GameState,
  PlayerState,
} from '../game/types'
import type { AdventureOpponentKind } from './adventure'
import { cardCatalogEntry, displayCardName } from './card-catalog'
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

export function displayAdventureOpponentLabel(
  kind: AdventureOpponentKind,
  lands: readonly BasicLand[],
): string {
  switch (kind) {
    case 'standard':
      return 'Balanced roster (10 of each creature)'
    case 'dual':
      return lands.length >= 2
        ? `Duo: ${displayCardName(lands[0])} + ${displayCardName(lands[1])}`
        : 'Duo roster'
    case 'mono':
      return lands.length >= 1
        ? `Boss: ${displayCardName(lands[0])} specialist`
        : 'Boss specialist'
    case 'random':
      return 'Mystery roster'
    default:
      return 'Mystery roster'
  }
}

export function displayGamePhase(phase: GamePhase): string {
  switch (phase) {
    case 'main':
    case 'plains_target':
    case 'swamp_target':
      return 'Action phase'
    case 'respond':
      return 'Interception window'
    case 'gameOver':
      return 'Game over'
    default:
      return 'Unknown phase'
  }
}

export type VisibleUiCard = Readonly<UiCard & {
  serializedKey: BasicLand
  displayName: string
}>

export type VisibleUiBattlefieldCard = Readonly<UiBattlefieldCard & {
  serializedKey: BasicLand
  displayName: string
}>

export function projectVisibleCard(card: Pick<Card, 'id' | 'name'>): VisibleUiCard {
  return Object.freeze({
    id: card.id,
    name: card.name,
    serializedKey: card.name,
    displayName: displayCardName(card.name),
  })
}

export function projectHiddenCard(card: Pick<Card, 'id'>): Readonly<UiCard> {
  return Object.freeze({
    id: card.id,
    name: HIDDEN_HAND_CARD_NAME,
    displayName: 'Hidden card',
  })
}

export function projectBattlefieldCard(entry: BattlefieldCard): VisibleUiBattlefieldCard {
  return Object.freeze({
    instanceId: entry.instanceId,
    cardId: entry.card.id,
    name: entry.card.name,
    serializedKey: entry.card.name,
    displayName: displayCardName(entry.card.name),
  })
}

export function shouldHideHandFromViewer(
  controllers: readonly [ControllerKind, ControllerKind],
  playerIndex: number,
): boolean {
  return controllers[playerIndex] !== 'human' && controllers[1 - playerIndex] === 'human'
}

export function projectHandCards(
  hand: ReadonlyArray<Pick<Card, 'id' | 'name'>>,
  controllers: readonly [ControllerKind, ControllerKind],
  playerIndex: number,
): readonly Readonly<UiCard>[] {
  if (shouldHideHandFromViewer(controllers, playerIndex)) {
    return Object.freeze(hand.map(projectHiddenCard))
  }
  return Object.freeze(hand.map(projectVisibleCard))
}

export function projectPlayerPresentation(
  player: PlayerState,
  controllers: readonly [ControllerKind, ControllerKind],
  playerIndex: 0 | 1,
): PlayerPresentationSummary {
  const handCards = projectHandCards(player.hand, controllers, playerIndex)
  const graveyardCards = Object.freeze(player.graveyard.map(projectVisibleCard))
  const battlefield = Object.freeze(player.battlefield.map(projectBattlefieldCard))

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
    game.players[enemy].hand.map(projectVisibleCard),
  )
}

function nestedTargetLabel(
  game: GameState,
  actor: number,
  serializedKey: 'Forest' | 'Mountain' | 'Swamp',
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
  if (serializedKey === 'Forest') {
    const target = me.graveyard.find((entry) => entry.id === effectTargetId)
    return target
      ? `Reclaim ${displayCardName(target.name)} from your discard pile`
      : null
  }
  if (serializedKey === 'Mountain') {
    const target = enemy.battlefield.find((entry) => entry.instanceId === effectTargetId)
    return target
      ? `Banish ${displayCardName(target.card.name)} to its owner's discard pile`
      : null
  }
  const target = enemy.hand.find((entry) => entry.id === effectTargetId)
  if (!target) {
    return null
  }
  const hideName = shouldHideHandFromViewer(controllers, enemyIndex) && !revealEnemyHand
  return `Drain Memory — choose ${hideName ? 'a hidden card' : displayCardName(target.name)} for your opponent to discard`
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
    return 'Summon creature'
  }

  let label = `Summon ${displayCardName(card.name)}`
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
      const targetEntry = cardCatalogEntry(target.card.name)
      label += ` (Mimic ${targetEntry.displayName} — ${targetEntry.primaryAbility.name})`
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
    return 'Resolve Mimic ability'
  }
  const reused = cardCatalogEntry(reusedName)
  const label = `Mimic ${reused.displayName} — ${reused.primaryAbility.name}`
  if (reusedName === 'Forest' || reusedName === 'Mountain' || reusedName === 'Swamp') {
    const suffix = nestedTargetLabel(
      game,
      actor,
      reusedName,
      action.effectTargetId,
      controllers,
      revealEnemyHand,
    )
    return suffix ? `${label} (${suffix})` : label
  }
  return label
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
  const suffix = discard ? ` + ${displayCardName(discard.name)}` : ' + one other card'
  return `Intercept with Signal Siren (discard Signal Siren${suffix})`
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
        ? `Drain Memory — choose ${hideName ? 'a hidden card' : displayCardName(target.name)} for your opponent to discard`
        : 'Drain Memory — choose a card for your opponent to discard'
    }
    case 'counter_land':
      return counterLabelFor(game, action.actor, action)
    case 'end_turn':
      return 'End Turn'
    case 'pass_response':
      return 'Let It Through'
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
