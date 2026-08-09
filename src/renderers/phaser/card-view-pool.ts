import type { CardView } from './card-view'

export type CardViewFactory = () => CardView

const DEFAULT_MAX_POOLED_CARD_VIEWS = 100

export class CardViewPool {
  private readonly createView: CardViewFactory
  private readonly maxSize: number
  private readonly available: CardView[] = []
  private readonly availableSet = new Set<CardView>()

  constructor(
    createView: CardViewFactory,
    maxSize = DEFAULT_MAX_POOLED_CARD_VIEWS,
  ) {
    this.createView = createView
    this.maxSize = Math.max(0, Math.floor(maxSize))
  }

  get size(): number {
    return this.available.length
  }

  acquire(): CardView {
    const view = this.available.pop()
    if (view) {
      this.availableSet.delete(view)
      return view
    }
    return this.createView()
  }

  release(view: CardView): void {
    if (this.availableSet.has(view)) {
      return
    }
    view.resetForPool()
    if (this.available.length >= this.maxSize) {
      view.destroy()
      return
    }
    this.available.push(view)
    this.availableSet.add(view)
  }

  destroy(): void {
    for (const view of this.available) {
      view.destroy()
    }
    this.available.length = 0
    this.availableSet.clear()
  }
}
