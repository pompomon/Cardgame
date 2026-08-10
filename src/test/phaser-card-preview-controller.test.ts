import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({
  default: {
    GameObjects: {
      Events: {
        DESTROY: 'destroy',
      },
    },
    Math: {
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  },
}))

import { createCardPreviewController } from '../renderers/phaser/card-preview-controller'
import { buildLayout } from '../renderers/phaser/layout'

type Listener = (...args: unknown[]) => void

class FakeContainer {
  readonly listeners = new Map<string, Listener[]>()
  input: unknown = null

  setDepth(): this {
    return this
  }

  setInteractive(): this {
    this.input = {}
    return this
  }

  setPosition(): this {
    return this
  }

  setScale(): this {
    return this
  }

  setSize(): this {
    return this
  }

  add(): this {
    return this
  }

  destroy(): void {
    this.emit('destroy')
  }

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  once(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.off(event, wrapped)
      listener(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event)
    if (!listeners) {
      return this
    }
    const remaining = listeners.filter((entry) => entry !== listener)
    if (remaining.length === 0) {
      this.listeners.delete(event)
    } else {
      this.listeners.set(event, remaining)
    }
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args)
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0
  }
}

function createHarness(): {
  readonly card: FakeContainer
  readonly input: FakeContainer
  readonly renderCard: ReturnType<typeof vi.fn>
  readonly controller: ReturnType<typeof createCardPreviewController>
} {
  const input = new FakeContainer()
  const renderCard = vi.fn(() => new FakeContainer())
  type ControllerOptions = Parameters<typeof createCardPreviewController>[0]
  const controller = createCardPreviewController({
    scene: {
      add: {
        container: () => new FakeContainer(),
      },
      input,
    } as unknown as ControllerOptions['scene'],
    getRoot: () => new FakeContainer() as unknown as ReturnType<ControllerOptions['getRoot']>,
    getLayout: () => buildLayout(1024, 768, 'horizontal'),
    getContext: () => ({ phase: 'main', pendingPlayLandTargetSelection: false, menuOpen: false }),
    renderCard: renderCard as unknown as ControllerOptions['renderCard'],
  })
  const card = new FakeContainer()
  controller.bind(card as unknown as Parameters<typeof controller.bind>[0], 'Forest')
  return { card, input, renderCard, controller }
}

describe('createCardPreviewController', () => {
  it('requires a fresh pointer down after pointerout before pinning a card preview', () => {
    const { card, renderCard, controller } = createHarness()

    card.emit('pointerover', { wasTouch: false })
    card.emit('pointerdown', { wasCanceled: false, x: 10, y: 10 })
    card.emit('pointerout')
    card.emit('pointerover', { wasTouch: false })
    expect(renderCard).toHaveBeenCalledTimes(2)

    card.emit('pointerup', { wasCanceled: false, x: 10, y: 10 })
    expect(renderCard).toHaveBeenCalledTimes(2)

    card.emit('pointerdown', { wasCanceled: false, x: 10, y: 10 })
    card.emit('pointerup', { wasCanceled: false, x: 10, y: 10 })
    expect(renderCard).toHaveBeenCalledTimes(3)

    controller.destroy()
  })

  it('removes its scene listener idempotently and ignores binds after destroy', () => {
    const { controller, input } = createHarness()
    const lateCard = new FakeContainer()
    expect(input.listenerCount('pointerdown')).toBe(1)

    controller.destroy()
    controller.destroy()
    controller.bind(lateCard as never, 'Island')

    expect(input.listenerCount('pointerdown')).toBe(0)
    expect(lateCard.listeners.size).toBe(0)
  })
})
