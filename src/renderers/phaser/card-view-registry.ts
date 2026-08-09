import type Phaser from 'phaser'
import type { AnimationSpeed, CardVisualStyle } from '../../app/types'
import {
  CardView,
  type CardViewContext,
  type CardViewDescriptor,
} from './card-view'
import { CardViewPool } from './card-view-pool'
import { DEPTH_GAMEPLAY } from './depth'
import type { SceneLayout } from './layout'

export interface CardViewRegistryContext extends CardViewContext {
  readonly maxPoolSize?: number
}

export interface CardViewRegistrySyncOptions {
  readonly root: Phaser.GameObjects.Container
  readonly layout: SceneLayout
  readonly visualStyle: CardVisualStyle
  readonly animationSpeed: AnimationSpeed
}

export class CardViewRegistry {
  readonly layer: Phaser.GameObjects.Container

  private readonly pool: CardViewPool
  private readonly active = new Map<string, CardView>()
  private destroyed = false

  constructor(ctx: CardViewRegistryContext) {
    this.layer = ctx.scene.add.container(0, 0)
    this.layer.setDepth(DEPTH_GAMEPLAY)
    this.pool = new CardViewPool(
      () => new CardView(ctx),
      ctx.maxPoolSize,
    )
  }

  get activeCount(): number {
    return this.active.size
  }

  get pooledCount(): number {
    return this.pool.size
  }

  get(cardId: string): CardView | null {
    return this.active.get(cardId) ?? null
  }

  sync(
    descriptors: readonly CardViewDescriptor[],
    options: CardViewRegistrySyncOptions,
  ): void {
    if (this.destroyed) {
      return
    }

    const desiredIds = new Set<string>()
    for (const descriptor of descriptors) {
      desiredIds.add(descriptor.cardId)
    }
    for (const [cardId, view] of [...this.active]) {
      if (!desiredIds.has(cardId)) {
        this.release(cardId, view)
      }
    }

    const reconciledIds = new Set<string>()
    let displayIndex = 0
    for (const descriptor of descriptors) {
      if (reconciledIds.has(descriptor.cardId)) {
        continue
      }
      reconciledIds.add(descriptor.cardId)

      let view = this.active.get(descriptor.cardId)
      if (!view) {
        view = this.pool.acquire()
        this.active.set(descriptor.cardId, view)
        this.layer.add(view.container)
      } else if (view.container.parentContainer !== this.layer) {
        this.layer.add(view.container)
      }
      view.sync({
        ...descriptor,
        layout: options.layout,
        visualStyle: options.visualStyle,
        animationSpeed: options.animationSpeed,
      })
      this.layer.moveTo(view.container, displayIndex)
      displayIndex += 1
    }

    this.attach(options.root)
  }

  detach(): void {
    const parent = this.layer.parentContainer as Phaser.GameObjects.Container | null
    parent?.remove(this.layer, false)
  }

  reset(): void {
    for (const [cardId, view] of [...this.active]) {
      this.release(cardId, view)
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.detach()
    for (const view of this.active.values()) {
      view.destroy()
    }
    this.active.clear()
    this.pool.destroy()
    this.layer.destroy(true)
  }

  private attach(root: Phaser.GameObjects.Container): void {
    if (this.layer.parentContainer === root) {
      return
    }
    this.detach()
    root.add(this.layer)
  }

  private release(cardId: string, view: CardView): void {
    this.active.delete(cardId)
    if (view.container.parentContainer === this.layer) {
      this.layer.remove(view.container, false)
    }
    this.pool.release(view)
  }
}
