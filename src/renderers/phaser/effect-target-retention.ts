import type { BasicLand } from '../../game/types'
import type { CardVisualStyle } from '../../app/types'
import type { EffectAnchor, EffectDescriptor } from './effects'

interface Destroyable {
  destroy(): void
}

type RenderRetainedCard = (
  x: number,
  y: number,
  cardName: BasicLand,
  visualStyle: CardVisualStyle,
) => Destroyable

export class EffectTargetRetention {
  private readonly retained = new Set<() => void>()

  retainMountainTarget(
    descriptor: EffectDescriptor,
    previousRegistry: ReadonlyMap<string, EffectAnchor>,
    render: RenderRetainedCard,
  ): () => void {
    if (
      descriptor.kind !== 'mountain_destroy'
      || !descriptor.targetInstanceId
      || !descriptor.targetCardName
    ) {
      return () => {}
    }
    const anchor = previousRegistry.get(descriptor.targetInstanceId)
    if (!anchor) {
      return () => {}
    }
    const card = render(anchor.x, anchor.y, descriptor.targetCardName, descriptor.visualStyle)
    let released = false
    const release = (): void => {
      if (released) {
        return
      }
      released = true
      this.retained.delete(release)
      card.destroy()
    }
    this.retained.add(release)
    return release
  }

  clear(): void {
    for (const release of this.retained) {
      release()
    }
    this.retained.clear()
  }
}
