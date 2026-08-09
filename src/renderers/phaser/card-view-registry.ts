import type Phaser from 'phaser'
import type { CardViewRenderCard, CardViewSyncOptions } from './card-view'
import { CardView } from './card-view'
import { CardViewPool } from './card-view-pool'

export type RetainedCardSyncOptions = CardViewSyncOptions

export class CardViewRegistry {
  private readonly pool: CardViewPool
  private readonly active = new Map<string, CardView>()
  private readonly seenThisFrame = new Set<string>()
  private root: Phaser.GameObjects.Container | null = null

  constructor(scene: Phaser.Scene, renderCard?: CardViewRenderCard) {
    this.pool = new CardViewPool(scene, renderCard)
  }

  beginFrame(root: Phaser.GameObjects.Container | null): void {
    this.root = root
    this.seenThisFrame.clear()
  }

  syncCard(options: RetainedCardSyncOptions): Phaser.GameObjects.Container | null {
    if (!this.root) {
      return null
    }
    this.seenThisFrame.add(options.cardId)
    let view = this.active.get(options.cardId)
    if (!view) {
      view = this.pool.acquire()
      this.active.set(options.cardId, view)
    }
    const container = view.sync(options)
    if ((container as { parentContainer?: Phaser.GameObjects.Container | null }).parentContainer !== this.root) {
      this.root.add(container)
    }
    return container
  }

  endFrame(): void {
    for (const [cardId, view] of [...this.active]) {
      if (this.seenThisFrame.has(cardId)) {
        continue
      }
      this.detach(view.container)
      this.active.delete(cardId)
      this.pool.release(view)
    }
    this.seenThisFrame.clear()
  }

  detachFromRoot(root: Phaser.GameObjects.Container | null): void {
    if (!root) {
      return
    }
    for (const view of this.active.values()) {
      root.remove(view.container, false)
    }
  }

  reset(): void {
    for (const view of this.active.values()) {
      this.detach(view.container)
      this.pool.release(view)
    }
    this.active.clear()
    this.seenThisFrame.clear()
  }

  destroy(): void {
    this.active.clear()
    this.seenThisFrame.clear()
    this.root = null
    this.pool.destroy()
  }

  activeCount(): number {
    return this.active.size
  }

  pooledCount(): number {
    return this.pool.pooledCount()
  }

  createdCount(): number {
    return this.pool.createdCount()
  }

  private detach(container: Phaser.GameObjects.Container): void {
    const parent = (container as { parentContainer?: Phaser.GameObjects.Container | null }).parentContainer
    parent?.remove(container, false)
  }
}
