import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry,
} from 'three'
import type { CardVisualStyle } from '../../app/card-visual-styles'
import { MAX_EFFECT_MS, MAX_QUEUED_EFFECTS } from '../../app/animation-settings'
import { ThreeAssets, type TextureLease } from './assets'
import type { BoardHit } from './contracts'
import { pointInRect, type BoardRect, type Point } from './layout'

export interface CardDescriptor extends BoardRect {
  readonly hit: BoardHit
  readonly style: CardVisualStyle
  readonly visible: boolean
  readonly target: boolean
  readonly response?: 'required' | 'discard' | null
  readonly shadows: boolean
  readonly lifted?: boolean
  readonly stackIndex?: number
}

export interface CardAnchor extends BoardRect {
  readonly owner: number
  readonly zone: BoardHit['zone']
}

export function boardCardKey(cardId: string, owner: number, instanceId?: string): string {
  return JSON.stringify([owner, cardId, instanceId ?? null])
}

export class CardGeometry {
  readonly body = new BoxGeometry(1, 1, 1)
  readonly face = new PlaneGeometry(1, 1)

  dispose(): void {
    this.body.dispose()
    this.face.dispose()
  }
}

export class RetainedCard {
  readonly group = new Group()
  private readonly bodyMaterial = new MeshStandardMaterial({ color: '#ebd9b9', roughness: 0.7, metalness: 0.1 })
  private readonly faceMaterial = new MeshBasicMaterial({ transparent: true })
  private readonly shadowMaterial = new MeshBasicMaterial({ color: '#020611', transparent: true, opacity: 0.3, depthWrite: false })
  private readonly frameMaterial = new MeshBasicMaterial({ color: '#75f9b3', transparent: true, opacity: 0.9, depthWrite: false })
  private readonly body: Mesh
  private readonly face: Mesh
  private readonly shadow: Mesh
  private readonly frame = new Group()
  private lease: TextureLease | null = null
  private signature = ''
  private disposed = false
  private motion: { from: BoardRect; elapsed: number; duration: number } | null = null
  private readonly assets: ThreeAssets
  descriptor: CardDescriptor
  pins = 0

  constructor(geometry: CardGeometry, assets: ThreeAssets, descriptor: CardDescriptor) {
    this.assets = assets
    this.descriptor = descriptor
    this.body = new Mesh(geometry.body, this.bodyMaterial)
    this.face = new Mesh(geometry.face, this.faceMaterial)
    this.shadow = new Mesh(geometry.face, this.shadowMaterial)
    this.frame.name = 'card-highlight-frame'
    for (let edge = 0; edge < 4; edge++) this.frame.add(new Mesh(geometry.face, this.frameMaterial))
    this.group.add(this.shadow, this.frame, this.body, this.face)
    this.update(descriptor)
  }

  update(descriptor: CardDescriptor, durationMs = 0): void {
    if (this.disposed) return
    const previous = this.descriptor
    const from = this.anchor()
    this.descriptor = descriptor
    const signature = `${descriptor.style}:${descriptor.hit.name}`
    if (signature !== this.signature) {
      const next = this.assets.acquireCard(descriptor.hit.name, descriptor.style)
      this.lease?.release()
      this.lease = next
      this.faceMaterial.map = next.texture
      this.faceMaterial.needsUpdate = true
      this.signature = signature
    }
    this.group.visible = descriptor.visible
    this.group.renderOrder = descriptor.lifted ? 1000 : descriptor.stackIndex ?? 0
    this.group.scale.set(1, 1, 1)
    this.group.rotation.set(0, 0, 0)
    const duration = Number.isFinite(durationMs) ? Math.min(MAX_EFFECT_MS, Math.max(0, durationMs)) : 0
    const changed = previous.x !== descriptor.x || previous.y !== descriptor.y
      || previous.width !== descriptor.width || previous.height !== descriptor.height
    if (!duration || !previous.visible || !descriptor.visible) {
      this.finishMotion()
    } else if (changed) {
      this.motion = { from, elapsed: 0, duration }
      this.position(from)
    } else if (!this.motion) {
      this.position(descriptor)
    }
    this.shadow.visible = descriptor.shadows
    this.frame.visible = descriptor.target || descriptor.hit.playable || !!descriptor.response
    this.frameMaterial.color.set(descriptor.response === 'required' ? '#80bfff'
      : descriptor.response === 'discard' ? '#e4a0ff' : descriptor.target ? '#ffdf7e' : '#7bf5bd')
    this.sizeFrame()
    this.setOpacity(1)
  }

