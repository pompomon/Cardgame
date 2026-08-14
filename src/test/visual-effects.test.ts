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
    expect(visualEffectForEvent({ kind: 'hidden_draw', actor: 1 }, 'hd')).toBeNull()
  })

  it('uses the played land palette for land-entry effects', () => {
    const effect = visualEffectForEvent(
      { kind: 'play_land', actor: 0, cardName: 'Island', sourceInstanceId: 'p0-1' },
      'hd',
    )
    expect(effect?.land).toBe('Island')
    expect(effect?.palette.secondary).toBe('#5fb6ff')
  })
})
