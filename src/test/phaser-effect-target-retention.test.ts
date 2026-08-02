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
    const setPosition = vi.fn()
    const render = vi.fn(() => ({ destroy, setPosition }))
    const placement = {
      x: 120, y: 80, width: 60, height: 90, playerIndex: 1, cardIndex: 0, cardCount: 1,
    }
    const release = retention.retainMountainTarget(
      mountain(),
      placement,
      placement,
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
    const render = vi.fn(() => ({ destroy: vi.fn(), setPosition: vi.fn() }))
    retention.retainMountainTarget(mountain({ targetCardName: undefined }), undefined, undefined, render)
    retention.retainMountainTarget(mountain(), undefined, undefined, render)
    expect(render).not.toHaveBeenCalled()
  })

  it('deduplicates repeated retention and repositions after a battlefield side change', () => {
    const retention = new EffectTargetRetention()
    const card = { destroy: vi.fn(), setPosition: vi.fn() }
    const render = vi.fn(() => card)
    const placement = {
      x: 1, y: 2, width: 3, height: 4, playerIndex: 1, cardIndex: 0, cardCount: 1,
    }
    const releaseFirst = retention.retainMountainTarget(mountain(), placement, placement, render)
    const releaseSecond = retention.retainMountainTarget(mountain(), placement, placement, render)
    retention.update(() => ({ x: 300, y: 450, width: 60, height: 90 }))

    expect(render).toHaveBeenCalledOnce()
    expect(card.setPosition).toHaveBeenCalledWith(300, 450)
    releaseFirst()
    releaseSecond()
    expect(card.destroy).toHaveBeenCalledOnce()
  })

  it('clears every retained target during lifecycle reset', () => {
    const retention = new EffectTargetRetention()
    const first = { destroy: vi.fn(), setPosition: vi.fn() }
    const second = { destroy: vi.fn(), setPosition: vi.fn() }
    const render = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const firstPlacement = {
      x: 1, y: 2, width: 3, height: 4, playerIndex: 1, cardIndex: 0, cardCount: 1,
    }
    const secondPlacement = {
      ...firstPlacement, playerIndex: 0,
    }
    const releaseFirst = retention.retainMountainTarget(mountain(), firstPlacement, firstPlacement, render)
    const releaseSecond = retention.retainMountainTarget(
      mountain({ targetInstanceId: 'p0-8' }),
      secondPlacement,
      secondPlacement,
      render,
    )
    retention.clear()
    releaseFirst()
    releaseSecond()
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(second.destroy).toHaveBeenCalledOnce()
  })
})
