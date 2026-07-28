import { describe, expect, it } from 'vitest'
import {
  clearEffectQueue,
  createEffectQueue,
  effectDescriptorForEvent,
  enqueueEffect,
  playAbilityEffect,
  pumpEffectQueue,
  type EffectDescriptor,
} from '../renderers/phaser/effects'
import { MAX_QUEUED_EFFECTS } from '../app/animation-settings'
import type { LogEvent } from '../game/types'

function descriptor(kind: EffectDescriptor['kind'], actor = 0): EffectDescriptor {
  return {
    kind,
    actor,
    land: 'Forest',
    visualStyle: 'classic',
    palette: { primary: '#b9f1c5', secondary: '#7fd194', glow: '#53a772' },
  }
}

describe('phaser effects queue', () => {
  it('maps ability LogEvents into descriptors and ignores non-ability events', () => {
    const visualStyle = 'classic'
    const cases: Array<{ event: LogEvent; expected: EffectDescriptor['kind'] | null }> = [
      { event: { kind: 'ability_forest_return', actor: 0, cardName: 'Forest' }, expected: 'forest_return' },
      { event: { kind: 'ability_swamp_discard', actor: 0, target: 1, cardName: 'Plains' }, expected: 'swamp_discard' },
      { event: { kind: 'ability_mountain_destroy', actor: 0, target: 1, cardName: 'Island' }, expected: 'mountain_destroy' },
      { event: { kind: 'ability_plains_reuse', actor: 0, reusedName: 'Forest' }, expected: 'plains_reuse' },
      { event: { kind: 'counter_resolved', actor: 1, cardName: 'Forest' }, expected: 'counter_resolved' },
      { event: { kind: 'play_land', actor: 0, cardName: 'Forest' }, expected: 'play_land' },
      { event: { kind: 'turn_start', turn: 1, actor: 0 }, expected: null },
      { event: { kind: 'game_started' }, expected: null },
    ]
    for (const item of cases) {
      const result = effectDescriptorForEvent(item.event, visualStyle)
      expect(result?.kind ?? null).toBe(item.expected)
    }
  })

  it('does not run any effect when animationSpeed is "off"', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return'))
    let runs = 0
    pumpEffectQueue(queue, () => ({
      animationSpeed: 'off',
      durationMs: 0,
      run: () => { runs += 1 },
    }))
    expect(runs).toBe(0)
    expect(queue.queue).toHaveLength(0)
    expect(queue.playing).toBe(false)
  })

  it('drains the queue in FIFO order, one effect at a time', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return', 0))
    enqueueEffect(queue, descriptor('mountain_destroy', 1))
    const runOrder: EffectDescriptor['kind'][] = []
    pumpEffectQueue(queue, () => ({
      animationSpeed: 'normal',
      durationMs: 50,
      run: (desc, _ms, done) => {
        runOrder.push(desc.kind)
        done()
      },
    }))
    expect(runOrder).toEqual(['forest_return', 'mountain_destroy'])
    expect(queue.queue).toHaveLength(0)
    expect(queue.playing).toBe(false)
  })

  it('flips playing state during async runs', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return'))
    let captured: (() => void) | null = null
    pumpEffectQueue(queue, () => ({
      animationSpeed: 'normal',
      durationMs: 50,
      run: (_desc, _ms, done) => { captured = done },
    }))
    expect(queue.playing).toBe(true)
    expect(typeof captured).toBe('function')
    captured!()
    expect(queue.playing).toBe(false)
  })

  it('drops oldest pending entries past MAX_QUEUED_EFFECTS', () => {
    const queue = createEffectQueue()
    for (let i = 0; i < MAX_QUEUED_EFFECTS + 3; i += 1) {
      enqueueEffect(queue, descriptor('plains_reuse', i % 2))
    }
    expect(queue.queue).toHaveLength(MAX_QUEUED_EFFECTS)
  })

  it('clears pending entries via clearEffectQueue but leaves an in-flight effect alone', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return'))
    queue.playing = true
    clearEffectQueue(queue)
    expect(queue.queue).toHaveLength(0)
    // `playing` must stay true so a follow-up pump can't start a second
    // effect concurrently with a tween that is still in flight.
    expect(queue.playing).toBe(true)
  })

  it('does not start a new effect after clearEffectQueue while one is in flight', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return'))
    queue.playing = true
    clearEffectQueue(queue)
    enqueueEffect(queue, descriptor('mountain_destroy'))
    let runs = 0
    pumpEffectQueue(queue, () => ({
      animationSpeed: 'normal',
      durationMs: 50,
      run: () => { runs += 1 },
    }))
    expect(runs).toBe(0)
    expect(queue.queue).toHaveLength(1)
  })

  it('reads fresh animationSpeed/duration from the options getter on every drain', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return'))
    enqueueEffect(queue, descriptor('mountain_destroy'))
    enqueueEffect(queue, descriptor('plains_reuse'))
    const seen: Array<{ speed: string; ms: number }> = []
    let speed: 'normal' | 'fast' | 'off' = 'normal'
    let ms = 100
    pumpEffectQueue(queue, () => ({
      animationSpeed: speed,
      durationMs: ms,
      run: (_desc, durationMs, done) => {
        seen.push({ speed, ms: durationMs })
        // Mid-queue: tighten the animation speed before draining the next one.
        speed = 'fast'
        ms = 25
        done()
      },
    }))
    expect(seen).toEqual([
      { speed: 'normal', ms: 100 },
      { speed: 'fast', ms: 25 },
      { speed: 'fast', ms: 25 },
    ])
  })

  it('aborts mid-drain when the options getter switches to "off"', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return'))
    enqueueEffect(queue, descriptor('mountain_destroy'))
    enqueueEffect(queue, descriptor('plains_reuse'))
    let speed: 'normal' | 'off' = 'normal'
    let runs = 0
    pumpEffectQueue(queue, () => ({
      animationSpeed: speed,
      durationMs: 50,
      run: (_desc, _ms, done) => {
        runs += 1
        speed = 'off'
        done()
      },
    }))
    expect(runs).toBe(1)
    expect(queue.queue).toHaveLength(0)
  })
})

