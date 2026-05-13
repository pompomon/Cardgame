import type Phaser from 'phaser'
import type { CardVisualStyle, AnimationSpeed } from '../../app/types'
import type { LogEvent } from '../../game/types'
import { MAX_EFFECT_MS, MAX_QUEUED_EFFECTS } from '../../app/animation-settings'

// Bounded ability-resolution effect pipeline. Each `LogEvent` that has a
// visual recipe maps to one `EffectDescriptor`; descriptors are queued and
// played one-at-a-time so stacked resolutions remain readable, but the queue
// is bounded (oldest entries are dropped past `MAX_QUEUED_EFFECTS`) so visual
// effects can never block gameplay during AI-vs-AI bursts.

export type EffectKind =
  | 'forest_return'
  | 'swamp_discard'
  | 'mountain_destroy'
  | 'plains_reuse'
  | 'counter_resolved'

export interface EffectDescriptor {
  kind: EffectKind
  actor: number
  cardName?: string
  // Optional anchor — when known, the recipe pulses the matching battlefield
  // card. Otherwise the recipe falls back to a center burst.
  instanceId?: string | null
  visualStyle: CardVisualStyle
}

// Map a structured LogEvent into an EffectDescriptor when there is a visual
// recipe for it. Returns `null` for events that should not animate.
export function effectDescriptorForEvent(
  event: LogEvent,
  visualStyle: CardVisualStyle,
): EffectDescriptor | null {
  switch (event.kind) {
    case 'ability_forest_return':
      return { kind: 'forest_return', actor: event.actor, cardName: event.cardName, visualStyle }
    case 'ability_swamp_discard':
      return { kind: 'swamp_discard', actor: event.actor, cardName: event.cardName, visualStyle }
    case 'ability_mountain_destroy':
      return { kind: 'mountain_destroy', actor: event.actor, cardName: event.cardName, visualStyle }
    case 'ability_plains_reuse':
      return { kind: 'plains_reuse', actor: event.actor, cardName: event.reusedName, visualStyle }
    case 'counter_resolved':
      return { kind: 'counter_resolved', actor: event.actor, cardName: event.cardName, visualStyle }
    default:
      return null
  }
}

const KIND_TINTS: Readonly<Record<EffectKind, number>> = {
  forest_return: 0x7fd194,
  swamp_discard: 0xb694e6,
  mountain_destroy: 0xff7b52,
  plains_reuse: 0xf2dc8b,
  counter_resolved: 0x8ebeff,
}

export interface EffectAnchor {
  x: number
  y: number
  width: number
  height: number
}

// Plays a single effect anchored to the given rectangle. `onDone` is invoked
// after the tween completes — or immediately when `durationMs <= 0` (i.e.
// animations are disabled). Designed to be safe under unit tests: when the
// scene's `tweens` API is absent or `durationMs` is 0, the effect resolves
// synchronously without scheduling any tween.
export function playAbilityEffect(
  scene: Phaser.Scene,
  anchor: EffectAnchor,
  descriptor: EffectDescriptor,
  durationMs: number,
  onDone: () => void,
): void {
  if (durationMs <= 0 || !scene.add || !scene.tweens) {
    onDone()
    return
  }
  const cappedDuration = Math.min(durationMs, MAX_EFFECT_MS)
  const tint = KIND_TINTS[descriptor.kind] ?? 0xffffff
  const ring = scene.add.rectangle(anchor.x, anchor.y, anchor.width, anchor.height, tint, 0)
    .setStrokeStyle(3, tint, 0.85)
  // Rings start small and tight, then expand and fade.
  ring.setScale(0.85)
  ring.setAlpha(0.9)
  scene.tweens.add({
    targets: ring,
    scale: 1.2,
    alpha: 0,
    duration: cappedDuration,
    ease: 'Sine.easeOut',
    onComplete: () => {
      ring.destroy()
      onDone()
    },
  })
}

// In-memory queue + pump used by the Phaser scene. Pure helpers so they can
// be unit-tested with a stub scene.
export interface EffectQueueState {
  queue: EffectDescriptor[]
  playing: boolean
}

export function createEffectQueue(): EffectQueueState {
  return { queue: [], playing: false }
}

export function enqueueEffect(state: EffectQueueState, descriptor: EffectDescriptor): void {
  state.queue.push(descriptor)
  // Drop oldest pending entries past the cap so a long resolution chain
  // (e.g. AI-vs-AI Plains reuse storms) never falls behind gameplay.
  while (state.queue.length > MAX_QUEUED_EFFECTS) {
    state.queue.shift()
  }
}

export function clearEffectQueue(state: EffectQueueState): void {
  state.queue.length = 0
  state.playing = false
}

export interface PumpEffectQueueOptions {
  animationSpeed: AnimationSpeed
  durationMs: number
  // Caller-provided runner: receives the descriptor + duration and a `done`
  // callback. Returning synchronously is OK; pumpEffectQueue will keep
  // draining until the queue is empty.
  run: (descriptor: EffectDescriptor, durationMs: number, done: () => void) => void
}

export function pumpEffectQueue(state: EffectQueueState, options: PumpEffectQueueOptions): void {
  if (options.animationSpeed === 'off') {
    clearEffectQueue(state)
    return
  }
  if (state.playing) {
    return
  }
  const next = state.queue.shift()
  if (!next) {
    return
  }
  state.playing = true
  options.run(next, options.durationMs, () => {
    state.playing = false
    pumpEffectQueue(state, options)
  })
}
