import type Phaser from 'phaser'
import type { AnimationSpeed } from '../../app/types'
import type { LogEvent } from '../../game/types'
import { MAX_EFFECT_MS, MAX_QUEUED_EFFECTS } from '../../app/animation-settings'
import {
  visualEffectForEvent,
  type VisualEffectDescriptor,
  type VisualEffectKind,
} from '../../app/visual-effects'
import { DEPTH_EFFECT_OVERLAY } from './depth'
import type { BattlefieldCardPlacement } from './effect-anchoring'

// Bounded ability-resolution effect pipeline. Each `LogEvent` that has a
// visual recipe maps to one `EffectDescriptor`; descriptors are queued and
// played one-at-a-time so stacked resolutions remain readable, but the queue
// is bounded (oldest entries are dropped past `MAX_QUEUED_EFFECTS`) so visual
// effects can never block gameplay during AI-vs-AI bursts.

export type EffectKind = VisualEffectKind

export interface EffectAnchor {
  x: number
  y: number
  width: number
  height: number
}

export interface EffectDescriptor extends VisualEffectDescriptor {
  // When provided by the caller (e.g. Phaser card-position registry lookup),
  // supersedes the generic battlefield-row anchor passed to playAbilityEffect.
  anchorOverride?: EffectAnchor
  sourceAnchor?: EffectAnchor
  sourcePlacement?: BattlefieldCardPlacement
  targetPlacement?: BattlefieldCardPlacement
}

export type EffectQuality = 'full' | 'reduced'

// Map a structured LogEvent into an EffectDescriptor when there is a visual
// recipe for it. Returns `null` for events that should not animate.
export function effectDescriptorForEvent(
  event: LogEvent,
  visualStyle: EffectDescriptor['visualStyle'],
): EffectDescriptor | null {
  return visualEffectForEvent(event, visualStyle)
}

function colorToNumber(value: string, fallback: number): number {
  return /^#[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value.slice(1), 16) : fallback
}

// ---------------------------------------------------------------------------
// Per-kind recipe helpers. Each creates particle GameObjects, tweens them, and
// calls onDone() exactly once when the last tween completes. All particle
// objects are added directly to the scene at DEPTH_EFFECT_OVERLAY so they
// outlive the clearRoot() call that removes rootContainer children.
// ---------------------------------------------------------------------------

function makeCounter(total: number, onDone: () => void): () => void {
  let remaining = total
  return () => {
    remaining -= 1
    if (remaining <= 0) {
      onDone()
    }
  }
}

function recipeLinkTrail(
  scene: Phaser.Scene,
  source: EffectAnchor,
  target: EffectAnchor,
  tint: number,
  cappedDuration: number,
  onDone: () => void,
): void {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const distance = Math.hypot(dx, dy)
  if (distance < 4) {
    onDone()
    return
  }
  const trail = scene.add.rectangle(
    source.x + dx / 2,
    source.y + dy / 2,
    distance,
    4,
    tint,
    0.72,
  )
  trail.setRotation(Math.atan2(dy, dx))
  trail.setScale(0.15, 1)
  trail.setDepth(DEPTH_EFFECT_OVERLAY)
  scene.tweens.add({
    targets: trail,
    scaleX: 1,
    alpha: 0,
    duration: Math.max(1, Math.floor(cappedDuration * 0.7)),
    ease: 'Sine.easeOut',
    onComplete: () => { trail.destroy(); onDone() },
  })
}

function recipePlayLand(
  scene: Phaser.Scene,
  anchor: EffectAnchor,
  tint: number,
  cappedDuration: number,
  quality: EffectQuality,
  onDone: () => void,
): void {
  // 3 concentric rings expanding outward — land-enters-play ripple.
  const ringCount = quality === 'reduced' ? 2 : 3
  const tick = makeCounter(ringCount, onDone)
  for (let i = 0; i < ringCount; i += 1) {
    const startScale = 0.55 + i * 0.15
    const strokeAlpha = 0.9 - i * 0.22
    const ring = scene.add.rectangle(anchor.x, anchor.y, anchor.width, anchor.height, tint, 0)
      .setStrokeStyle(3 - i, tint, strokeAlpha)
    ring.setScale(startScale)
    ring.setAlpha(0.85 - i * 0.15)
    ring.setDepth(DEPTH_EFFECT_OVERLAY)
    scene.tweens.add({
      targets: ring,
      scale: 1.65,
      alpha: 0,
      duration: cappedDuration,
      delay: i * Math.floor(cappedDuration * 0.12),
      ease: 'Quad.easeOut',
      onComplete: () => { ring.destroy(); tick() },
    })
  }
}

