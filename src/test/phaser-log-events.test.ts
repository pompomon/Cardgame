import { describe, expect, it } from 'vitest'
import { formatLogEventText, formatLogEventTile, isLandTileEvent } from '../renderers/phaser/log-events'
import type { LogEvent } from '../game/types'

describe('phaser log-events', () => {
  it('renders draw events with land card icon', () => {
    const event: LogEvent = { kind: 'draw', actor: 0, cardName: 'Forest' }
    const tile = formatLogEventTile(event)
    expect(tile).toEqual({ actor: 0, label: 'draws Forest', cardName: 'Forest', glyph: '+' })
    expect(formatLogEventText(event)).toBe('P1 draws Forest')
    expect(isLandTileEvent(event)).toBe(true)
  })

  it('renders ability resolutions with target attribution', () => {
    const swamp: LogEvent = { kind: 'ability_swamp_discard', actor: 0, target: 1, cardName: 'Plains' }
    expect(formatLogEventText(swamp)).toBe("P1 forces P2 to discard Plains")
    const mountain: LogEvent = { kind: 'ability_mountain_destroy', actor: 1, target: 0, cardName: 'Island' }
    expect(formatLogEventText(mountain)).toBe("P2 destroys P1's Island")
    const reuse: LogEvent = { kind: 'ability_plains_reuse', actor: 0, reusedName: 'Mountain' }
    expect(formatLogEventText(reuse)).toBe('P1 reuses Mountain')
  })

  it('renders game-wide events without an actor prefix', () => {
    expect(formatLogEventText({ kind: 'game_started' })).toBe('Game started')
    expect(formatLogEventText({ kind: 'game_end', winner: 'draw' })).toBe('Game ends in a draw')
    expect(formatLogEventText({ kind: 'game_end', winner: 0 })).toBe('P1 wins the game')
  })

  it('flags land-icon events vs glyph-only events', () => {
    expect(isLandTileEvent({ kind: 'play_land', actor: 0, cardName: 'Forest' })).toBe(true)
    expect(isLandTileEvent({ kind: 'turn_start', turn: 1, actor: 0 })).toBe(false)
    expect(isLandTileEvent({ kind: 'game_started' })).toBe(false)
  })

  it('handles counter_offered as belonging to the responder', () => {
    const event: LogEvent = { kind: 'counter_offered', responder: 1, cardName: 'Forest' }
    const tile = formatLogEventTile(event)
    expect(tile.actor).toBe(1)
    expect(tile.label).toBe('may counter Forest')
  })
})
