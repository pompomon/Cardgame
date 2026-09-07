import { CircleGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry } from 'three'
import { MAX_EFFECT_MS } from '../../app/animation-settings'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import { clamp } from '../phaser/layout'
import type { CardAnchor, RetainedCard } from './card-registry'

export class EffectGeometry {
  readonly ring = new RingGeometry(0.9, 1, 48)
  readonly spark = new CircleGeometry(1, 12)
  readonly square = new PlaneGeometry(2, 2)
  readonly beam = new PlaneGeometry(1, 1)
  readonly leaf = new CircleGeometry(1, 4)
  readonly droplet = new CircleGeometry(1, 8)
  readonly vertex = new CircleGeometry(1, 3)

  dispose(): void {
    this.ring.dispose()
    this.spark.dispose()
    this.square.dispose()
    this.beam.dispose()
    this.leaf.dispose()
    this.droplet.dispose()
    this.vertex.dispose()
  }
}

export function effectRecipe(kind: VisualEffectDescriptor['kind']):
  'ripples' | 'leaves' | 'miasma' | 'embers' | 'radiance' | 'counter' | null {
  switch (kind) {
    case 'play_land': return 'ripples'
    case 'forest_return': return 'leaves'
    case 'swamp_discard': return 'miasma'
    case 'mountain_destroy': return 'embers'
    case 'plains_reuse': return 'radiance'
    case 'counter_resolved': return 'counter'
    default: return null
  }
}

/** Cosmetic-only drawing primitive; scheduling and event order belong to the caller. */
export class EffectVisual {
  readonly group = new Group()
  private readonly primary: MeshBasicMaterial
  private readonly secondary: MeshBasicMaterial
  private readonly glow: MeshBasicMaterial
  private readonly ring: Mesh
  private readonly halo: Mesh
  private readonly beam: Mesh
  private readonly sparks: Mesh[] = []
  private source: CardAnchor
  private target: CardAnchor
  private readonly duration: number
  private readonly recipe: ReturnType<typeof effectRecipe>
  private readonly complete: () => void
  private readonly removed: { card: RetainedCard; release: () => void } | null
  private elapsed = 0
  private finished = false

  constructor(
    geometry: EffectGeometry,
    descriptor: VisualEffectDescriptor,
    source: CardAnchor,
    target: CardAnchor,
    duration: number,
    particles: number,
    removed: { card: RetainedCard; release: () => void } | null,
    complete: () => void,
  ) {
    this.source = { ...source }
    this.target = { ...target }
    this.duration = Number.isFinite(duration) ? clamp(duration, 0, MAX_EFFECT_MS) : 0
    this.recipe = effectRecipe(descriptor.kind)
    this.complete = complete
    this.removed = removed
    this.primary = new MeshBasicMaterial({ color: descriptor.palette.primary, transparent: true, depthWrite: false })
    this.secondary = new MeshBasicMaterial({ color: descriptor.palette.secondary, transparent: true, depthWrite: false })
    this.glow = new MeshBasicMaterial({ color: descriptor.palette.glow, transparent: true, depthWrite: false })
    this.ring = new Mesh(geometry.ring, this.primary)
    this.halo = new Mesh(this.recipe === 'miasma' || this.recipe === 'embers' ? geometry.spark : geometry.ring, this.glow)
    this.beam = new Mesh(geometry.beam, this.glow)
    this.ring.name = 'effect-ring'
    this.halo.name = this.recipe === 'miasma' ? 'swamp-cloud' : this.recipe === 'embers' ? 'mountain-flash' : 'effect-halo'
    this.beam.name = 'plains-beam'
    this.group.add(this.ring, this.halo, this.beam)
    this.group.position.z = 85
    const count = Number.isFinite(particles) ? clamp(Math.floor(particles), 0, 8) : 0
    const particleGeometry = this.recipe === 'radiance' ? geometry.beam
      : descriptor.visualStyle === 'classic' ? geometry.square
        : this.recipe === 'leaves' ? geometry.leaf : this.recipe === 'miasma' ? geometry.droplet
          : this.recipe === 'counter' ? geometry.vertex : geometry.spark
    for (let index = 0; index < count; index++) {
      const spark = new Mesh(particleGeometry, this.secondary)
      spark.name = `${this.recipe}-particle`
      this.sparks.push(spark)
      this.group.add(spark)
    }
    this.positionRemoved()
    this.advance(0)
  }