function recipeForestReturn(
  scene: Phaser.Scene,
  anchor: EffectAnchor,
  tint: number,
  cappedDuration: number,
  quality: EffectQuality,
  onDone: () => void,
): void {
  // 5 leaf particles orbiting inward + a contracting ring.
  const leafCount = quality === 'reduced' ? 3 : 5
  const tick = makeCounter(leafCount + 1, onDone)
  // Contracting ring
  const ring = scene.add.rectangle(anchor.x, anchor.y, anchor.width, anchor.height, tint, 0)
    .setStrokeStyle(2, tint, 0.75)
  ring.setScale(1.25)
  ring.setDepth(DEPTH_EFFECT_OVERLAY)
  scene.tweens.add({
    targets: ring,
    scale: 0.55,
    alpha: 0,
    duration: cappedDuration,
    ease: 'Sine.easeIn',
    onComplete: () => { ring.destroy(); tick() },
  })
  // Leaf particles start at orbit radius and converge toward anchor center
  const rx = anchor.width * 0.38
  const ry = anchor.height * 0.45
  for (let i = 0; i < leafCount; i += 1) {
    const angle = (Math.PI * 2 * i) / leafCount
    const leaf = scene.add.rectangle(
      anchor.x + Math.cos(angle) * rx,
      anchor.y + Math.sin(angle) * ry,
      6, 9, tint, 0.85,
    )
    leaf.setRotation(angle)
    leaf.setDepth(DEPTH_EFFECT_OVERLAY)
    scene.tweens.add({
      targets: leaf,
      x: anchor.x,
      y: anchor.y,
      alpha: 0,
      duration: cappedDuration,
      delay: i * Math.floor(cappedDuration * 0.06),
      ease: 'Sine.easeIn',
      onComplete: () => { leaf.destroy(); tick() },
    })
  }
}

function recipeSwampDiscard(
  scene: Phaser.Scene,
  anchor: EffectAnchor,
  tint: number,
  cappedDuration: number,
  quality: EffectQuality,
  onDone: () => void,
): void {
  // 4 droplets floating upward + a fading cloud base.
  const dropletCount = quality === 'reduced' ? 2 : 4
  const tick = makeCounter(dropletCount + 1, onDone)
  // Cloud base
  const cloud = scene.add.rectangle(anchor.x, anchor.y, anchor.width * 0.88, anchor.height * 0.88, tint, 0.18)
    .setStrokeStyle(1, tint, 0.28)
  cloud.setDepth(DEPTH_EFFECT_OVERLAY)
  scene.tweens.add({
    targets: cloud,
    alpha: 0,
    scaleX: 1.12,
    scaleY: 1.12,
    duration: Math.floor(cappedDuration * 0.55),
    ease: 'Sine.easeOut',
    onComplete: () => { cloud.destroy(); tick() },
  })
  // Droplets rise from slight vertical offset, spreading horizontally
  const floatY = anchor.height * 0.42
  const spread = anchor.width * 0.34
  for (let i = 0; i < dropletCount; i += 1) {
    const xOffset = dropletCount > 1
      ? (i - (dropletCount - 1) / 2) * (spread / (dropletCount - 1))
      : 0
    const droplet = scene.add.rectangle(
      anchor.x + xOffset,
      anchor.y + anchor.height * 0.1,
      6, 8, tint, 0.82,
    )
    droplet.setDepth(DEPTH_EFFECT_OVERLAY)
    scene.tweens.add({
      targets: droplet,
      y: droplet.y - floatY,
      alpha: 0,
      duration: cappedDuration,
      delay: i * Math.floor(cappedDuration * 0.07),
      ease: 'Sine.easeOut',
      onComplete: () => { droplet.destroy(); tick() },
    })
  }
}

