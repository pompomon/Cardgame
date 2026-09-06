import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, RingGeometry,
} from 'three'
import type { CardVisualStyle } from '../../app/card-visual-styles'
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
  readonly ring = new RingGeometry(0.66, 0.70, 48)

  dispose(): void {
    this.body.dispose()
    this.face.dispose()
    this.ring.dispose()
  }
}

export class RetainedCard {
  readonly group = new Group()
  private readonly bodyMaterial = new MeshStandardMaterial({ color: '#ebd9b9', roughness: 0.7, metalness: 0.1 })
  private readonly faceMaterial = new MeshBasicMaterial({ transparent: true })
  private readonly shadowMaterial = new MeshBasicMaterial({ color: '#020611', transparent: true, opacity: 0.3, depthWrite: false })
  private readonly ringMaterial = new MeshBasicMaterial({ color: '#75f9b3', transparent: true, opacity: 0.9, depthWrite: false })
  private readonly body: Mesh
  private readonly face: Mesh
  private readonly shadow: Mesh
  private readonly ring: Mesh
  private lease: TextureLease | null = null
  private signature = ''
  private disposed = false
  private readonly assets: ThreeAssets
  descriptor: CardDescriptor
  pins = 0

  constructor(geometry: CardGeometry, assets: ThreeAssets, descriptor: CardDescriptor) {
    this.assets = assets
    this.descriptor = descriptor
    this.body = new Mesh(geometry.body, this.bodyMaterial)
    this.face = new Mesh(geometry.face, this.faceMaterial)
    this.shadow = new Mesh(geometry.face, this.shadowMaterial)
    this.ring = new Mesh(geometry.ring, this.ringMaterial)
    this.group.add(this.shadow, this.ring, this.body, this.face)
    this.update(descriptor)
  }

  update(descriptor: CardDescriptor): void {
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
    const { width, height, x, y } = descriptor
    this.group.position.set(x, y, 8)
    this.group.visible = descriptor.visible
    this.group.scale.set(1, 1, 1)
    this.group.rotation.set(0, 0, 0)
    this.body.scale.set(width, height, 5)
    this.body.position.z = 2.5
    this.face.scale.set(width - 2, height - 2, 1)
    this.face.position.z = 5.1
    this.shadow.scale.set(width + 8, height + 8, 1)
    this.shadow.position.set(4, -6, -6)
    this.shadow.visible = descriptor.shadows
    const ringScale = descriptor.response === 'required' ? 0.9 : 1.1
    this.ring.scale.set(width * ringScale, height * ringScale, 1)
    this.ring.position.z = -2
    this.ring.visible = descriptor.target || descriptor.hit.playable || !!descriptor.response
    this.ringMaterial.color.set(descriptor.response === 'required' ? '#80bfff'
      : descriptor.response === 'discard' ? '#e4a0ff' : descriptor.target ? '#ffdf7e' : '#7bf5bd')
    this.setOpacity(1)
  }

  setOpacity(opacity: number): void {
    this.bodyMaterial.transparent = opacity < 1
    this.bodyMaterial.opacity = opacity
    this.faceMaterial.opacity = opacity
    this.shadowMaterial.opacity = opacity * 0.3
    this.ringMaterial.opacity = opacity * 0.9
  }

  setInert(): void {
    this.group.visible = false
    this.ring.visible = false
  }

  anchor(): CardAnchor {
    const { x, y, width, height, hit } = this.descriptor
    return { x, y, width, height, owner: hit.owner, zone: hit.zone }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    this.lease?.release()
    this.lease = null
    this.bodyMaterial.dispose()
    this.faceMaterial.dispose()
    this.shadowMaterial.dispose()
    this.ringMaterial.dispose()
    this.group.clear()
  }
}

/** Instances, not land names, identify effects; bounded history survives removals. */
export class ThreeCardRegistry {
  readonly layer = new Group()
  private readonly active = new Map<string, RetainedCard>()
  private readonly retired = new Map<string, RetainedCard>()
  private readonly history = new Map<string, CardAnchor>()
  private readonly geometry = new CardGeometry()
  private readonly assets: ThreeAssets
  private disposed = false

  constructor(assets: ThreeAssets) {
    this.assets = assets
  }

  reconcile(descriptors: readonly CardDescriptor[]): void {
    if (this.disposed) return
    const wanted = new Set(descriptors.map((descriptor) => descriptor.hit.key))
    for (const [key, card] of this.active) {
      if (!wanted.has(key)) {
        this.remember(card)
        card.setInert()
        this.active.delete(key)
        this.retired.set(key, card)
      }
    }
    for (const descriptor of descriptors) {
      const key = descriptor.hit.key
      let card = this.active.get(key)
      if (!card) {
        card = this.retired.get(key)
        if (card) this.retired.delete(key)
        else card = new RetainedCard(this.geometry, this.assets, descriptor)
        this.active.set(key, card)
        this.layer.add(card.group)
      }
      card.update(descriptor)
      this.remember(card)
    }
    this.trim()
  }

  get(key: string): RetainedCard | null {
    return this.active.get(key) ?? null
  }

  hitTest(point: Point): BoardHit | null {
    for (const card of this.active.values()) {
      if (card.descriptor.visible && pointInRect(point, card.descriptor)) return card.descriptor.hit
    }
    return null
  }

  createProxy(source: RetainedCard): RetainedCard {
    const proxy = new RetainedCard(this.geometry, this.assets, {
      ...source.descriptor, visible: true, target: false, response: null,
      hit: { ...source.descriptor.hit, playable: false },
    })
    proxy.group.position.z = 60
    proxy.group.scale.set(1.08, 1.08, 1)
    this.layer.add(proxy.group)
    return proxy
  }

  anchorFor(instanceId?: string, cardId?: string): CardAnchor | null {
    // An explicit instance must never silently resolve to a different incarnation.
    if (instanceId !== undefined) return this.history.get(`instance:${instanceId}`) ?? null
    return cardId !== undefined ? this.history.get(`card:${cardId}`) ?? null : null
  }

  pinRemoved(instanceId: string): { card: RetainedCard; release: () => void } | null {
    for (const card of this.retired.values()) {
      if (card.descriptor.hit.instanceId !== instanceId) continue
      card.pins++
      card.group.visible = true
      let released = false
      return {
        card,
        release: (): void => {
          if (released) return
          released = true
          card.pins--
          card.group.visible = false
          card.setOpacity(1)
          card.group.scale.set(1, 1, 1)
          this.trim()
        },
      }
    }
    return null
  }

  private remember(card: RetainedCard): void {
    const { hit, visible } = card.descriptor
    const keys = [`card:${hit.cardId}`, ...(hit.instanceId ? [`instance:${hit.instanceId}`] : [])]
    for (const key of keys) {
      if (!visible && this.history.has(key)) continue
      this.history.delete(key)
      this.history.set(key, card.anchor())
    }
    while (this.history.size > 256) this.history.delete(this.history.keys().next().value!)
  }

  private trim(): void {
    for (const [key, card] of this.retired) {
      if (this.retired.size <= 12) break
      if (card.pins > 0) continue
      card.dispose()
      this.retired.delete(key)
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
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clear()
    this.layer.removeFromParent()
    this.geometry.dispose()
  }
}