// Minimal stub Phaser scene that satisfies playAbilityEffect's guards.
// When durationMs = 0, playAbilityEffect must call onDone() synchronously
// for all 6 kinds without touching .add or .tweens.
const stubScene = {} as unknown as import('phaser').Scene

describe('playAbilityEffect', () => {
  const allKinds: EffectDescriptor['kind'][] = [
    'play_land',
    'forest_return',
    'swamp_discard',
    'mountain_destroy',
    'plains_reuse',
    'counter_resolved',
  ]
  const anchor = { x: 100, y: 100, width: 80, height: 60 }

  for (const kind of allKinds) {
    it(`calls onDone synchronously for kind="${kind}" when durationMs=0`, () => {
      let called = 0
      playAbilityEffect(
        stubScene,
        anchor,
        descriptor(kind),
        0,
        () => { called += 1 },
      )
      expect(called).toBe(1)
    })
  }

  it('uses fewer particles in the reduced mobile quality tier', () => {
    let rectangles = 0
    const scene = {
      add: {
        rectangle: (x: number, y: number) => {
          rectangles += 1
          return {
            x,
            y,
            setStrokeStyle() { return this },
            setScale() { return this },
            setAlpha() { return this },
            setDepth() { return this },
            setRotation() { return this },
            destroy() {},
          }
        },
      },
      tweens: {
        add: (config: { onComplete?: () => void }) => {
          config.onComplete?.()
          return {}
        },
      },
    } as unknown as import('phaser').Scene
    let completed = 0
    playAbilityEffect(scene, anchor, descriptor('play_land'), 100, () => { completed += 1 }, 'reduced')
    expect(rectangles).toBe(2)
    expect(completed).toBe(1)
  })
})
