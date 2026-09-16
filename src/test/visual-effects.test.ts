import { describe, expect, it } from 'vitest'
import { visualEffectForEvent } from '../app/visual-effects'
import type { LogEvent } from '../game/types'

describe('visual effect descriptors', () => {
  it('maps structured events to style-aware semantic effects', () => {
    const event: LogEvent = {
      kind: 'ability_mountain_destroy',
      actor: 0,
      target: 1,
      cardName: 'Forest',
      sourceInstanceId: 'p0-2',
      targetInstanceId: 'p1-4',
    }
    const result = visualEffectForEvent(event, 'monochrome')
    expect(result).toMatchObject({
      kind: 'mountain_destroy',
      actor: 0,
      targetActor: 1,
      land: 'Mountain',
      sourceInstanceId: 'p0-2',
      targetInstanceId: 'p1-4',
      targetCardName: 'Forest',
      sourceDisplayName: 'Rooftop Gargoyle',
      targetDisplayName: 'Gravebloom Dryad',
      caption: 'Banished to discard pile',
      visualStyle: 'monochrome',
    })
    expect(result?.palette).toEqual({
      primary: '#dadada',
      secondary: '#a6a6a6',
      glow: '#989898',
    })
  })

  it('returns null for events without a visual recipe', () => {
    expect(visualEffectForEvent({ kind: 'turn_start', turn: 2, actor: 1 }, 'hd')).toBeNull()
  })

  it('uses the played land palette for land-entry effects', () => {
    const effect = visualEffectForEvent(
      { kind: 'play_land', actor: 0, cardName: 'Island', sourceInstanceId: 'p0-1' },
      'hd',
    )
    expect(effect?.land).toBe('Island')
    expect(effect?.sourceDisplayName).toBe('Signal Siren')
    expect(effect?.caption).toBe('Summoned')
    expect(effect?.palette.secondary).toBe('#5fb6ff')
  })

  it('maps card-aware counters to the Island and selected additional discard', () => {
    const effect = visualEffectForEvent({
      kind: 'counter_resolved',
      actor: 1,
      cardName: 'Forest',
      discardCardName: 'Swamp',
    }, 'hd')
    expect(effect?.counterCards).toEqual(['Island', 'Swamp'])
    expect(effect?.sourceDisplayName).toBe('Signal Siren')
    expect(effect?.targetDisplayName).toBe('Gravebloom Dryad')
    expect(effect?.caption).toBe('Intercepted')
    expect(visualEffectForEvent({
      kind: 'counter_resolved',
      actor: 1,
      cardName: 'Forest',
    }, 'hd')?.counterCards).toBeUndefined()
  })

  it('supplies approved compact captions for every visual effect kind', () => {
    const events: Array<[LogEvent, string]> = [
      [{ kind: 'play_land', actor: 0, cardName: 'Forest' }, 'Summoned'],
      [{ kind: 'ability_forest_return', actor: 0, cardName: 'Island' }, 'Reclaimed'],
      [{
        kind: 'ability_swamp_discard',
        actor: 0,
        target: 1,
        cardName: 'Mountain',
      }, 'Memory drained'],
      [{
        kind: 'ability_mountain_destroy',
        actor: 0,
        target: 1,
        cardName: 'Plains',
      }, 'Banished to discard pile'],
      [{
        kind: 'ability_plains_reuse',
        actor: 0,
        reusedName: 'Swamp',
      }, 'Ability mimicked'],
      [{
        kind: 'counter_resolved',
        actor: 1,
        cardName: 'Forest',
      }, 'Intercepted'],
    ]

    expect(events.map(([event]) => visualEffectForEvent(event, 'classic')?.caption))
      .toEqual(events.map(([, caption]) => caption))
  })
})
