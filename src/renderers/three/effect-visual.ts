import { CircleGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry } from 'three'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import type { CardAnchor, RetainedCard } from './card-registry'

export class EffectGeometry {
  readonly ring = new RingGeometry(0.85, 1, 48)
  readonly spark = new CircleGeometry(1, 8)
  readonly square = new PlaneGeometry(2, 2)
  readonly beam = new PlaneGeometry(1, 1)

  dispose(): void {
    this.ring.dispose()
    this.spark.dispose()
    this.square.dispose()
    this.beam.dispose()
  }
}

export function effectRecipe(kind: VisualEffectDescriptor['kind']): 'burst' | 'trail' | 'break' | 'counter' | null {
  switch (kind) {
    case 'play_land':
    case 'plains_reuse':
      return 'burst'
    case 'forest_return':
    case 'swamp_discard':
      return 'trail'
    case 'mountain_destroy':
      return 'break'
    case 'counter_resolved':
      return 'counter'
    default:
      return null
  }
}

/** Cosmetic-only drawing primitive; scheduling and event order belong to the caller. */
export class EffectVisual {
  readonly group = new Group()
  private readonly primary: MeshBasicMaterial
  private readonly secondary: MeshBasicMaterial
  private readonly ring: Mesh
  private readonly beam: Mesh
  private readonly sparks: Mesh[] = []
  private readonly source: CardAnchor
  private readonly target: CardAnchor
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
    this.duration = Math.max(90, Math.min(1500, duration))
    this.recipe = effectRecipe(descriptor.kind)
    this.complete = complete
    this.removed = removed
    this.primary = new MeshBasicMaterial({ color: descriptor.palette.primary, transparent: true, depthWrite: false })
    this.secondary = new MeshBasicMaterial({ color: descriptor.palette.glow, transparent: true, opacity: 0.65, depthWrite: false })
    this.ring = new Mesh(geometry.ring, this.primary)
    this.beam = new Mesh(geometry.beam, this.secondary)
    this.group.add(this.ring, this.beam)
    this.group.position.z = 85
    for (let index = 0; index < Math.min(8, particles); index++) {
      const spark = new Mesh(descriptor.visualStyle === 'classic' ? geometry.square : geometry.spark, this.secondary)
      this.sparks.push(spark)
      this.group.add(spark)
    }
    this.advance(0)
  }

  advance(delta: number): void {
    if (this.finished) return
    this.elapsed += delta
    const progress = Math.min(1, this.elapsed / this.duration)
    if (progress >= 1) {
      this.cancel()
      return
    }
    const t = 1 - (1 - progress) ** 2
    const moving = this.recipe === 'trail' || this.recipe === 'counter' || this.recipe === 'break'
    const x = moving ? this.source.x + (this.target.x - this.source.x) * t : this.source.x
    const y = moving ? this.source.y + (this.target.y - this.source.y) * t : this.source.y
    const radius = this.source.width * (0.45 + progress * 0.4)
    this.ring.position.set(x, y, 0)
    this.ring.scale.set(radius, radius, 1)
    this.primary.opacity = (1 - progress) * 0.9
    this.secondary.opacity = (1 - progress) * 0.65
    this.beam.visible = moving
    if (moving) {
      const dx = x - this.source.x
      const dy = y - this.source.y
      this.beam.position.set((x + this.source.x) / 2, (y + this.source.y) / 2, -1)
      this.beam.scale.set(Math.hypot(dx, dy), this.recipe === 'counter' ? 9 : 4, 1)
      this.beam.rotation.z = Math.atan2(dy, dx)
    }
    for (let index = 0; index < this.sparks.length; index++) {
      const angle = index / this.sparks.length * Math.PI * 2 + progress * 1.4
      const distance = radius * (0.5 + progress)
      const spark = this.sparks[index]
      spark.position.set(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 1)
      spark.scale.setScalar(3 + (1 - progress) * 3)
      spark.rotation.z = angle
    }
    if (this.removed) {
      this.removed.card.setOpacity(1 - progress)
      this.removed.card.group.scale.setScalar(1 - progress * 0.3)
    }
  }

  cancel = (): void => {
    if (this.finished) return
    this.finished = true
    this.group.removeFromParent()
    this.group.clear()
    this.primary.dispose()
    this.secondary.dispose()
    this.removed?.release()
    this.complete()
  }
}
