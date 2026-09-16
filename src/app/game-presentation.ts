import { isBasicLand } from '../game/types'
import type {
  BasicLand,
  BattlefieldCard,
  Card,
  GameAction,
  GameState,
  LogEvent,
  PlayerState,
} from '../game/types'
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

export type VisibleUiCard = Readonly<UiCard & {
  serializedKey: BasicLand
  displayName: string
}>

export type VisibleUiBattlefieldCard = Readonly<UiBattlefieldCard & {
  serializedKey: BasicLand
  displayName: string
}>

export interface LogViewerContext {
  readonly controllers: readonly [ControllerKind, ControllerKind]
}

export interface PresentedLogCard {
  readonly serializedKey: BasicLand
  readonly displayName: string
}

export interface PresentedLogEntry {
  readonly actor: number | null
  readonly label: string
  readonly text: string
  readonly card: Readonly<PresentedLogCard> | null
  readonly translated: boolean
}

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
  return controllers[playerIndex] === 'ai' && controllers[1 - playerIndex] === 'human'
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

function presentedLogCard(serializedKey: BasicLand): Readonly<PresentedLogCard> {
  return Object.freeze({
    serializedKey,
    displayName: displayCardName(serializedKey),
  })
}

function presentedLogEntry(
  actor: number | null,
  label: string,
  card: Readonly<PresentedLogCard> | null,
  text = actor === null ? label : `P${actor + 1} ${label}`,
  translated = true,
): PresentedLogEntry {
  return Object.freeze({ actor, label, text, card, translated })
}

function canSeeDrawnCard(viewer: LogViewerContext, actor: number): boolean {
  return !shouldHideHandFromViewer(viewer.controllers, actor)
}

export function presentLogEvent(
  event: LogEvent,
  viewer: LogViewerContext,
): PresentedLogEntry {
  switch (event.kind) {
    case 'game_started':
      return presentedLogEntry(null, 'Game started', null)
    case 'game_start_skip_draw':
      return presentedLogEntry(event.actor, 'starts (skips first draw)', null)
    case 'turn_start':
      return presentedLogEntry(
        event.actor,
        `Turn ${event.turn} • Action phase`,
        null,
        `P${event.actor + 1} · Turn ${event.turn} • Action phase`,
      )
    case 'draw':
      if (!canSeeDrawnCard(viewer, event.actor)) {
        return presentedLogEntry(event.actor, 'draws a card', null)
      }
      return presentedLogEntry(
        event.actor,
        `draws ${displayCardName(event.cardName)}`,
        presentedLogCard(event.cardName),
      )
    case 'play_land':
      return presentedLogEntry(
        event.actor,
        `summons ${displayCardName(event.cardName)}`,
        presentedLogCard(event.cardName),
      )
    case 'ability_forest_return':
      return presentedLogEntry(
        event.actor,
        `reclaims ${displayCardName(event.cardName)} from their discard pile`,
        presentedLogCard(event.cardName),
      )
    case 'ability_swamp_discard':
      return presentedLogEntry(
        event.actor,
        `drains a memory; P${event.target + 1} discards ${displayCardName(event.cardName)}`,
        presentedLogCard(event.cardName),
      )
    case 'ability_mountain_destroy':
      return presentedLogEntry(
        event.actor,
        `banishes P${event.target + 1}'s ${displayCardName(event.cardName)} to its owner's discard pile`,
        presentedLogCard(event.cardName),
      )
    case 'ability_plains_reuse': {
      const reused = cardCatalogEntry(event.reusedName)
      const label = `Echo Doppelgänger mimics ${reused.displayName} — ${reused.primaryAbility.name}`
      return presentedLogEntry(
        event.actor,
        label,
        presentedLogCard(event.reusedName),
        `P${event.actor + 1}'s ${label}`,
      )
    }
    case 'counter_offered': {
      const summoner = event.responder === 0 ? 1 : 0
      return presentedLogEntry(
        event.responder,
        `may intercept P${summoner + 1}'s summon of ${displayCardName(event.cardName)}`,
        presentedLogCard(event.cardName),
      )
    }
    case 'counter_resolved': {
      const cost = event.discardCardName
        ? `Signal Siren and ${displayCardName(event.discardCardName)}`
        : 'Signal Siren and another card'
      return presentedLogEntry(
        event.actor,
        `intercepts ${displayCardName(event.cardName)} by discarding ${cost}`,
        presentedLogCard(event.cardName),
      )
    }
    case 'deck_empty_loss':
      return presentedLogEntry(event.actor, 'loses (empty deck)', null)
    case 'game_end':
      if (event.winner === 'draw') {
        return presentedLogEntry(null, 'Game ends in a draw', null)
      }
      if (event.winner === null) {
        return presentedLogEntry(null, 'Game ended', null)
      }
      return presentedLogEntry(event.winner, 'wins the game', null)
    default:
      return presentedLogEntry(null, 'Unknown event', null, 'Unknown event', false)
  }
}

