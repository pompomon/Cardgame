import { describe, expect, it, vi } from 'vitest'
import { CanvasTexture } from 'three'
import type { ThreeAssets } from '../renderers/three/assets'
import { boardCardKey, ThreeCardRegistry, type CardDescriptor } from '../renderers/three/card-registry'
import { EffectGeometry, EffectVisual, effectRecipe } from '../renderers/three/effect-visual'
import type { VisualEffectDescriptor } from '../app/visual-effects'
import { ThreeBoard } from '../renderers/three/board'

function descriptor(cardId: string, instanceId?: string, x = 100): CardDescriptor {
  return {
    hit: { key: boardCardKey(cardId, 0, instanceId), cardId, instanceId, name: 'Mountain', owner: 0, zone: instanceId ? 'battlefield' : 'hand', playable: !instanceId },
    style: 'hd', visible: true, target: false, shadows: true, x, y: 30, width: 100, height: 140,
  }
}

function fixture(): { registry: ThreeCardRegistry; acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  const release = vi.fn()
  const acquire = vi.fn(() => ({ texture: new CanvasTexture({} as HTMLCanvasElement), release }))
  return { registry: new ThreeCardRegistry({ acquireCard: acquire } as unknown as ThreeAssets), acquire, release }
}

describe('retained Three.js card registry', () => {
  it('reuses the same mesh and face texture across unchanged notifications', () => {
    const { registry, acquire, release } = fixture()
    const card = descriptor('a', 'a:1')
    registry.reconcile([card])
    const before = registry.get(card.hit.key)
    registry.reconcile([{ ...card, x: 250, target: true }])
    expect(registry.get(card.hit.key)).toBe(before)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(before?.group.position.x).toBe(250)
    registry.dispose()
    registry.dispose()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('distinguishes same-name cards and different instances of the same card', () => {
    const { registry } = fixture()
    const first = descriptor('same-card', 'instance-1', 50)
    const second = descriptor('other-card', 'instance-2', 200)
    registry.reconcile([first, second])
    const old = registry.get(first.hit.key)
    const returned = descriptor('same-card', 'instance-3', -90)
    registry.reconcile([returned, second])
    expect(registry.get(returned.hit.key)).not.toBe(old)
    expect(registry.anchorFor('instance-1')?.x).toBe(50)
    expect(registry.anchorFor('instance-3')?.x).toBe(-90)
    expect(registry.anchorFor('unknown', 'same-card')).toBeNull()
    expect(registry.anchorFor(undefined, 'same-card')?.x).toBe(-90)
    registry.dispose()
  })

  it('makes hidden pages and removed cards inert but keeps exact removal anchors', () => {
    const { registry } = fixture()
    const first = descriptor('a', 'i')
    registry.reconcile([first])
    expect(registry.hitTest({ x: 100, y: 30 })?.instanceId).toBe('i')
    registry.reconcile([{ ...first, visible: false, x: 0 }])
    expect(registry.hitTest({ x: 100, y: 30 })).toBeNull()
    expect(registry.anchorFor('i')?.x).toBe(100)
    registry.reconcile([])
    const pin = registry.pinRemoved('i')
    expect(pin?.card.group.visible).toBe(true)
    expect(registry.hitTest({ x: 100, y: 30 })).toBeNull()
    pin?.release()
    pin?.release()
    expect(pin?.card.group.visible).toBe(false)
    registry.dispose()
  })

  it('bounds inert history and releases evicted cards', () => {
    const { registry, release } = fixture()
    for (let index = 0; index < 160; index++) registry.reconcile([descriptor(`card${index}`, `i${index}`)])
    registry.reconcile([])
    expect(registry.size).toBe(0)
    expect(registry.retainedCount).toBe(12)
    expect(registry.anchorFor('i0')).toBeNull()
    expect(release).toHaveBeenCalledTimes(148)
    registry.dispose()
    expect(release).toHaveBeenCalledTimes(160)
  })

  it('creates a separate lifted proxy while leaving the original mesh intact', () => {
    const { registry, release } = fixture()
    const card = descriptor('a')
    registry.reconcile([card])
    const source = registry.get(card.hit.key)!
    const proxy = registry.createProxy(source)
    expect(proxy.group.position.z).toBeGreaterThan(source.group.position.z)
    expect(source.group.position.x).toBe(100)
    proxy.dispose()
    proxy.dispose()
    registry.dispose()
    expect(release).toHaveBeenCalledTimes(2)
  })
})

describe('bounded cosmetic Three.js effects', () => {
  it('targets the opponent hand for Swamp without using a stale card anchor', () => {
    const historical = { x: 300, y: 30, width: 100, height: 140, owner: 0, zone: 'hand' as const }
    const opponentHand = { ...historical, x: 0, y: 400, owner: 1 }
    const anchorFor = vi.fn(() => historical)
    const actorAnchor = vi.fn(() => opponentHand)
    const board = Object.assign(Object.create(ThreeBoard.prototype), {
      actorAnchor,
      cards: { anchorFor },
    }) as unknown as {
      effectTargetAnchor(effect: VisualEffectDescriptor): typeof opponentHand
    }
    const target = board.effectTargetAnchor({
      kind: 'swamp_discard', actor: 0, targetActor: 1, targetCardId: 'discarded',
      land: 'Swamp', visualStyle: 'classic',
      palette: { primary: '#000', secondary: '#111', glow: '#222' },
    })
    expect(target).toBe(opponentHand)
    expect(actorAnchor).toHaveBeenCalledWith(1, true)
    expect(anchorFor).not.toHaveBeenCalled()

    expect(board.effectTargetAnchor({
      kind: 'forest_return', actor: 0, targetCardId: 'returned',
      land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#000', secondary: '#111', glow: '#222' },
    })).toBe(historical)
    expect(anchorFor).toHaveBeenCalledWith(undefined, 'returned')
  })

  it('animates the exact removed Mountain target and completes cancellation only once', () => {
    const { registry } = fixture()
    registry.reconcile([descriptor('destroyed', 'removed', 123)])
    registry.reconcile([])
    const removed = registry.pinRemoved('removed')!
    const geometry = new EffectGeometry()
    const done = vi.fn()
    const anchor = registry.anchorFor('removed')!
    const effect: VisualEffectDescriptor = {
      kind: 'mountain_destroy', actor: 0, land: 'Mountain', visualStyle: 'hd',
      targetInstanceId: 'removed', palette: { primary: '#ff8800', secondary: '#a30000', glow: '#ffcc66' },
    }
    const visual = new EffectVisual(geometry, effect, { ...anchor, x: -50 }, anchor, 300, 8, removed, done)
    const objects = [...visual.group.children]
    visual.advance(150)
    expect(removed.card.group.scale.x).toBeLessThan(1)
    expect(visual.group.children).toEqual(objects)
    visual.cancel()
    visual.cancel()
    visual.advance(1000)
    expect(done).toHaveBeenCalledTimes(1)
    expect(removed.card.group.visible).toBe(false)
    registry.dispose()
    geometry.dispose()
  })

  describe('Three.js board visibility', () => {
    it('does not repeat visibility work when the value is unchanged', () => {
      const visibilityChanged = vi.fn()
      const resize = vi.fn()
      const stage = { hidden: false }
      const board = Object.assign(Object.create(ThreeBoard.prototype), {
        disposed: false,
        visible: true,
        stage,
        visibilityChanged,
        resize,
      }) as unknown as ThreeBoard

      board.setVisible(true)
      expect(visibilityChanged).not.toHaveBeenCalled()
      expect(resize).not.toHaveBeenCalled()

      board.setVisible(false)
      expect(stage.hidden).toBe(true)
      expect(visibilityChanged).toHaveBeenCalledOnce()
      expect(resize).not.toHaveBeenCalled()

      board.setVisible(true)
      expect(stage.hidden).toBe(false)
      expect(visibilityChanged).toHaveBeenCalledTimes(2)
      expect(resize).toHaveBeenCalledOnce()
      board.setVisible(true)
      expect(resize).toHaveBeenCalledOnce()
    })
  })

  it('finishes long caller durations within the bounded lifetime and rejects unknown kinds', () => {
    const geometry = new EffectGeometry()
    const done = vi.fn()
    const anchor = { x: 0, y: 0, width: 100, height: 140, owner: 0, zone: 'battlefield' as const }
    const effect: VisualEffectDescriptor = {
      kind: 'plains_reuse', actor: 0, land: 'Plains', visualStyle: 'classic',
      palette: { primary: '#ffffff', secondary: '#cccccc', glow: '#eeeeee' },
    }
    const visual = new EffectVisual(geometry, effect, anchor, anchor, 100000, 200, null, done)
    expect(visual.group.children).toHaveLength(10)
    visual.advance(1500)
    expect(done).toHaveBeenCalledTimes(1)
    expect(effectRecipe('unknown' as VisualEffectDescriptor['kind'])).toBeNull()
    geometry.dispose()
  })
})
