import { describe, expect, it, vi, afterEach } from 'vitest'
import { clearDomEffects, scheduleDomEffect } from '../renderers/dom-utils'
import type { LogEvent } from '../game/types'
import { withFakeTimers } from './helpers/timers'

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

  it('does not create an overlay when the queued render becomes stale before RAF', () => {
    let callback: FrameRequestCallback | null = null
    const querySelector = vi.fn()
    vi.stubGlobal('document', { querySelector })
    vi.stubGlobal('requestAnimationFrame', vi.fn((next: FrameRequestCallback) => {
      callback = next
      return 1
    }))
    scheduleDomEffect(
      { kind: 'play_land', actor: 0, cardName: 'Forest' },
      'normal',
      'classic',
      0,
      () => {},
      () => false,
    )
    callback!(0)
    expect(querySelector).not.toHaveBeenCalled()
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

  it('tries an exact removed-card anchor before the battlefield fallback', () => {
    const querySelector = vi.fn().mockReturnValue(null)
    const raf = vi.fn((callback: FrameRequestCallback) => callback(0))
    vi.stubGlobal('document', { querySelector })
    vi.stubGlobal('requestAnimationFrame', raf)
    const event: LogEvent = {
      kind: 'ability_mountain_destroy',
      actor: 0,
      target: 1,
      cardName: 'Forest',
      targetInstanceId: 'p1-4',
    }
    scheduleDomEffect(event, 'normal', 'classic', 0)
    expect(querySelector).toHaveBeenNthCalledWith(1, '[data-battlefield-card-id="p1-4"]')
    expect(querySelector).toHaveBeenNthCalledWith(2, '.battlefield-non-active')
  })

  it('keeps a reconstructed Mountain target visible until the effect completes', () => {
    withFakeTimers(() => {
      const appended: FakeEffectElement[] = []
      const animationEnds: Array<() => void> = []
      const createElement = vi.fn(() => new FakeEffectElement(animationEnds))
      vi.stubGlobal('document', {
        body: { appendChild: (element: FakeEffectElement) => appended.push(element) },
        createElement,
        querySelector: vi.fn().mockReturnValue(null),
      })
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      }))
      const done = vi.fn()
      scheduleDomEffect(
        {
          kind: 'ability_mountain_destroy',
          actor: 0,
          target: 1,
          cardName: 'Forest',
          targetInstanceId: 'p1-4',
        },
        'normal',
        'classic',
        0,
        done,
        () => true,
        new Map([['p1-4', { left: 10, top: 20, width: 70, height: 100 }]]),
      )

      const retained = appended.find((element) => element.className === 'dom-effect-retained-target')
      expect(retained?.style.cssText).toContain('left:10px')
      expect(retained?.innerHTML).toContain('Forest')
      expect(retained?.removed).toBe(false)
      animationEnds.forEach((complete) => complete())
      expect(retained?.removed).toBe(true)
      expect(done).toHaveBeenCalledOnce()
    })
  })

  it('clears retained targets with other DOM effects', () => {
    const retained = { remove: vi.fn() }
    vi.stubGlobal('document', {
      querySelectorAll: vi.fn().mockReturnValue([retained]),
    })
    clearDomEffects()
    expect(retained.remove).toHaveBeenCalledOnce()
  })

  it('is a no-op for game_started events', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const event: LogEvent = { kind: 'game_started' }
    scheduleDomEffect(event, 'normal', 'classic')
    expect(raf).not.toHaveBeenCalled()
  })

  class FakeEffectElement {
    className = ''
    style = { cssText: '' }
    innerHTML = ''
    removed = false
    private readonly animationEnds: Array<() => void>

    constructor(animationEnds: Array<() => void>) {
      this.animationEnds = animationEnds
    }

    setAttribute(): void {}

    querySelectorAll(): Array<{ addEventListener: (_name: string, callback: () => void) => void }> {
      if (!this.className.includes('dom-effect--')) {
        return []
      }
      return [{
        addEventListener: (_name, callback) => { this.animationEnds.push(callback) },
      }]
    }

    remove(): void {
      this.removed = true
    }
  }
})
