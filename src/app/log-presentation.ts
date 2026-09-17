import { isBasicLand, type BasicLand, type LogEvent } from '../game/types'
import { cardCatalogEntry, displayCardName } from './card-catalog'
import { displayGamePhase, shouldHideHandFromViewer } from './game-presentation'
import type { ControllerKind } from './types'

export const MAX_RENDERED_LOG_TILES = 200

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
  readonly glyph: string
  readonly translated: boolean
}

export interface LogEventTile {
  readonly actor: number | null
  readonly label: string
  readonly cardName: BasicLand | null
  readonly glyph: string
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
  glyph: string,
  text = actor === null ? label : `P${actor + 1} ${label}`,
  translated = true,
): PresentedLogEntry {
  return Object.freeze({ actor, label, text, card, glyph, translated })
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
      return presentedLogEntry(null, 'Game started', null, '🏳')
    case 'game_start_skip_draw':
      return presentedLogEntry(event.actor, 'starts (skips first draw)', null, '▶')
    case 'turn_start':
      return presentedLogEntry(
        event.actor,
        `Turn ${event.turn} • ${displayGamePhase('main')}`,
        null,
        '▶',
        `P${event.actor + 1} · Turn ${event.turn} • ${displayGamePhase('main')}`,
      )
    case 'draw':
      if (!canSeeDrawnCard(viewer, event.actor)) {
        return presentedLogEntry(event.actor, 'draws a card', null, '+')
      }
      return presentedLogEntry(
        event.actor,
        `draws ${displayCardName(event.cardName)}`,
        presentedLogCard(event.cardName),
        '+',
      )
    case 'play_land':
      return presentedLogEntry(
        event.actor,
        `summons ${displayCardName(event.cardName)}`,
        presentedLogCard(event.cardName),
        '◆',
      )
    case 'ability_forest_return':
      return presentedLogEntry(
        event.actor,
        `reclaims ${displayCardName(event.cardName)} from their discard pile`,
        presentedLogCard(event.cardName),
        '↩',
      )
    case 'ability_swamp_discard':
      return presentedLogEntry(
        event.actor,
        `drains a memory; P${event.target + 1} discards ${displayCardName(event.cardName)}`,
        presentedLogCard(event.cardName),
        '✖',
      )
    case 'ability_mountain_destroy':
      return presentedLogEntry(
        event.actor,
        `banishes P${event.target + 1}'s ${displayCardName(event.cardName)} to its owner's discard pile`,
        presentedLogCard(event.cardName),
        '✖',
      )
    case 'ability_plains_reuse': {
      const reused = cardCatalogEntry(event.reusedName)
      const label = `Echo Doppelgänger mimics ${reused.displayName} — ${reused.primaryAbility.name}`
      return presentedLogEntry(
        event.actor,
        label,
        presentedLogCard(event.reusedName),
        '↺',
        `P${event.actor + 1}'s ${label}`,
      )
    }
    case 'counter_offered': {
      const summoner = event.responder === 0 ? 1 : 0
      return presentedLogEntry(
        event.responder,
        `may intercept P${summoner + 1}'s summon of ${displayCardName(event.cardName)}`,
        presentedLogCard(event.cardName),
        '⏸',
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
        '✖',
      )
    }
    case 'deck_empty_loss':
      return presentedLogEntry(event.actor, 'loses (empty deck)', null, '🏁')
    case 'game_end':
      if (event.winner === 'draw') {
        return presentedLogEntry(null, 'Game ends in a draw', null, '🏁')
      }
      if (event.winner === null) {
        return presentedLogEntry(null, 'Game ended', null, '🏁')
      }
      return presentedLogEntry(event.winner, 'wins the game', null, '🏁')
    default:
      return presentedLogEntry(null, 'Unknown event', null, '?', 'Unknown event', false)
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
  const turn = match ? Number(match[1]) : Number.NaN
  if (actor !== null && Number.isSafeInteger(turn) && turn >= 0) {
    return presentLogEvent({ kind: 'turn_start', turn, actor }, viewer)
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
    return presentedLogEntry(
      null,
      `Gravebloom Dryad reclaims ${displayCardName(card)} from the discard pile`,
      presentedLogCard(card),
      '↩',
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
      '✖',
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
      '✖',
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
      '↺',
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

  return presentedLogEntry(null, line, null, '?', line, false)
}

export function formatLogEventTile(
  event: LogEvent,
  viewer: LogViewerContext,
): LogEventTile {
  const entry = presentLogEvent(event, viewer)
  return {
    actor: entry.actor,
    label: entry.label,
    cardName: entry.card?.serializedKey ?? null,
    glyph: entry.glyph,
  }
}

export function formatLogEventText(
  event: LogEvent,
  viewer: LogViewerContext,
): string {
  return presentLogEvent(event, viewer).text
}

export function isLandTileEvent(
  event: LogEvent,
  viewer: LogViewerContext,
): boolean {
  return presentLogEvent(event, viewer).card !== null
}
