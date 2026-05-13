import { describe, expect, it } from 'vitest'
import {
  clearEffectQueue,
  createEffectQueue,
  effectDescriptorForEvent,
  enqueueEffect,
  pumpEffectQueue,
  type EffectDescriptor,
} from '../renderers/phaser/effects'
import { MAX_QUEUED_EFFECTS } from '../app/animation-settings'
import type { LogEvent } from '../game/types'

function descriptor(kind: EffectDescriptor['kind'], actor = 0): EffectDescriptor {
  return { kind, actor, cardName: 'Forest', visualStyle: 'classic' }
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
      { event: { kind: 'play_land', actor: 0, cardName: 'Forest' }, expected: null },
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
    pumpEffectQueue(queue, {
      animationSpeed: 'off',
      durationMs: 0,
      run: () => { runs += 1 },
    })
    expect(runs).toBe(0)
    expect(queue.queue).toHaveLength(0)
    expect(queue.playing).toBe(false)
  })

  it('drains the queue in FIFO order, one effect at a time', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return', 0))
    enqueueEffect(queue, descriptor('mountain_destroy', 1))
    const runOrder: EffectDescriptor['kind'][] = []
    pumpEffectQueue(queue, {
      animationSpeed: 'normal',
      durationMs: 50,
      run: (desc, _ms, done) => {
        runOrder.push(desc.kind)
        done()
      },
    })
    expect(runOrder).toEqual(['forest_return', 'mountain_destroy'])
    expect(queue.queue).toHaveLength(0)
    expect(queue.playing).toBe(false)
  })

  it('flips playing state during async runs', () => {
    const queue = createEffectQueue()
    enqueueEffect(queue, descriptor('forest_return'))
    let captured: (() => void) | null = null
    pumpEffectQueue(queue, {
      animationSpeed: 'normal',
      durationMs: 50,
      run: (_desc, _ms, done) => { captured = done },
    })
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
    pumpEffectQueue(queue, {
      animationSpeed: 'normal',
      durationMs: 50,
      run: () => { runs += 1 },
    })
    expect(runs).toBe(0)
    expect(queue.queue).toHaveLength(1)
  })
})
