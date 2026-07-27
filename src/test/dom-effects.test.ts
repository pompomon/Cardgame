import { describe, expect, it, vi, afterEach } from 'vitest'
import { scheduleDomEffect } from '../renderers/dom-utils'
import type { LogEvent } from '../game/types'

// DOM effect guard tests: verify that scheduleDomEffect is a no-op in the
// right conditions, and schedules requestAnimationFrame for animatable events.

describe('scheduleDomEffect', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is a no-op when animationSpeed is "off"', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const event: LogEvent = { kind: 'ability_forest_return', actor: 0, cardName: 'Forest' }
    scheduleDomEffect(event, 'off', 'classic')
    expect(raf).not.toHaveBeenCalled()
  })

  it('is a no-op for non-animatable events', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const event: LogEvent = { kind: 'turn_start', turn: 1, actor: 0 }
    scheduleDomEffect(event, 'normal', 'classic')
    expect(raf).not.toHaveBeenCalled()
  })

  it('calls requestAnimationFrame for an animatable event at non-off speed', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const event: LogEvent = { kind: 'ability_forest_return', actor: 0, cardName: 'Forest' }
    scheduleDomEffect(event, 'normal', 'classic')
    expect(raf).toHaveBeenCalledOnce()
  })

  it('calls requestAnimationFrame for play_land events', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const event: LogEvent = { kind: 'play_land', actor: 0, cardName: 'Forest' }
    scheduleDomEffect(event, 'fast', 'classic')
    expect(raf).toHaveBeenCalledOnce()
  })

  it('anchors resolved counter effects to the active battlefield', () => {
    const querySelector = vi.fn().mockReturnValue(null)
    const raf = vi.fn((callback: FrameRequestCallback) => callback(0))
    vi.stubGlobal('document', { querySelector })
    vi.stubGlobal('requestAnimationFrame', raf)
    const event: LogEvent = { kind: 'counter_resolved', actor: 1, cardName: 'Forest' }
    scheduleDomEffect(event, 'normal', 'classic')
    expect(querySelector).toHaveBeenCalledWith('.battlefield-active')
  })

  it('is a no-op for game_started events', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const event: LogEvent = { kind: 'game_started' }
    scheduleDomEffect(event, 'normal', 'classic')
    expect(raf).not.toHaveBeenCalled()
  })
})