  reanchor(source: CardAnchor, target: CardAnchor): void {
    if (this.finished) return
    const movedTarget = this.target.x !== target.x || this.target.y !== target.y
      || this.target.width !== target.width || this.target.height !== target.height
    this.source = { ...source }
    this.target = { ...target }
    if (movedTarget) this.positionRemoved()
    this.advance(0)
  }

  private positionRemoved(): void {
    if (this.recipe !== 'embers' || !this.removed) return
    const { card } = this.removed
    const { x, y, width, height } = this.target
    card.update({
      ...card.descriptor, x, y, width, height, visible: true, target: false, response: null,
      hit: { ...card.descriptor.hit, playable: false },
    })
    card.setInert()
    card.group.visible = true
  }

  advance(delta: number): void {
    if (this.finished) return
    if (Number.isFinite(delta) && delta > 0) this.elapsed += delta
    const progress = this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1
    if (progress >= 1 || !this.recipe) {
      this.cancel()
      return
    }
    this.primary.opacity = (1 - progress) * 0.9
    this.secondary.opacity = (1 - progress) * 0.85
    this.glow.opacity = (1 - progress) * 0.4
    this.ring.visible = this.recipe !== 'miasma'
    this.halo.visible = this.recipe !== 'leaves'
    this.beam.visible = this.recipe === 'radiance'
    switch (this.recipe) {
      case 'ripples': this.landing(progress); break
      case 'leaves': this.forest(progress); break
      case 'miasma': this.swamp(progress); break
      case 'embers': this.mountain(progress); break
      case 'radiance': this.plains(progress); break
      case 'counter': this.counter(progress); break
      default: this.cancel()
    }
  }

  private ringAt(mesh: Mesh, anchor: CardAnchor, radius: number): void {
    mesh.position.set(anchor.x, anchor.y, 0)
    mesh.scale.set(radius, radius * 0.7, 1)
  }

  private landing(t: number): void {
    const { source } = this
    const radius = source.width * (0.4 + t * 0.8)
    this.ringAt(this.ring, source, radius)
    this.ringAt(this.halo, source, source.width * (0.25 + Math.max(0, t - 0.18) * 0.9))
    for (let index = 0; index < this.sparks.length; index++) {
      const angle = index / this.sparks.length * Math.PI * 2
      const spark = this.sparks[index]
      spark.position.set(source.x + Math.cos(angle) * radius, source.y + Math.sin(angle) * radius * 0.7, 1)
      spark.scale.setScalar(2.5 * (1 - t))
    }
  }

  private forest(t: number): void {
    const { source, target } = this
    const ease = 1 - (1 - t) ** 2
    this.ringAt(this.ring, target, target.width * (0.7 - t * 0.35))
    for (let index = 0; index < this.sparks.length; index++) {
      const angle = index / this.sparks.length * Math.PI * 2 + t * 2.8
      const radius = target.width * 0.65 * (1 - ease)
      const spark = this.sparks[index]
      spark.position.set(
        source.x + (target.x - source.x) * ease + Math.cos(angle) * radius,
        source.y + (target.y - source.y) * ease + Math.sin(angle) * radius + Math.sin(t * Math.PI) * 28, 1,
      )
      spark.scale.set(4 + (1 - t) * 3, 8 + (1 - t) * 5, 1)
      spark.rotation.z = angle - Math.PI / 4
    }
  }