function recipeMountainDestroy(
  scene: Phaser.Scene,
  anchor: EffectAnchor,
  tint: number,
  cappedDuration: number,
  quality: EffectQuality,
  onDone: () => void,
): void {
  // 6 embers sprayed upward in 140° arc + white flash + expanding ring.
  const emberCount = quality === 'reduced' ? 3 : 6
  const tick = makeCounter(emberCount + 2, onDone)
  // White flash
  const flash = scene.add.rectangle(anchor.x, anchor.y, anchor.width * 0.9, anchor.height * 0.9, 0xffffff, 0.44)
  flash.setDepth(DEPTH_EFFECT_OVERLAY)
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration: Math.floor(cappedDuration * 0.28),
    ease: 'Power2',
    onComplete: () => { flash.destroy(); tick() },
  })
  // Ring
  const ring = scene.add.rectangle(anchor.x, anchor.y, anchor.width * 0.9, anchor.height * 0.9, tint, 0)
    .setStrokeStyle(2, tint, 0.82)
  ring.setScale(0.72)
  ring.setDepth(DEPTH_EFFECT_OVERLAY)
  scene.tweens.add({
    targets: ring,
    scale: 1.42,
    alpha: 0,
    duration: cappedDuration,
    ease: 'Sine.easeOut',
    onComplete: () => { ring.destroy(); tick() },
  })
  // Embers: upward 140° arc
  const arcCenter = -Math.PI / 2
  const halfArc = (140 * Math.PI) / 360
  const travelR = anchor.height * 0.56
  for (let i = 0; i < emberCount; i += 1) {
    const angle = emberCount > 1
      ? arcCenter - halfArc + (i * halfArc * 2) / (emberCount - 1)
      : arcCenter
    const ember = scene.add.rectangle(anchor.x, anchor.y, 5, 5, tint, 0.92)
    ember.setDepth(DEPTH_EFFECT_OVERLAY)
    scene.tweens.add({
      targets: ember,
      x: anchor.x + Math.cos(angle) * travelR * (anchor.width / Math.max(1, anchor.height)),
      y: anchor.y + Math.sin(angle) * travelR,
      alpha: 0,
      duration: cappedDuration,
      delay: i * Math.floor(cappedDuration * 0.04),
      ease: 'Quad.easeOut',
      onComplete: () => { ember.destroy(); tick() },
    })
  }
}

function recipePlainsReuse(
  scene: Phaser.Scene,
  anchor: EffectAnchor,
  tint: number,
  cappedDuration: number,
  quality: EffectQuality,
  onDone: () => void,
): void {
  // 5 beams radiating outward + a contracting golden ring.
  const beamCount = quality === 'reduced' ? 3 : 5
  const tick = makeCounter(beamCount + 1, onDone)
  // Contracting ring
  const ring = scene.add.rectangle(anchor.x, anchor.y, anchor.width, anchor.height, tint, 0)
    .setStrokeStyle(2, tint, 0.85)
  ring.setScale(1.42)
  ring.setDepth(DEPTH_EFFECT_OVERLAY)
  scene.tweens.add({
    targets: ring,
    scale: 0.58,
    alpha: 0,
    duration: cappedDuration,
    ease: 'Sine.easeIn',
    onComplete: () => { ring.destroy(); tick() },
  })
  // Beams radiate outward from anchor center
  const beamLength = anchor.height * 0.55
  for (let i = 0; i < beamCount; i += 1) {
    const angle = (Math.PI * 2 * i) / beamCount
    const beam = scene.add.rectangle(
      anchor.x,
      anchor.y,
      3,
      Math.max(8, Math.floor(beamLength * 0.35)),
      tint, 0.92,
    )
    beam.setRotation(angle)
    beam.setDepth(DEPTH_EFFECT_OVERLAY)
    scene.tweens.add({
      targets: beam,
      x: anchor.x + Math.cos(angle) * beamLength,
      y: anchor.y + Math.sin(angle) * beamLength,
      scaleY: 1.85,
      alpha: 0,
      duration: cappedDuration,
      delay: i * Math.floor(cappedDuration * 0.06),
      ease: 'Sine.easeOut',
      onComplete: () => { beam.destroy(); tick() },
    })
  }
}

function recipeCounterResolved(
  scene: Phaser.Scene,
  anchor: EffectAnchor,
  tint: number,
  cappedDuration: number,
  quality: EffectQuality,
  onDone: () => void,
): void {
  // 6 hexagon-vertex particles expanding + a blue ripple ring.
  const vertexCount = quality === 'reduced' ? 3 : 6
  const tick = makeCounter(vertexCount + 1, onDone)
  // Ripple ring
  const ring = scene.add.rectangle(anchor.x, anchor.y, anchor.width * 0.9, anchor.height * 0.9, tint, 0)
    .setStrokeStyle(2, tint, 0.78)
  ring.setScale(0.82)
  ring.setDepth(DEPTH_EFFECT_OVERLAY)
  scene.tweens.add({
    targets: ring,
    scale: 1.62,
    alpha: 0,
    duration: cappedDuration,
    ease: 'Sine.easeOut',
    onComplete: () => { ring.destroy(); tick() },
  })
  // Vertex particles: start halfway out, expand to full hex radius
  const hexR = anchor.height * 0.44
  for (let i = 0; i < vertexCount; i += 1) {
    const angle = (Math.PI * 2 * i) / vertexCount
    const vertex = scene.add.rectangle(
      anchor.x + Math.cos(angle) * hexR * 0.48,
      anchor.y + Math.sin(angle) * hexR * 0.48,
      7, 7, tint, 0.92,
    )
    vertex.setDepth(DEPTH_EFFECT_OVERLAY)
    scene.tweens.add({
      targets: vertex,
      x: anchor.x + Math.cos(angle) * hexR,
      y: anchor.y + Math.sin(angle) * hexR,
      scale: 1.6,
      alpha: 0,
      duration: cappedDuration,
      delay: i * Math.floor(cappedDuration * 0.05),
      ease: 'Quad.easeOut',
      onComplete: () => { vertex.destroy(); tick() },
    })
  }
}

