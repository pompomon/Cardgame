import type Phaser from 'phaser'
import { CardView, type CardViewRenderCard } from './card-view'

export class CardViewPool {
  private readonly scene: Phaser.Scene
  private readonly renderCard: CardViewRenderCard
  private readonly available: CardView[] = []
  private readonly allViews = new Set<CardView>()

  constructor(scene: Phaser.Scene, renderCard: CardViewRenderCard) {
    this.scene = scene
    this.renderCard = renderCard
  }

  acquire(): CardView {
    const view = this.available.pop()
    if (view) {
      return view
    }
    const created = new CardView(this.scene, this.renderCard)
    this.allViews.add(created)
    return created
  }

  release(view: CardView): void {
    view.resetForPool()
    this.available.push(view)
  }

  destroy(): void {
    for (const view of this.allViews) {
      view.destroy()
    }
    this.available.length = 0
    this.allViews.clear()
  }

  pooledCount(): number {
    return this.available.length
  }

  createdCount(): number {
    return this.allViews.size
  }
}