  private swamp(t: number): void {
    const { source, target } = this
    const ease = 1 - (1 - t) ** 2
    const x = source.x + (target.x - source.x) * ease
    const y = source.y + (target.y - source.y) * ease
    this.halo.position.set(target.x, target.y, -1)
    this.halo.scale.set(target.width * (0.35 + t * 0.5), target.height * (0.2 + t * 0.12), 1)
    this.glow.opacity = Math.sin(t * Math.PI) * 0.24
    for (let index = 0; index < this.sparks.length; index++) {
      const lane = (index + 0.5) / this.sparks.length - 0.5
      const spark = this.sparks[index]
      spark.position.set(x + lane * target.width * 0.85, y + Math.sin(t * Math.PI) * (35 + index % 3 * 10) - t * 16, 1)
      spark.scale.set(3 + t * 2, 7 + Math.sin(t * Math.PI) * 5, 1)
      spark.rotation.z = -lane * 0.3
    }
  }

  private mountain(t: number): void {
    const { target } = this
    const impact = clamp((t - 0.15) / 0.85, 0, 1)
    this.ringAt(this.ring, target, target.width * (0.2 + impact * 0.85))
    this.halo.position.set(target.x, target.y, 1)
    this.halo.scale.set(target.width * (0.3 + impact * 0.35), target.height * (0.3 + impact * 0.2), 1)
    this.glow.opacity = Math.max(0, 1 - impact * 4) * 0.75
    for (let index = 0; index < this.sparks.length; index++) {
      const angle = index / this.sparks.length * Math.PI * 2
      const distance = target.width * (0.12 + impact * (0.75 + index % 3 * 0.15))
      const spark = this.sparks[index]
      spark.position.set(target.x + Math.cos(angle) * distance,
        target.y + Math.sin(angle) * distance + impact * 28 - impact ** 2 * 55, 2)
      spark.scale.set(3 + (1 - impact) * 3, 5 + (1 - impact) * 5, 1)
      spark.rotation.z = angle + impact * 3
    }
    if (this.removed) {
      this.removed.card.setOpacity(1 - impact)
      this.removed.card.group.scale.set(1 - impact * 0.25, 1 - impact * 0.25, 1)
    }
  }

  private plains(t: number): void {
    const { source } = this
    this.ringAt(this.ring, source, source.width * (0.95 - t * 0.6))
    this.ringAt(this.halo, source, source.width * (0.7 - t * 0.4))
    this.beam.position.set(source.x, source.y + source.height * (0.2 - t * 0.2), -1)
    this.beam.scale.set(source.width * 0.12, source.height * (1.1 - t * 0.6), 1)
    for (let index = 0; index < this.sparks.length; index++) {
      const lane = (index + 0.5) / this.sparks.length - 0.5
      const spark = this.sparks[index]
      spark.position.set(source.x + lane * source.width * (1 - t * 0.5),
        source.y + (1 - t) * source.height * (0.2 + index % 2 * 0.15), 1)
      spark.scale.set(2 + index % 3, source.height * (0.2 + (1 - t) * 0.45), 1)
    }
  }

  private counter(t: number): void {
    const { source } = this
    const radius = source.width * (0.55 + Math.sin(t * Math.PI) * 0.25)
    this.ringAt(this.ring, source, source.width * (0.3 + t * 0.8))
    this.ringAt(this.halo, source, source.width * (0.95 - t * 0.6))
    for (let index = 0; index < this.sparks.length; index++) {
      const angle = index / this.sparks.length * Math.PI * 2 + Math.PI / 4
      const spark = this.sparks[index]
      spark.position.set(source.x + Math.cos(angle) * radius, source.y + Math.sin(angle) * radius, 1)
      spark.scale.setScalar(7 * (1 - t * 0.5))
      spark.rotation.z = angle + Math.PI
    }
  }

  cancel = (): void => {
    if (this.finished) return
    this.finished = true
    this.group.removeFromParent()
    this.group.clear()
    this.primary.dispose()
    this.secondary.dispose()
    this.glow.dispose()
    this.removed?.release()
    this.complete()
  }
}
