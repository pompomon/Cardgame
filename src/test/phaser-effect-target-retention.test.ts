import { describe, expect, it, vi } from 'vitest'
import type { EffectDescriptor } from '../renderers/phaser/effects'
import { EffectTargetRetention } from '../renderers/phaser/effect-target-retention'

function mountain(overrides: Partial<EffectDescriptor> = {}): EffectDescriptor {
  return {
    kind: 'mountain_destroy',
    actor: 0,
    targetActor: 1,
    land: 'Mountain',
    targetInstanceId: 'p1-4',
    targetCardName: 'Forest',
    visualStyle: 'monochrome',
    palette: { primary: '#aaa', secondary: '#bbb', glow: '#ccc' },
    ...overrides,
  }
}

describe('Phaser effect target retention', () => {
  it('renders at the historical target position until released exactly once', () => {
    const retention = new EffectTargetRetention()
    const destroy = vi.fn()
    const render = vi.fn(() => ({ destroy }))
    const release = retention.retainMountainTarget(
      mountain(),
      new Map([['p1-4', { x: 120, y: 80, width: 60, height: 90 }]]),
      render,
    )

    expect(render).toHaveBeenCalledWith(120, 80, 'Forest', 'monochrome')
    expect(destroy).not.toHaveBeenCalled()
    release()
    release()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('does not retain legacy events or targets without a historical anchor', () => {
    const retention = new EffectTargetRetention()
    const render = vi.fn(() => ({ destroy: vi.fn() }))
    retention.retainMountainTarget(mountain({ targetCardName: undefined }), new Map(), render)
    retention.retainMountainTarget(mountain(), new Map(), render)
    expect(render).not.toHaveBeenCalled()
  })

  it('clears every retained target during lifecycle reset', () => {
    const retention = new EffectTargetRetention()
    const first = { destroy: vi.fn() }
    const second = { destroy: vi.fn() }
    const render = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const positions = new Map([['p1-4', { x: 1, y: 2, width: 3, height: 4 }]])
    const releaseFirst = retention.retainMountainTarget(mountain(), positions, render)
    const releaseSecond = retention.retainMountainTarget(mountain(), positions, render)
    retention.clear()
    releaseFirst()
    releaseSecond()
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(second.destroy).toHaveBeenCalledOnce()
  })
})