function legacyCardKey(value: string | undefined): BasicLand | null {
  return isBasicLand(value) ? value : null
}

function legacyPlayerIndex(value: string | undefined): number | null {
  if (value !== '1' && value !== '2') {
    return null
  }
  return Number(value) - 1
}

export function presentLegacyLogLine(
  line: string,
  viewer: LogViewerContext,
): PresentedLogEntry {
  if (line === 'Game started.') {
    return presentLogEvent({ kind: 'game_started' }, viewer)
  }
  if (line === 'Game ends in a draw.') {
    return presentLogEvent({ kind: 'game_end', winner: 'draw' }, viewer)
  }

  let match = /^Player ([12]) starts and skips first draw step\.$/.exec(line)
  let actor = legacyPlayerIndex(match?.[1])
  if (actor !== null) {
    return presentLogEvent({ kind: 'game_start_skip_draw', actor }, viewer)
  }

  match = /^Turn (\d+): Player ([12]) main phase\.$/.exec(line)
  actor = legacyPlayerIndex(match?.[2])
  if (actor !== null && match) {
    return presentLogEvent({ kind: 'turn_start', turn: Number(match[1]), actor }, viewer)
  }

  match = /^Player ([12]) draws (Forest|Island|Mountain|Plains|Swamp)\.$/.exec(line)
  actor = legacyPlayerIndex(match?.[1])
  let card = legacyCardKey(match?.[2])
  if (actor !== null && card) {
    return presentLogEvent({ kind: 'draw', actor, cardName: card }, viewer)
  }

  match = /^Player ([12]) plays (Forest|Island|Mountain|Plains|Swamp)\.$/.exec(line)
  actor = legacyPlayerIndex(match?.[1])
  card = legacyCardKey(match?.[2])
  if (actor !== null && card) {
    return presentLogEvent({ kind: 'play_land', actor, cardName: card }, viewer)
  }

  match = /^Forest returns (Forest|Island|Mountain|Plains|Swamp) from graveyard to hand\.$/.exec(line)
  card = legacyCardKey(match?.[1])
  if (card) {
    const displayName = displayCardName(card)
    return presentedLogEntry(
      null,
      `Gravebloom Dryad reclaims ${displayName} from the discard pile`,
      presentedLogCard(card),
    )
  }

  match = /^Swamp makes Player ([12]) discard (Forest|Island|Mountain|Plains|Swamp)\.$/.exec(line)
  const target = legacyPlayerIndex(match?.[1])
  card = legacyCardKey(match?.[2])
  if (target !== null && card) {
    return presentedLogEntry(
      null,
      `Memory Vampire drains a memory; P${target + 1} discards ${displayCardName(card)}`,
      presentedLogCard(card),
    )
  }

  match = /^Mountain destroys Player ([12])'s (Forest|Island|Mountain|Plains|Swamp)\.$/.exec(line)
  const owner = legacyPlayerIndex(match?.[1])
  card = legacyCardKey(match?.[2])
  if (owner !== null && card) {
    return presentedLogEntry(
      null,
      `Rooftop Gargoyle banishes P${owner + 1}'s ${displayCardName(card)} to its owner's discard pile`,
      presentedLogCard(card),
    )
  }

  match = /^Plains reuses (Forest|Island|Mountain|Plains|Swamp)\.$/.exec(line)
  card = legacyCardKey(match?.[1])
  if (card) {
    const reused = cardCatalogEntry(card)
    return presentedLogEntry(
      null,
      `Echo Doppelgänger mimics ${reused.displayName} — ${reused.primaryAbility.name}`,
      presentedLogCard(card),
    )
  }

  match = /^Player ([12]) may counter (Forest|Island|Mountain|Plains|Swamp) with Island\.$/.exec(line)
  actor = legacyPlayerIndex(match?.[1])
  card = legacyCardKey(match?.[2])
  if (actor !== null && card) {
    return presentLogEvent({ kind: 'counter_offered', responder: actor, cardName: card }, viewer)
  }

  match = /^Player ([12]) counters (Forest|Island|Mountain|Plains|Swamp)\.$/.exec(line)
  actor = legacyPlayerIndex(match?.[1])
  card = legacyCardKey(match?.[2])
  if (actor !== null && card) {
    return presentLogEvent({ kind: 'counter_resolved', actor, cardName: card }, viewer)
  }

  match = /^Player ([12]) loses by drawing from empty deck\.$/.exec(line)
  actor = legacyPlayerIndex(match?.[1])
  if (actor !== null) {
    return presentLogEvent({ kind: 'deck_empty_loss', actor }, viewer)
  }

  match = /^Player ([12]) wins\.$/.exec(line)
  actor = legacyPlayerIndex(match?.[1])
  if (actor !== null) {
    return presentLogEvent({ kind: 'game_end', winner: actor }, viewer)
  }

  return presentedLogEntry(null, line, null, line, false)
}
