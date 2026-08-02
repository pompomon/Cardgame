import type { BasicLand } from '../../game/types'
import type { CardVisualStyle } from '../../app/types'
import type { BattlefieldCardPlacement } from './effect-anchoring'
import type { EffectAnchor, EffectDescriptor } from './effects'

interface Destroyable {
  destroy(): void
  setPosition(x: number, y: number): unknown
}

type RenderRetainedCard = (
  x: number,
  y: number,
  cardName: BasicLand,
  visualStyle: CardVisualStyle,
) => Destroyable

export class EffectTargetRetention {
  private readonly retained = new Map<string, {
    card: Destroyable
    placement: BattlefieldCardPlacement
    release: () => void
  }>()

  retainMountainTarget(
    descriptor: EffectDescriptor,
    placement: BattlefieldCardPlacement | undefined,
    anchor: EffectAnchor | undefined,
    render: RenderRetainedCard,
  ): () => void {
    if (
      descriptor.kind !== 'mountain_destroy'
      || !descriptor.targetInstanceId
      || !descriptor.targetCardName
      || !placement
      || !anchor
    ) {
      return () => {}
    }
    const existing = this.retained.get(descriptor.targetInstanceId)
    if (existing) {
      return existing.release
    }
    const card = render(anchor.x, anchor.y, descriptor.targetCardName, descriptor.visualStyle)
    let released = false
    const release = (): void => {
      if (released) {
        return
      }
      released = true
      this.retained.delete(descriptor.targetInstanceId!)
      card.destroy()
    }
    this.retained.set(descriptor.targetInstanceId, { card, placement, release })
    return release
  }

  update(resolveAnchor: (placement: BattlefieldCardPlacement) => EffectAnchor): void {
    for (const retained of this.retained.values()) {
      const anchor = resolveAnchor(retained.placement)
      retained.card.setPosition(anchor.x, anchor.y)
    }
  }

  releaseMountainTarget(descriptor: EffectDescriptor): void {
    if (descriptor.kind === 'mountain_destroy' && descriptor.targetInstanceId) {
      this.retained.get(descriptor.targetInstanceId)?.release()
    }
  }

  clear(): void {
    for (const retained of [...this.retained.values()]) {
      retained.release()
    }
    this.retained.clear()
  }
}