// Plays a single effect anchored to the given rectangle. `onDone` is invoked
// after all tweens complete — or immediately when `durationMs <= 0` (i.e.
// animations are disabled). Designed to be safe under unit tests: when the
// scene's `tweens` API is absent or `durationMs` is 0, the effect resolves
// synchronously without scheduling any tween.
export function playAbilityEffect(
  scene: Phaser.Scene,
  anchor: EffectAnchor,
  descriptor: EffectDescriptor,
  durationMs: number,
  onDone: () => void,
  quality: EffectQuality = 'full',
): void {
  if (durationMs <= 0 || !scene.add || !scene.tweens) {
    onDone()
    return
  }
  const effectAnchor = descriptor.anchorOverride ?? anchor
  const cappedDuration = Math.min(durationMs, MAX_EFFECT_MS)
  const tint = colorToNumber(descriptor.palette.secondary, 0xffffff)
  const hasLink = descriptor.sourceAnchor !== undefined
    && (descriptor.sourceAnchor.x !== effectAnchor.x || descriptor.sourceAnchor.y !== effectAnchor.y)
  const finish = hasLink ? makeCounter(2, onDone) : onDone
  if (hasLink) {
    recipeLinkTrail(scene, descriptor.sourceAnchor!, effectAnchor, tint, cappedDuration, finish)
  }
  switch (descriptor.kind) {
    case 'play_land':
      recipePlayLand(scene, effectAnchor, tint, cappedDuration, quality, finish)
      return
    case 'forest_return':
      recipeForestReturn(scene, effectAnchor, tint, cappedDuration, quality, finish)
      return
    case 'swamp_discard':
      recipeSwampDiscard(scene, effectAnchor, tint, cappedDuration, quality, finish)
      return
    case 'mountain_destroy':
      recipeMountainDestroy(scene, effectAnchor, tint, cappedDuration, quality, finish)
      return
    case 'plains_reuse':
      recipePlainsReuse(scene, effectAnchor, tint, cappedDuration, quality, finish)
      return
    case 'counter_resolved':
      recipeCounterResolved(scene, effectAnchor, tint, cappedDuration, quality, finish)
      return
    default:
      finish()
  }
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

export function enqueueEffect(state: EffectQueueState, descriptor: EffectDescriptor): EffectDescriptor[] {
  const dropped: EffectDescriptor[] = []
  state.queue.push(descriptor)
  // Drop oldest pending entries past the cap so a long resolution chain
  // (e.g. AI-vs-AI Plains reuse storms) never falls behind gameplay.
  while (state.queue.length > MAX_QUEUED_EFFECTS) {
    const removed = state.queue.shift()
    if (removed) {
      dropped.push(removed)
    }
  }
  return dropped
}

// Drops every pending descriptor but intentionally leaves `playing` alone:
// if a tween is currently in flight, its `done` callback (set up by
// `pumpEffectQueue` / `playAbilityEffect`) will eventually flip `playing`
// back to `false`. Resetting it here would let a follow-up `pumpEffectQueue`
// start a new effect concurrently with the still-running tween, which can
// double up rings on screen.
export function clearEffectQueue(state: EffectQueueState): void {
  state.queue.length = 0
}

export interface PumpEffectQueueOptions {
  animationSpeed: AnimationSpeed
  durationMs: number
  onDrained?: () => void
  // Caller-provided runner: receives the descriptor + duration and a `done`
  // callback. Returning synchronously is OK; pumpEffectQueue will keep
  // draining until the queue is empty.
  run: (descriptor: EffectDescriptor, durationMs: number, done: () => void) => void
}

// `getOptions` is invoked every time the queue advances (initial pump and
// each subsequent drain after `done`). This way, a setting change mid-queue
// (e.g. user toggles animationSpeed from "normal" to "off" or "fast" while
// a queued effect is still pending) is reflected on the very next entry,
// instead of the queue draining with the speed/duration captured when the
// first effect started.
export function pumpEffectQueue(
  state: EffectQueueState,
  getOptions: () => PumpEffectQueueOptions,
): void {
  const options = getOptions()
  if (options.animationSpeed === 'off') {
    clearEffectQueue(state)
    if (!state.playing) {
      options.onDrained?.()
    }
    return
  }
  if (state.playing) {
    return
  }
  const next = state.queue.shift()
  if (!next) {
    options.onDrained?.()
    return
  }
  state.playing = true
  options.run(next, options.durationMs, () => {
    state.playing = false
    pumpEffectQueue(state, getOptions)
  })
}