  private position({ x, y, width, height }: BoardRect): void {
    this.group.position.set(x, y, this.descriptor.lifted ? 40 : 8 + (this.descriptor.stackIndex ?? 0) * 0.02)
    this.body.scale.set(width, height, 5)
    this.body.position.z = 2.5
    this.face.scale.set(width - 2, height - 2, 1)
    this.face.position.z = 5.1
    const shadowPadding = this.descriptor.lifted ? 4 : 8
    this.shadow.scale.set(width + shadowPadding, height + shadowPadding, 1)
    this.shadow.position.set(this.descriptor.lifted ? 6 : 4, this.descriptor.lifted ? -8 : -6, this.descriptor.lifted ? -22 : -6)
    this.sizeFrame()
  }

  private sizeFrame(): void {
    const gap = this.descriptor.response === 'required' ? 2 : 3
    const thickness = 2
    const width = this.body.scale.x + 2 * gap
    const height = this.body.scale.y + 2 * gap
    const [top, bottom, left, right] = this.frame.children
    top.scale.set(width + 2 * thickness, thickness, 1)
    bottom.scale.copy(top.scale)
    top.position.set(0, (height + thickness) / 2, 0)
    bottom.position.set(0, -(height + thickness) / 2, 0)
    left.scale.set(thickness, height, 1)
    right.scale.copy(left.scale)
    left.position.set(-(width + thickness) / 2, 0, 0)
    right.position.set((width + thickness) / 2, 0, 0)
    this.frame.position.z = -2
  }

  advance(delta: number): void {
    const motion = this.motion
    if (!motion || this.disposed || !Number.isFinite(delta) || delta <= 0) return
    motion.elapsed = Math.min(motion.duration, motion.elapsed + delta)
    if (motion.elapsed >= motion.duration) {
      this.finishMotion()
      return
    }
    const t = 1 - (1 - motion.elapsed / motion.duration) ** 3
    const from = motion.from
    const to = this.descriptor
    this.position({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      width: from.width + (to.width - from.width) * t,
      height: from.height + (to.height - from.height) * t,
    })
  }

  get animating(): boolean {
    return this.motion !== null
  }

  finishMotion(): void {
    this.motion = null
    if (!this.disposed) this.position(this.descriptor)
  }

  setOpacity(opacity: number): void {
    this.bodyMaterial.transparent = opacity < 1
    this.bodyMaterial.opacity = opacity
    this.faceMaterial.opacity = opacity
    this.shadowMaterial.opacity = opacity * 0.3
    this.frameMaterial.opacity = opacity * 0.9
  }

  setInert(): void {
    this.motion = null
    this.group.visible = false
    this.frame.visible = false
  }

  anchor(): CardAnchor {
    const { hit } = this.descriptor
    return {
      x: this.group.position.x, y: this.group.position.y,
      width: this.body.scale.x * Math.abs(this.group.scale.x),
      height: this.body.scale.y * Math.abs(this.group.scale.y),
      owner: hit.owner, zone: hit.zone,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.motion = null
    this.group.removeFromParent()
    this.lease?.release()
    this.lease = null
    this.bodyMaterial.dispose()
    this.faceMaterial.dispose()
    this.shadowMaterial.dispose()
    this.frameMaterial.dispose()
    this.group.clear()
  }
}

/** Instances, not land names, identify effects; bounded history survives removals. */
export class ThreeCardRegistry {
  readonly layer = new Group()
  private readonly active = new Map<string, RetainedCard>()
  private readonly retired = new Map<string, RetainedCard>()
  private readonly history = new Map<string, CardAnchor>()
  private removalTargets = new Set<string>()
  private readonly geometry = new CardGeometry()
  private readonly assets: ThreeAssets
  private disposed = false

  constructor(assets: ThreeAssets) {
    this.assets = assets
  }

  reconcile(descriptors: readonly CardDescriptor[], durationMs = 0): void {
    if (this.disposed) return
    const wanted = new Set(descriptors.map((descriptor) => descriptor.hit.key))
    const removed = new Map<string, RetainedCard>()
    for (const [key, card] of this.active) {
      if (!wanted.has(key)) {
        this.remember(card)
        card.setInert()
        this.active.delete(key)
        this.retired.set(key, card)
        removed.set(key, card)
      }
    }
    for (const descriptor of descriptors) {
      const key = descriptor.hit.key
      let card = this.active.get(key)
      let moveDuration = durationMs
      if (!card) {
        card = this.retired.get(key)
        if (card) {
          this.retired.delete(key)
          moveDuration = 0
        } else {
          // A physical card crossing zones keeps its mesh; new battlefield
          // incarnations in the same zone still have distinct instance identity.
          for (const [oldKey, candidate] of removed) {
            const old = candidate.descriptor.hit
            if (old.cardId !== descriptor.hit.cardId || old.owner !== descriptor.hit.owner
              || old.zone === descriptor.hit.zone || candidate.pins
              || (old.instanceId && this.removalTargets.has(old.instanceId))) continue
            card = candidate
            this.retired.delete(oldKey)
            removed.delete(oldKey)
            break
          }
          card ??= new RetainedCard(this.geometry, this.assets, descriptor)
        }
        this.active.set(key, card)
        this.layer.add(card.group)
      }
      card.update(descriptor, moveDuration)
      this.remember(card)
    }
    this.trim()
  }

