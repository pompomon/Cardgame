import type { BasicLand, LogEvent } from '../game/types'
import { isBasicLand } from '../game/types'

export const MAX_RENDERED_LOG_TILES = 200

export interface LogEventTile {
  actor: number | null
  label: string
  cardName: BasicLand | null
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
    default:
      return { actor: null, label: 'Unknown event', cardName: null, glyph: '?' }
  }
}

export function formatLogEventText(event: LogEvent): string {
  const tile = formatLogEventTile(event)
  return tile.actor === null ? tile.label : `${playerLabel(tile.actor)} ${tile.label}`
}

export function isLandTileEvent(event: LogEvent): boolean {
  const tile = formatLogEventTile(event)
  return tile.cardName !== null && isBasicLand(tile.cardName)
}
