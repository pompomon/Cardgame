import { describe, expect, it, vi } from 'vitest'
import type { AppViewModel } from '../app/types'
import type { LogEvent } from '../game/types'
import { CanvasTexture, type Mesh, type MeshBasicMaterial } from 'three'
import { MAX_EFFECT_MS, MAX_QUEUED_EFFECTS } from '../app/animation-settings'
import { visualEffectForEvent, type VisualEffectDescriptor } from '../app/visual-effects'
import { EffectGeometry, EffectVisual, effectRecipe } from '../renderers/three/effect-visual'
import { boardCardKey, EFFECT_RENDER_ORDER, LIFTED_CARD_RENDER_ORDER, ThreeCardRegistry, type CardAnchor } from '../renderers/three/card-registry'
import type { ThreeAssets } from '../renderers/three/assets'
import { ThreeEffects, presentationBoundary } from '../renderers/three/effects'
import { withFakeTimers } from './helpers/timers'

function view(events: LogEvent[] = [], actor = 0): AppViewModel {
  return {
    seed: 1, mode: 'local-hvh', controllers: ['human', 'human'],
    animationSpeed: 'normal', cardVisualStyle: 'hd',
    game: { events, actor },
    replay: { active: false, step: 0 },
  } as unknown as AppViewModel
}

const play: LogEvent = { kind: 'play_land', actor: 0, cardName: 'Forest', sourceInstanceId: 'land-1' }
const mountain: LogEvent = { kind: 'ability_mountain_destroy', actor: 0, target: 1, cardName: 'Forest', sourceInstanceId: 'mountain', targetInstanceId: 'destroyed' }

const recipeEvents: LogEvent[] = [
  play,
  { kind: 'ability_forest_return', actor: 0, cardName: 'Mountain', sourceInstanceId: 'forest', targetCardId: 'returned' },
  { kind: 'ability_swamp_discard', actor: 0, target: 1, cardName: 'Forest', sourceInstanceId: 'swamp', targetCardId: 'discarded' },
  mountain,
  { kind: 'ability_plains_reuse', actor: 0, reusedName: 'Forest', sourceInstanceId: 'plains' },
  { kind: 'counter_resolved', actor: 1, cardName: 'Mountain', discardCardName: 'Swamp' },
]

