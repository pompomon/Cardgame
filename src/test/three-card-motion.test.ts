import { describe, expect, it, vi } from 'vitest'
import { CanvasTexture, type Mesh } from 'three'
import { MAX_EFFECT_MS, MAX_QUEUED_EFFECTS } from '../app/animation-settings'
import type { ThreeAssets } from '../renderers/three/assets'
import { boardCardKey, ThreeCardRegistry, type CardDescriptor } from '../renderers/three/card-registry'

function descriptor(cardId: string, instanceId?: string, x = 0): CardDescriptor {
  return {
    hit: { key: boardCardKey(cardId, 0, instanceId), cardId, instanceId, name: 'Forest', owner: 0, zone: instanceId ? 'battlefield' : 'hand', playable: !instanceId },
    style: 'hd', visible: true, target: false, shadows: true, x, y: 0, width: 80, height: 112,
  }
}

function fixture() {
  const release = vi.fn()
  const acquire = vi.fn(() => ({ texture: new CanvasTexture({} as HTMLCanvasElement), release }))
  return { registry: new ThreeCardRegistry({ acquireCard: acquire } as unknown as ThreeAssets), acquire, release }
}

describe('Three retained-card motion', () => {
  it('eases positions and dimensions while picking and anchors follow the displayed geometry', () => {
    const { registry, acquire } = fixture()
    const initial = descriptor('card', 'instance')
    registry.reconcile([initial], 350)
    const card = registry.get(initial.hit.key)!
    const children = [...card.group.children]
    const materials = children.map((child) => (child as Mesh).material)
    expect(registry.animating).toBe(false)
    registry.reconcile([{ ...initial, x: 320, y: 100, width: 120, height: 168 }], 350)
    expect(card.group.position.x).toBe(0)
    expect(registry.animating).toBe(true)
    expect(registry.hitTest({ x: 320, y: 100 })).toBeNull()
    registry.advance(175)
    const anchor = registry.anchorFor('instance')!
    expect(anchor).toMatchObject({ x: 280, y: 87.5, width: 115, height: 161 })
    expect(registry.hitTest({ x: anchor.x + anchor.width / 2 - 1, y: anchor.y })?.instanceId).toBe('instance')
    expect(registry.hitTest({ x: anchor.x + anchor.width / 2 + 1, y: anchor.y })).toBeNull()
    expect((children[2] as Mesh).scale.x).toBe(anchor.width)
    expect((children[3] as Mesh).scale.y).toBe(anchor.height - 2)
    registry.advance(175)
    expect(registry.animating).toBe(false)
    expect(card.group.position.x).toBe(320)
    expect(card.group.children).toEqual(children)
    expect(card.group.children.map((child) => (child as Mesh).material)).toEqual(materials)
    expect(acquire).toHaveBeenCalledOnce()
    registry.dispose()
  })

  it('does not restart unchanged notifications and retargets from the displayed location', () => {
    const { registry } = fixture()
    const initial = descriptor('card', 'instance')
    const target = { ...initial, x: 400 }
    registry.reconcile([initial])
    registry.reconcile([target], 400)
    registry.advance(200)
    const current = registry.anchorFor('instance')!.x
    registry.reconcile([{ ...target, target: true }], 400)
    expect(registry.anchorFor('instance')!.x).toBe(current)
    registry.advance(200)
    expect(registry.animating).toBe(false)
    registry.reconcile([{ ...target, x: -100 }], 300)
    registry.advance(100)
    const retargeted = registry.anchorFor('instance')!.x
    registry.reconcile([{ ...target, x: 200 }], 300)
    expect(registry.anchorFor('instance')!.x).toBe(retargeted)
    registry.advance(300)
    expect(registry.anchorFor('instance')!.x).toBe(200)
    registry.dispose()
  })

  it('caps movement lifetime and ignores non-finite or negative frame deltas', () => {
    const { registry } = fixture()
    const initial = descriptor('card')
    registry.reconcile([initial])
    registry.reconcile([{ ...initial, x: 300 }], 100000)
    for (const delta of [NaN, Infinity, -1]) registry.advance(delta)
    expect(registry.get(initial.hit.key)!.group.position.x).toBe(0)
    registry.advance(MAX_EFFECT_MS - 1)
    expect(registry.animating).toBe(true)
    registry.advance(1)
    expect(registry.animating).toBe(false)
    expect(registry.get(initial.hit.key)!.group.position.x).toBe(300)
    registry.dispose()
  })

  it.each([0, -1, NaN, Infinity])('snaps when movement duration is disabled or invalid (%s)', (duration) => {
    const { registry } = fixture()
    const initial = descriptor('card')
    registry.reconcile([initial])
    registry.reconcile([{ ...initial, x: 200 }], 350)
    registry.advance(50)
    registry.reconcile([{ ...initial, x: 400 }], duration)
    expect(registry.animating).toBe(false)
    expect(registry.get(initial.hit.key)!.group.position.x).toBe(400)
    registry.dispose()
  })

  it('snaps page visibility transitions without reusing a hidden card anchor for its replacement', () => {
    const { registry } = fixture()
    const first = descriptor('first', 'instance-1', 100)
    const other = descriptor('other', 'instance-2', 100)
    registry.reconcile([first, { ...other, visible: false }])
    registry.reconcile([{ ...first, visible: false, x: 0 }, other], 350)
    expect(registry.animating).toBe(false)
    expect(registry.anchorFor('instance-1')).toBeNull()
    expect(registry.anchorFor(undefined, 'first')).toBeNull()
    expect(registry.hitTest({ x: 100, y: 0 })?.instanceId).toBe('instance-2')
    registry.reconcile([other])
    expect(registry.anchorFor('instance-1')).toBeNull()
    expect(registry.pinRemoved('instance-1')).toBeNull()
    registry.reconcile([{ ...first, x: -100 }, { ...other, visible: false }], 350)
    expect(registry.anchorFor('instance-1')?.x).toBe(-100)
    expect(registry.animating).toBe(false)
    registry.dispose()
  })

  it('finishes motion at explicit drag/layout boundaries and clears it for new sessions', () => {
    const { registry } = fixture()
    const initial = descriptor('card', 'instance')
    registry.reconcile([initial])
    registry.reconcile([{ ...initial, x: 200 }], 350)
    registry.advance(20)
    registry.finishMotion()
    registry.finishMotion()
    expect(registry.animating).toBe(false)
    expect(registry.anchorFor('instance')?.x).toBe(200)
    registry.reconcile([{ ...initial, x: -200 }], 350)
    registry.clear()
    registry.advance(350)
    expect(registry.animating).toBe(false)
    expect(registry.anchorFor('instance')).toBeNull()
    registry.reconcile([initial], 350)
    expect(registry.anchorFor('instance')?.x).toBe(0)
    expect(registry.animating).toBe(false)
    registry.dispose()
    registry.finishMotion()
    registry.advance(100)
    expect(registry.animating).toBe(false)
  })

  it('retains mesh and material identity when a physical card crosses zones', () => {
    const { registry, acquire } = fixture()
    const hand = descriptor('card', undefined, -100)
    const battlefield = { ...descriptor('card', 'instance', 200), y: 150 }
    registry.reconcile([hand])
    const card = registry.get(hand.hit.key)!
    registry.reconcile([battlefield], 350)
    expect(registry.get(hand.hit.key)).toBeNull()
    expect(registry.get(battlefield.hit.key)).toBe(card)
    expect(card.group.position.x).toBe(-100)
    expect(registry.anchorFor('instance')?.zone).toBe('battlefield')
    registry.advance(350)
    expect(registry.anchorFor('instance')?.x).toBe(200)
    registry.reconcile([hand], 350)
    expect(registry.get(hand.hit.key)).toBe(card)
    expect(registry.anchorFor('instance')?.x).toBe(200)
    registry.advance(350)
    expect(registry.anchorFor(undefined, 'card')?.x).toBe(-100)
    expect(acquire).toHaveBeenCalledOnce()
    registry.dispose()
  })

  it('starts drag proxies at the displayed card rather than its pending destination', () => {
    const { registry } = fixture()
    const initial = descriptor('card')
    registry.reconcile([initial])
    registry.reconcile([{ ...initial, x: 400 }], 350)
    registry.advance(100)
    const source = registry.get(initial.hit.key)!
    const proxy = registry.createProxy(source)
    expect(proxy.group.position.x).toBe(source.group.position.x)
    expect(proxy.descriptor.x).not.toBe(source.descriptor.x)
    proxy.dispose()
    registry.dispose()
  })

  it('freezes the exact displayed removal anchor and preserves multiple removal pins', () => {
    const { registry } = fixture()
    const initial = descriptor('card', 'instance')
    registry.reconcile([initial])
    registry.reconcile([{ ...initial, x: 300 }], 350)
    registry.advance(100)
    const displayed = registry.anchorFor('instance')!
    registry.reconcile([])
    expect(registry.animating).toBe(false)
    expect(registry.anchorFor('instance')).toEqual(displayed)
    const first = registry.pinRemoved('instance')!
    const second = registry.pinRemoved('instance')!
    expect(first.card.anchor()).toEqual(displayed)
    registry.advance(350)
    expect(first.card.anchor()).toEqual(displayed)
    expect(registry.hitTest(displayed)).toBeNull()
    first.release()
    first.release()
    expect(second.card.group.visible).toBe(true)
    second.release()
    expect(second.card.group.visible).toBe(false)
    registry.dispose()
  })

  it('protects queued Mountain copies and anchors through bounded history eviction', () => {
    const { registry, release } = fixture()
    const target = descriptor('target', 'removed', 123)
    registry.reconcile([target])
    registry.retainRemovedTargets(['removed'])
    registry.reconcile([])
    for (let index = 0; index < 160; index++) registry.reconcile([descriptor(`card-${index}`, `instance-${index}`)])
    expect(registry.retainedCount).toBe(12)
    expect(registry.anchorFor('removed')?.x).toBe(123)
    expect(registry.anchorFor('instance-0')).toBeNull()
    const pin = registry.pinRemoved('removed')!
    expect(pin.card.group.position.x).toBe(123)
    pin.release()
    registry.retainRemovedTargets([])
    registry.reconcile([])
    expect(registry.pinRemoved('removed')).toBeNull()
    registry.dispose()
    expect(release).toHaveBeenCalledTimes(161)
  })

  it('caps reservations to the queue tail and clears all pins and anchors at session reset', () => {
    const { registry } = fixture()
    const targets = Array.from({ length: 20 }, (_, index) => descriptor(`card-${index}`, `instance-${index}`))
    registry.reconcile(targets)
    registry.retainRemovedTargets(targets.map((card) => card.hit.instanceId!))
    registry.reconcile([])
    expect(registry.retainedCount).toBe(12)
    expect(registry.pinRemoved('instance-0')).toBeNull()
    const pins = targets.slice(-(MAX_QUEUED_EFFECTS + 1)).map((card) => registry.pinRemoved(card.hit.instanceId!)!)
    expect(pins.every(Boolean)).toBe(true)
    expect(registry.pinRemoved('instance-14')).toBeNull()
    registry.clear()
    for (const pin of pins) pin.release()
    expect(registry.retainedCount).toBe(0)
    expect(registry.anchorFor('instance-19')).toBeNull()
    registry.dispose()
  })

  it('invalidates old layout slots without discarding live anchors or reserved removal copies', () => {
    const { registry } = fixture()
    const removed = descriptor('removed-card', 'removed', 123)
    const live = descriptor('live-card', 'live', -150)
    registry.reconcile([removed, live])
    registry.retainRemovedTargets(['removed'])
    registry.reconcile([live])
    registry.invalidateHistoricalAnchors()
    expect(registry.anchorFor('removed')).toBeNull()
    expect(registry.anchorFor('live')?.x).toBe(-150)
    const pin = registry.pinRemoved('removed')!
    expect(pin).not.toBeNull()
    pin.release()
    registry.dispose()
  })
})
