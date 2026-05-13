import type { BasicLand, LogEvent } from '../../game/types'
import { isBasicLand } from '../../game/types'

// Pure helpers for rendering structured `LogEvent` values into renderer-
// friendly tiles (label + glyph + optional land card name). Kept renderer-
// agnostic so both Phaser and DOM (or future translations) can consume them.

export interface LogEventTile {
  // Optional player who initiated the action; `null` for game-wide events.
  actor: number | null
  // Short, human-readable description of the action (no actor prefix).
  label: string
  // For tiles that should display a land card art icon, the card name.
  cardName: BasicLand | null
  // Otherwise a small glyph string used as a tile icon.
  glyph: string
}

function playerLabel(actor: number): string {
  return `P${actor + 1}`
}

export function formatLogEventTile(event: LogEvent): LogEventTile {
  switch (event.kind) {
    case 'game_started':
      return { actor: null, label: 'Game started', cardName: null, glyph: '🏳' }
    case 'game_start_skip_draw':
      return { actor: event.actor, label: 'starts (skips first draw)', cardName: null, glyph: '▶' }
    case 'turn_start':
      return { actor: event.actor, label: `Turn ${event.turn} • main phase`, cardName: null, glyph: '▶' }
    case 'draw':
      return { actor: event.actor, label: `draws ${event.cardName}`, cardName: event.cardName, glyph: '+' }
    case 'play_land':
      return { actor: event.actor, label: `plays ${event.cardName}`, cardName: event.cardName, glyph: '◆' }
    case 'ability_forest_return':
      return { actor: event.actor, label: `returns ${event.cardName}`, cardName: event.cardName, glyph: '↩' }
    case 'ability_swamp_discard':
      return { actor: event.actor, label: `forces ${playerLabel(event.target)} to discard ${event.cardName}`, cardName: event.cardName, glyph: '✖' }
    case 'ability_mountain_destroy':
      return { actor: event.actor, label: `destroys ${playerLabel(event.target)}'s ${event.cardName}`, cardName: event.cardName, glyph: '✖' }
    case 'ability_plains_reuse':
      return { actor: event.actor, label: `reuses ${event.reusedName}`, cardName: event.reusedName, glyph: '↺' }
    case 'counter_offered':
      return { actor: event.responder, label: `may counter ${event.cardName}`, cardName: event.cardName, glyph: '⏸' }
    case 'counter_resolved':
      return { actor: event.actor, label: `counters ${event.cardName}`, cardName: event.cardName, glyph: '✖' }
    case 'deck_empty_loss':
      return { actor: event.actor, label: 'loses (empty deck)', cardName: null, glyph: '🏁' }
    case 'game_end':
      if (event.winner === 'draw') {
        return { actor: null, label: 'Game ends in a draw', cardName: null, glyph: '🏁' }
      }
      if (event.winner === null) {
        return { actor: null, label: 'Game ended', cardName: null, glyph: '🏁' }
      }
      return { actor: event.winner, label: 'wins the game', cardName: null, glyph: '🏁' }
  }
}

// Plain-text rendering used by accessibility mirrors and tests so the visual
// log degrades gracefully (matching the pre-LogEvent text log's intent).
export function formatLogEventText(event: LogEvent): string {
  const tile = formatLogEventTile(event)
  if (tile.actor === null) {
    return tile.label
  }
  return `${playerLabel(tile.actor)} ${tile.label}`
}

export function isLandTileEvent(event: LogEvent): boolean {
  const tile = formatLogEventTile(event)
  return tile.cardName !== null && isBasicLand(tile.cardName)
}