describe('Three.js event presentation', () => {
  it('holds perspective until the queue drains without altering the real actor', () => {
    let finish!: () => void
    const settled = vi.fn()
    const effects = new ThreeEffects((_effect, _duration, done) => { finish = done; return vi.fn() }, settled)
    expect(effects.update(view(), false)).toBe(0)
    const next = view([play], 1)
    expect(effects.update(next, false)).toBe(0)
    effects.pump()
    expect(next.game!.actor).toBe(1)
    finish()
    finish()
    expect(settled).toHaveBeenCalledOnce()
    expect(effects.update(next, false)).toBe(1)
  })

  it('cancels in-flight effects on hidden/reduced motion and ignores late completion', () => {
    let finish!: () => void
    const cancel = vi.fn()
    const settled = vi.fn()
    const effects = new ThreeEffects((_effect, _duration, done) => { finish = done; return cancel }, settled)
    effects.update(view(), false)
    effects.update(view([play], 1), false)
    effects.pump()
    expect(effects.update(view([play], 1), true)).toBe(1)
    expect(cancel).toHaveBeenCalledOnce()
    finish()
    expect(settled).not.toHaveBeenCalled()
    effects.dispose()
    effects.dispose()
  })

  it('bounds the pending tail and reads speed before each effect', () => {
    const callbacks: Array<() => void> = []
    const playback = vi.fn((_effect, _duration, done) => { callbacks.push(done); return vi.fn() })
    const effects = new ThreeEffects(playback, vi.fn())
    effects.update(view(), false)
    const next = view(Array.from({ length: 20 }, (_, index) => ({ ...play, sourceInstanceId: `${index}` })))
    effects.update(next, false)
    effects.pump()
    expect(playback.mock.calls[0][0].sourceInstanceId).toBe(`${20 - MAX_QUEUED_EFFECTS}`)
    effects.update({ ...next, animationSpeed: 'fast' }, false)
    callbacks.shift()!()
    expect(playback.mock.calls[1][1]).toBe(150)
    while (callbacks.length) callbacks.shift()!()
    expect(playback).toHaveBeenCalledTimes(MAX_QUEUED_EFFECTS)
  })

  it('uses the animation-speed duration for counter cards and skips them when animations are off', () => {
    const counter = recipeEvents[5]
    for (const [speed, duration] of [['fast', 150], ['normal', 350], ['slow', 700]] as const) {
      const playback = vi.fn((_effect, _duration, done) => {
        done()
        return vi.fn()
      })
      const effects = new ThreeEffects(playback, vi.fn())
      effects.update(view(), false)
      effects.update({ ...view([counter]), animationSpeed: speed }, false)
      effects.pump()
      expect(playback).toHaveBeenCalledWith(
        expect.objectContaining({ counterCards: ['Island', 'Swamp'] }),
        duration,
        expect.any(Function),
      )
      effects.dispose()
    }
    const playback = vi.fn()
    const effects = new ThreeEffects(playback, vi.fn())
    effects.update(view(), false)
    effects.update({ ...view([counter]), animationSpeed: 'off' }, false)
    effects.pump()
    expect(playback).not.toHaveBeenCalled()
    effects.dispose()
  })

  it('resets on replay rewind, same-seed replacement, and lobby transitions', () => {
    const prior = view([play])
    expect(presentationBoundary(prior, { ...prior, game: null })).toBe(true)
    expect(presentationBoundary(prior, view([{ ...play, sourceInstanceId: 'other' }]))).toBe(true)
    expect(presentationBoundary(
      { ...prior, replay: { ...prior.replay, active: true, step: 3 } },
      { ...prior, replay: { ...prior.replay, active: true, step: 1 } },
    )).toBe(true)
    expect(presentationBoundary(prior, { ...prior, status: 'new status' })).toBe(false)
  })

  it('keeps AI matches pinned and skips historical playback on mounting', () => {
    const playback = vi.fn()
    const effects = new ThreeEffects(playback, vi.fn())
    const aiView = { ...view([play], 1), controllers: ['human', 'ai'] as AppViewModel['controllers'] }
    expect(effects.update(aiView, false)).toBe(0)
    effects.pump()
    expect(playback).not.toHaveBeenCalled()
  })

  it('reserves current and queued Mountain targets before reconciliation and releases the pending tail on reset', () => {
    const reservations = vi.fn()
    const callbacks: Array<() => void> = []
    const cancellations: Array<ReturnType<typeof vi.fn>> = []
    const effects = new ThreeEffects((_effect, _duration, done) => {
      callbacks.push(done)
      const cancel = vi.fn(done)
      cancellations.push(cancel)
      return cancel
    }, vi.fn(), reservations)
    effects.update(view(), false)
    effects.update(view([mountain]), false)
    expect(reservations).toHaveBeenLastCalledWith(['destroyed'])
    effects.pump()
    const next = [mountain, ...Array.from({ length: 12 }, (_, index) => ({ ...mountain, targetInstanceId: `removed-${index}` }))]
    effects.update(view(next), false)
    expect(reservations).toHaveBeenLastCalledWith(['destroyed', 'removed-8', 'removed-9', 'removed-10', 'removed-11'])
    callbacks[0]()
    expect(reservations).toHaveBeenLastCalledWith(['removed-8', 'removed-9', 'removed-10', 'removed-11'])
    effects.update({ ...view(next), animationSpeed: 'off' }, false)
    expect(reservations).toHaveBeenLastCalledWith([])
    expect(cancellations[1]).toHaveBeenCalledOnce()
    callbacks[1]()
    effects.dispose()
    expect(cancellations[1]).toHaveBeenCalledOnce()
  })

  it('drains synchronous completions exactly once and preserves same-actor presentation', () => {
    const settled = vi.fn()
    const cancel = vi.fn()
    const playback = vi.fn((_effect, _duration, done) => {
      done()
      done()
      return cancel
    })
    const effects = new ThreeEffects(playback, settled)
    effects.update(view(), false)
    expect(effects.update(view([play, mountain], 1), false)).toBe(0)
    effects.pump()
    expect(playback).toHaveBeenCalledTimes(2)
    expect(settled).toHaveBeenCalledOnce()
    expect(effects.update(view([play, mountain], 1), false)).toBe(1)
    effects.dispose()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('cancels a playback returned after a reentrant session reset', () => {
    const cancel = vi.fn()
    const settled = vi.fn()
    const effects = new ThreeEffects(() => {
      effects.dispose()
      return cancel
    }, settled)
    effects.update(view(), false)
    effects.update(view([play], 1), false)
    effects.pump()
    expect(cancel).toHaveBeenCalledOnce()
    effects.dispose()
    expect(cancel).toHaveBeenCalledOnce()
    expect(settled).not.toHaveBeenCalled()
  })

  it('keeps a queued removed Mountain visible at its exact anchor after intervening history eviction', () => withFakeTimers(() => {
    const registry = new ThreeCardRegistry({
      acquireCard: () => ({ texture: new CanvasTexture({} as HTMLCanvasElement), release: vi.fn() }),
    } as unknown as ThreeAssets)
    const card = {
      hit: { key: boardCardKey('target-card', 1, 'destroyed'), cardId: 'target-card', instanceId: 'destroyed', name: 'Forest', owner: 1, zone: 'battlefield' as const, playable: false },
      style: 'hd' as const, visible: true, target: false, shadows: false,
      x: 237, y: 81, width: 100, height: 140,
    }
    registry.reconcile([card])
    const geometry = new EffectGeometry()
    const visuals: EffectVisual[] = []
    const removedCopies: Array<NonNullable<ReturnType<ThreeCardRegistry['pinRemoved']>>> = []
    const actor = { x: -150, y: -100, width: 100, height: 140, owner: 0, zone: 'battlefield' as const }
    const settled = vi.fn()
    const effects = new ThreeEffects((descriptor, duration, done) => {
      const removed = descriptor.kind === 'mountain_destroy' ? registry.pinRemoved(descriptor.targetInstanceId!) : null
      if (removed) removedCopies.push(removed)
      const visual = new EffectVisual(geometry, descriptor, actor, registry.anchorFor(descriptor.targetInstanceId) ?? actor,
        duration, 4, removed, done)
      visuals.push(visual)
      const timer = setTimeout(() => visual.advance(duration), duration)
      return () => { clearTimeout(timer); visual.cancel() }
    }, settled, (ids) => registry.retainRemovedTargets(ids))
    effects.update(view(), false)
    expect(effects.update(view([play, mountain], 1), false)).toBe(0)
    registry.reconcile([])
    effects.pump()
    for (let index = 0; index < 150; index++) registry.reconcile([{
      ...card, hit: { ...card.hit, key: `other-${index}`, cardId: `other-${index}`, instanceId: `other-instance-${index}` },
    }])
    expect(registry.retainedCount).toBe(12)
    expect(removedCopies).toHaveLength(0)
    vi.advanceTimersByTime(350)
    expect(removedCopies).toHaveLength(1)
    const removed = removedCopies[0].card
    expect(removed.group.visible).toBe(true)
    expect(removed.anchor()).toMatchObject({ x: 237, y: 81, owner: 1 })
    expect(visuals[1].group.getObjectByName('mountain-flash')?.position).toMatchObject({ x: 237, y: 81 })
    visuals[1].advance(175)
    expect(removed.group.scale.x).toBeLessThan(1)
    vi.advanceTimersByTime(350)
    expect(removed.group.visible).toBe(false)
    expect(settled).toHaveBeenCalledOnce()
    expect(effects.update(view([play, mountain], 1), false)).toBe(1)
    effects.dispose()
    registry.dispose()
    geometry.dispose()
  }))
})

describe('distinct Three effect recipes', () => {
  const source: CardAnchor = { x: -150, y: 20, width: 100, height: 140, owner: 0, zone: 'battlefield' }
  const target: CardAnchor = { x: 200, y: 180, width: 100, height: 140, owner: 1, zone: 'hand' }

  function create(event: LogEvent, particles = 8, duration = 400, style: VisualEffectDescriptor['visualStyle'] = 'hd') {
    const geometry = new EffectGeometry()
    const descriptor = visualEffectForEvent(event, style)!
    const done = vi.fn()
    const visual = new EffectVisual(geometry, descriptor, source, target, duration, particles, null, done)
    return {
      visual, geometry, done, descriptor,
      mesh: (name: string) => visual.group.getObjectByName(name) as Mesh,
      finish: () => { visual.cancel(); geometry.dispose() },
    }
  }

  it('maps the six shared semantic descriptors to six distinct transform recipes', () => {
    const frames = new Set<string>()
    const recipes = new Set<string | null>()
    for (const event of recipeEvents) {
      const { visual, descriptor, finish } = create(event)
      recipes.add(effectRecipe(descriptor.kind))
      visual.advance(200)
      frames.add(JSON.stringify(visual.group.children.map((child) => ({
        visible: child.visible, position: child.position.toArray(), scale: child.scale.toArray(),
      }))))
      finish()
    }
    expect(recipes.size).toBe(6)
    expect(frames.size).toBe(6)
    expect(effectRecipe('future-effect' as VisualEffectDescriptor['kind'])).toBeNull()
  })

  it('expands paired landing ripples without drawing a cross-board beam', () => {
    const effect = create(play)
    expect(effect.visual.group.renderOrder).toBe(EFFECT_RENDER_ORDER)
    expect(effect.visual.group.renderOrder).toBeGreaterThan(LIFTED_CARD_RENDER_ORDER)
    const ring = effect.mesh('effect-ring')
    const radius = ring.scale.x
    effect.visual.advance(200)
    expect(ring.scale.x).toBeGreaterThan(radius)
    expect(ring.position).toMatchObject({ x: source.x, y: source.y })
    expect(effect.mesh('effect-halo').scale.x).toBeLessThan(ring.scale.x)
    expect(effect.mesh('plains-beam').visible).toBe(false)
    effect.finish()
  })

  it('draws Forest leaves moving inward toward the exact returned-card anchor', () => {
    const effect = create(recipeEvents[1])
    const leaf = effect.mesh('leaves-particle')
    const start = Math.hypot(leaf.position.x - target.x, leaf.position.y - target.y)
    effect.visual.advance(320)
    expect(Math.hypot(leaf.position.x - target.x, leaf.position.y - target.y)).toBeLessThan(start / 4)
    expect(leaf.geometry).toBe(effect.geometry.leaf)
    expect(leaf.scale.y).toBeGreaterThan(leaf.scale.x)
    expect(effect.mesh('effect-ring').position).toMatchObject({ x: target.x, y: target.y })
    effect.finish()
  })

  it('draws Swamp droplets and a spreading target cloud rather than a Forest-style ring', () => {
    const effect = create(recipeEvents[2])
    const cloud = effect.mesh('swamp-cloud')
    const width = cloud.scale.x
    effect.visual.advance(200)
    expect(cloud.position).toMatchObject({ x: target.x, y: target.y })
    expect(cloud.scale.x).toBeGreaterThan(width)
    expect(effect.mesh('miasma-particle').geometry).toBe(effect.geometry.droplet)
    expect(effect.mesh('effect-ring').visible).toBe(false)
    expect(effect.mesh('plains-beam').visible).toBe(false)
    effect.finish()
  })

  it('flares Mountain at the removed target, then spreads embers and fades the flash', () => {
    const effect = create(mountain)
    const flash = effect.mesh('mountain-flash')
    const initialOpacity = (flash.material as MeshBasicMaterial).opacity
    const ember = effect.mesh('embers-particle')
    const start = ember.position.x
    effect.visual.advance(200)
    expect(flash.position).toMatchObject({ x: target.x, y: target.y })
    expect((flash.material as MeshBasicMaterial).opacity).toBeLessThan(initialOpacity)
    expect(ember.position.x).toBeGreaterThan(start)
    effect.finish()
  })

  it('contracts Plains rings while vertical beams converge on the source', () => {
    const effect = create(recipeEvents[4])
    const ring = effect.mesh('effect-ring')
    const radius = ring.scale.x
    const beam = effect.mesh('radiance-particle')
    const height = beam.scale.y
    effect.visual.advance(200)
    expect(ring.scale.x).toBeLessThan(radius)
    expect(effect.mesh('plains-beam').visible).toBe(true)
    expect(beam.scale.y).toBeLessThan(height)
    expect(beam.scale.y).toBeGreaterThan(beam.scale.x)
    effect.finish()
  })

  it('uses Island counter vertices and an outward ripple without inventing a target actor', () => {
    const effect = create(recipeEvents[5])
    const ring = effect.mesh('effect-ring')
    const radius = ring.scale.x
    effect.visual.advance(200)
    expect(ring.scale.x).toBeGreaterThan(radius)
    expect(ring.position).toMatchObject({ x: source.x, y: source.y })
    expect(effect.mesh('counter-particle').geometry).toBe(effect.geometry.vertex)
    expect(effect.descriptor.actor).toBe(1)
    expect(effect.descriptor.targetActor).toBeUndefined()
    effect.finish()
  })

  it('centers non-interactive counter cards and owns them through reanchor and completion', () => {
    const release = vi.fn()
    const acquire = vi.fn((name: string) => ({
      texture: new CanvasTexture({} as HTMLCanvasElement),
      release,
      name,
    }))
    const registry = new ThreeCardRegistry({ acquireCard: acquire } as unknown as ThreeAssets)
    const descriptor = visualEffectForEvent(recipeEvents[5], 'hd')!
    const cards = descriptor.counterCards!.map((name, index) => registry.createPresentation({
      hit: {
        key: boardCardKey(`counter-${index}`, descriptor.actor),
        cardId: `counter-${index}`,
        name,
        owner: descriptor.actor,
        zone: 'battlefield',
        playable: false,
      },
      style: descriptor.visualStyle,
      visible: true,
      target: false,
      shadows: false,
      lifted: true,
      ...source,
    }))
    const geometry = new EffectGeometry()
    const done = vi.fn()
    const visual = new EffectVisual(geometry, descriptor, source, target, 400, 4, null, done, cards)
    expect(acquire.mock.calls.map(([name]) => name)).toEqual(['Island', 'Swamp'])
    expect(registry.size).toBe(0)
    expect(cards[0].group.position.x).toBeLessThan(source.x)
    expect(cards[1].group.position.x).toBeGreaterThan(source.x)
    expect((cards[0].group.position.x + cards[1].group.position.x) / 2).toBe(source.x)
    expect(cards.every((card) => card.group.position.y === source.y)).toBe(true)
    expect(cards.every((card) => registry.hitTest(card.anchor()) === null)).toBe(true)

    const nextSource = { ...source, x: 90, y: -120, width: 80, height: 112 }
    visual.reanchor(nextSource, target)
    expect((cards[0].group.position.x + cards[1].group.position.x) / 2).toBe(nextSource.x)
    expect(cards.every((card) => card.group.position.y === nextSource.y)).toBe(true)
    expect(cards.every((card) => card.anchor().width < nextSource.width)).toBe(true)

    visual.advance(399)
    expect(registry.layer.children).toHaveLength(2)
    visual.advance(1)
    expect(done).toHaveBeenCalledOnce()
    expect(registry.layer.children).toHaveLength(0)
    expect(release).toHaveBeenCalledTimes(2)
    visual.cancel()
    expect(done).toHaveBeenCalledOnce()
    registry.dispose()
    geometry.dispose()
  })

  it('retains all recipe meshes and uses all shared palette colors without per-frame allocations', () => {
    for (const event of recipeEvents) {
      const effect = create(event, 4, 400, 'monochrome')
      const objects = [...effect.visual.group.children]
      const materials = new Set(objects.map((child) => (child as Mesh).material as MeshBasicMaterial))
      const colors = new Set([...materials].map((material) => `#${material.color.getHexString()}`))
      expect(colors).toEqual(new Set(Object.values(effect.descriptor.palette).map((color) => color.toLowerCase())))
      const disposal = [...materials].map((material) => vi.spyOn(material, 'dispose'))
      effect.visual.advance(100)
      effect.visual.advance(100)
      expect(effect.visual.group.children).toEqual(objects)
      effect.visual.advance(200)
      effect.visual.cancel()
      effect.visual.advance(1000)
      expect(effect.done).toHaveBeenCalledOnce()
      expect(effect.visual.group.children).toHaveLength(0)
      for (const dispose of disposal) expect(dispose).toHaveBeenCalledOnce()
      effect.geometry.dispose()
    }
  })

  it('keeps reduced particle counts cosmetic with identical timing and no invalid frame contamination', () => {
    for (const event of recipeEvents) {
      const full = create(event, 1000, 10000)
      const reduced = create(event, 4, 10000)
      expect(full.visual.group.children).toHaveLength(11)
      expect(reduced.visual.group.children).toHaveLength(7)
      for (const effect of [full, reduced]) {
        effect.visual.advance(NaN)
        effect.visual.advance(Infinity)
        effect.visual.advance(-100)
        effect.visual.advance(MAX_EFFECT_MS - 1)
        expect(effect.done).not.toHaveBeenCalled()
        effect.visual.advance(1)
        expect(effect.done).toHaveBeenCalledOnce()
        effect.finish()
      }
    }
  })

  it('reanchors active effects and removed Mountain copies without advancing or draining playback', () => {
    const release = vi.fn()
    const acquire = vi.fn(() => ({ texture: new CanvasTexture({} as HTMLCanvasElement), release }))
    const registry = new ThreeCardRegistry({ acquireCard: acquire } as unknown as ThreeAssets)
    registry.reconcile([{
      hit: { key: boardCardKey('destroyed-card', 1, 'destroyed'), cardId: 'destroyed-card', instanceId: 'destroyed', name: 'Forest', owner: 1, zone: 'battlefield', playable: false },
      style: 'hd', visible: true, target: true, shadows: false,
      ...target,
    }])
    registry.reconcile([])
    const removed = registry.pinRemoved('destroyed')!
    const geometry = new EffectGeometry()
    const done = vi.fn()
    const visual = new EffectVisual(geometry, visualEffectForEvent(mountain, 'hd')!, source, target, 400, 4, removed, done)
    visual.advance(200)
    const body = removed.card.group.children[2] as Mesh
    const materials = removed.card.group.children.map((child) => (child as Mesh).material)
    const opacity = (body.material as MeshBasicMaterial).opacity
    const scale = removed.card.group.scale.x
    const newSource = { ...source, x: -250, y: -150, width: 80, height: 112 }
    const newTarget = { ...target, x: 0, y: 240, width: 80, height: 112 }
    registry.invalidateHistoricalAnchors()
    visual.reanchor(newSource, newTarget)
    expect(done).not.toHaveBeenCalled()
    expect(visual.group.getObjectByName('mountain-flash')?.position).toMatchObject({ x: 0, y: 240 })
    expect(removed.card.group.position).toMatchObject({ x: 0, y: 240 })
    expect(body.scale).toMatchObject({ x: 80, y: 112 })
    expect(removed.card.group.children[1].visible).toBe(false)
    expect((body.material as MeshBasicMaterial).opacity).toBe(opacity)
    expect(removed.card.group.scale.x).toBe(scale)
    expect(registry.hitTest({ x: 0, y: 240 })).toBeNull()
    expect(removed.card.group.children.map((child) => (child as Mesh).material)).toEqual(materials)
    expect(acquire).toHaveBeenCalledOnce()
    visual.reanchor(newSource, newTarget)
    visual.advance(199)
    expect(done).not.toHaveBeenCalled()
    visual.advance(1)
    expect(done).toHaveBeenCalledOnce()
    visual.reanchor(source, target)
    expect(removed.card.group.visible).toBe(false)
    visual.cancel()
    expect(done).toHaveBeenCalledOnce()
    registry.dispose()
    expect(release).toHaveBeenCalledOnce()
    geometry.dispose()
  })

  it('places queued removed copies at the safe fallback supplied after layout history invalidation', () => {
    const registry = new ThreeCardRegistry({
      acquireCard: () => ({ texture: new CanvasTexture({} as HTMLCanvasElement), release: vi.fn() }),
    } as unknown as ThreeAssets)
    registry.reconcile([{
      hit: { key: 'removed', cardId: 'destroyed-card', instanceId: 'destroyed', name: 'Forest', owner: 1, zone: 'battlefield', playable: false },
      style: 'hd', visible: true, target: false, shadows: false, ...target,
    }])
    registry.retainRemovedTargets(['destroyed'])
    registry.reconcile([])
    registry.invalidateHistoricalAnchors()
    const removed = registry.pinRemoved('destroyed')!
    const safeRow = { ...target, x: 0, y: -90, width: 70, height: 98 }
    const geometry = new EffectGeometry()
    const done = vi.fn()
    const visual = new EffectVisual(geometry, visualEffectForEvent(mountain, 'hd')!, source,
      registry.anchorFor('destroyed') ?? safeRow, 350, 4, removed, done)
    expect(removed.card.anchor()).toMatchObject({ x: 0, y: -90, width: 70, height: 98 })
    expect(visual.group.getObjectByName('mountain-flash')?.position).toMatchObject({ x: 0, y: -90 })
    visual.cancel()
    expect(done).toHaveBeenCalledOnce()
    registry.dispose()
    geometry.dispose()
  })

  it.each([0, -1, Infinity, NaN])('finishes invalid or disabled direct effect durations once (%s)', (duration) => {
    const effect = create(play, 4, duration)
    expect(effect.done).toHaveBeenCalledOnce()
    expect(effect.visual.group.children).toHaveLength(0)
    effect.finish()
    expect(effect.done).toHaveBeenCalledOnce()
  })
})