  get(key: string): RetainedCard | null {
    return this.active.get(key) ?? null
  }

  hitTest(point: Point): BoardHit | null {
    let hit: BoardHit | null = null
    let stackIndex = -Infinity
    for (const card of this.active.values()) {
      const nextStackIndex = card.descriptor.stackIndex ?? 0
      if (card.group.visible && pointInRect(point, card.anchor()) && nextStackIndex >= stackIndex) {
        hit = card.descriptor.hit
        stackIndex = nextStackIndex
      }
    }
    return hit
  }

  advance(delta: number): void {
    for (const card of this.active.values()) card.advance(delta)
  }

  get animating(): boolean {
    for (const card of this.active.values()) if (card.animating) return true
    return false
  }

  finishMotion(): void {
    for (const card of this.active.values()) card.finishMotion()
  }

  /** Presentation-only cards share resources but never enter picking or history. */
  createPresentation(descriptor: CardDescriptor): RetainedCard {
    const card = new RetainedCard(this.geometry, this.assets, descriptor)
    this.layer.add(card.group)
    return card
  }

  createProxy(source: RetainedCard): RetainedCard {
    const proxy = this.createPresentation({
      ...source.descriptor, ...source.anchor(), visible: true, target: false, response: null,
      hit: { ...source.descriptor.hit, playable: false },
    })
    proxy.group.position.z = 60
    proxy.group.scale.set(1.08, 1.08, 1)
    return proxy
  }

  anchorFor(instanceId?: string, cardId?: string): CardAnchor | null {
    if (instanceId === undefined && cardId === undefined) return null
    for (const card of this.active.values()) {
      const hit = card.descriptor.hit
      if (instanceId !== undefined ? hit.instanceId !== instanceId : hit.cardId !== cardId) continue
      return card.descriptor.visible ? card.anchor() : null
    }
    // An explicit instance must never silently resolve to a different incarnation.
    if (instanceId !== undefined) return this.history.get(`instance:${instanceId}`) ?? null
    return cardId !== undefined ? this.history.get(`card:${cardId}`) ?? null : null
  }

  pinRemoved(instanceId: string): { card: RetainedCard; release: () => void } | null {
    for (const card of this.retired.values()) {
      if (card.descriptor.hit.instanceId !== instanceId || !card.descriptor.visible) continue
      if (!card.pins && [...this.retired.values()].filter((entry) => entry.pins > 0).length >= MAX_QUEUED_EFFECTS + 1) return null
      card.pins++
      card.group.visible = true
      let released = false
      return {
        card,
        release: (): void => {
          if (released) return
          released = true
          card.pins--
          if (!card.pins) {
            card.group.visible = false
            card.setOpacity(1)
            card.group.scale.set(1, 1, 1)
          }
          this.trim()
        },
      }
    }
    return null
  }

  /** Reserve queued targets before reconciliation can evict their inert copies. */
  retainRemovedTargets(instanceIds: readonly string[]): void {
    if (this.disposed) return
    this.removalTargets = new Set(instanceIds.slice(-(MAX_QUEUED_EFFECTS + 1)))
    this.trim()
  }

  /** Layout/page changes invalidate old slots, but not queued removal copies. */
  invalidateHistoricalAnchors(): void {
    this.history.clear()
  }

  private remember(card: RetainedCard): void {
    const { hit, visible } = card.descriptor
    const keys = [`card:${hit.cardId}`, ...(hit.instanceId ? [`instance:${hit.instanceId}`] : [])]
    for (const key of keys) {
      this.history.delete(key)
      if (visible) this.history.set(key, card.anchor())
    }
  }

  private trim(): void {
    for (const [key, card] of this.retired) {
      if (this.retired.size <= 12) break
      if (card.pins > 0 || this.removalTargets.has(card.descriptor.hit.instanceId ?? '')) continue
      card.dispose()
      this.retired.delete(key)
    }
    const protectedKeys = new Set<string>()
    for (const card of this.retired.values()) {
      const { instanceId, cardId } = card.descriptor.hit
      if (!card.pins && !this.removalTargets.has(instanceId ?? '')) continue
      protectedKeys.add(`card:${cardId}`)
      if (instanceId) protectedKeys.add(`instance:${instanceId}`)
    }
    for (const key of this.history.keys()) {
      if (this.history.size <= 256) break
      if (!protectedKeys.has(key)) this.history.delete(key)
    }
  }

  get size(): number {
    return this.active.size
  }

  get retainedCount(): number {
    return this.retired.size
  }

  clear(): void {
    for (const card of this.active.values()) card.dispose()
    for (const card of this.retired.values()) card.dispose()
    this.active.clear()
    this.retired.clear()
    this.history.clear()
    this.removalTargets.clear()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clear()
    this.layer.removeFromParent()
    this.geometry.dispose()
  }
}
