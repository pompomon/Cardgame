import { describe, expect, it, vi } from 'vitest'
import { HIDDEN_HAND_CARD_NAME } from '../app/types'
import { CardViewRegistry } from '../renderers/phaser/card-view-registry'
import { buildLayout } from '../renderers/phaser/layout'
import { withFakeTimers } from './helpers/timers'

class FakeContainer {
  readonly children: FakeContainer[] = []
  readonly listenersByEvent = new Map<string, unknown[]>()
  readonly dataValues = new Map<string, unknown>()
  readonly data = { reset: () => { this.dataValues.clear() } }
  parentContainer: FakeContainer | null = null
  input: unknown = null
  destroyed = false
  visible = true
  alpha = 1
  scale = 1
  rotation = 0
  depth = 0
  x = 0
  y = 0
  width = 0
  height = 0

  add(child: FakeContainer): this {
    child.parentContainer = this
    this.children.push(child)
    return this
  }

  remove(child: FakeContainer, destroyChild = false): this {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
    }
    child.parentContainer = null
    if (destroyChild) {
      child.destroy(true)
    }
    return this
  }

  removeAll(destroyChildren = false): this {
    for (const child of this.children) {
      child.parentContainer = null
      if (destroyChildren) {
        child.destroy(true)
      }
    }
    this.children.length = 0
    return this
  }

  setDepth(depth: number): this {
    this.depth = depth
    return this
  }

  setPosition(x: number, y: number): this {
    this.x = x
    this.y = y
    return this
  }

  setSize(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }

  setVisible(visible: boolean): this {
    this.visible = visible
    return this
  }

  setAlpha(alpha: number): this {
    this.alpha = alpha
    return this
  }

  setScale(scale: number): this {
    this.scale = scale
    return this
  }

  setRotation(rotation: number): this {
    this.rotation = rotation
    return this
  }

  setData(key: string, value: unknown): this {
    this.dataValues.set(key, value)
    return this
  }

  getData(key: string): unknown {
    return this.dataValues.get(key)
  }

  setInteractive(options: unknown): this {
    this.input = options
    return this
  }

  disableInteractive(): this {
    this.input = null
    return this
  }

  on(event: string, listener: unknown): this {
    const listeners = this.listenersByEvent.get(event) ?? []
    listeners.push(listener)
    this.listenersByEvent.set(event, listeners)
    return this
  }

  removeAllListeners(): this {
    this.listenersByEvent.clear()
    return this
  }

  listenerCount(): number {
    return [...this.listenersByEvent.values()].reduce((sum, listeners) => sum + listeners.length, 0)
  }

  destroy(destroyChildren = false): void {
    this.destroyed = true
    if (destroyChildren) {
      for (const child of this.children) {
        child.destroy(true)
      }
    }
    this.children.length = 0
    this.parentContainer = null
    this.removeAllListeners()
  }
}

function createHarness() {
  const containers: FakeContainer[] = []
  const tweens: Array<{
    targets: FakeContainer
    x: number
    y: number
    duration: number
    onComplete?: () => void
    remove: ReturnType<typeof vi.fn>
  }> = []
  const scene = {
    add: {
      container: () => {
        const container = new FakeContainer()
        containers.push(container)
        return container
      },
    },
    input: {
      setDraggable: vi.fn(),
    },
    tweens: {
      add: vi.fn((config: {
        targets: FakeContainer
        x: number
        y: number
        duration: number
        onComplete?: () => void
      }) => {
        const tween = { ...config, remove: vi.fn() }
        tweens.push(tween)
        return tween
      }),
    },
  }
  const renderCard = vi.fn(() => new FakeContainer() as never)
  const registry = new CardViewRegistry(scene as never, renderCard)
  return {
    scene,
    registry,
    containers,
    tweens,
    renderCard,
    root: new FakeContainer(),
  }
}

const layout = buildLayout(1280, 720, 'horizontal')

function syncForest(registry: CardViewRegistry, overrides: Partial<Parameters<CardViewRegistry['syncCard']>[0]> = {}) {
  return registry.syncCard({
    cardId: 'card-1',
    zone: 'hand',
    label: 'Forest',
    layout,
    visualStyle: 'classic',
    x: 100,
    y: 200,
    width: layout.handCardWidth,
    height: layout.handCardHeight,
    ...overrides,
  })
}

describe('CardViewRegistry', () => {
  it('keeps repeated syncs with the same card id allocation-light and idempotent', () => {
    const { registry, renderCard, root } = createHarness()

    registry.beginFrame(root as never)
    const first = syncForest(registry)
    const second = syncForest(registry)
    registry.endFrame()

    expect(first).toBe(second)
    expect(registry.activeCount()).toBe(1)
    expect(registry.createdCount()).toBe(1)
    expect(renderCard).toHaveBeenCalledOnce()
    expect(root.children).toHaveLength(1)
  })

  it('reorders persistent card views with move tweens and deterministic final positions', () => withFakeTimers(() => {
    const { registry, root, tweens } = createHarness()

    registry.beginFrame(root as never)
    const first = syncForest(registry, { cardId: 'card-1', x: 100, y: 200 })
    const second = syncForest(registry, { cardId: 'card-2', x: 220, y: 200 })
    registry.endFrame()

    registry.beginFrame(root as never)
    syncForest(registry, { cardId: 'card-1', x: 220, y: 200, animate: true })
    syncForest(registry, { cardId: 'card-2', x: 100, y: 200, animate: true })
    registry.endFrame()

    expect(registry.createdCount()).toBe(2)
    expect(tweens).toHaveLength(2)
    tweens.forEach((tween) => { tween.onComplete?.() })
    expect(first?.x).toBe(220)
    expect(second?.x).toBe(100)
  }))

  it('fully resets pooled views before reuse so hidden-card state cannot leak', () => {
    const { registry, root } = createHarness()

    registry.beginFrame(root as never)
    const hidden = syncForest(registry, {
      cardId: 'hidden-card',
      label: HIDDEN_HAND_CARD_NAME,
      draggable: true,
      onClick: () => {},
    }) as unknown as FakeContainer
    hidden.setData('secretName', 'Mountain')
    hidden.setAlpha(0.25)
    registry.endFrame()

    registry.beginFrame(root as never)
    registry.endFrame()

    expect(hidden.parentContainer).toBeNull()
    expect(hidden.input).toBeNull()
    expect(hidden.listenerCount()).toBe(0)
    expect(hidden.getData('secretName')).toBeUndefined()
    expect(registry.pooledCount()).toBe(1)

    registry.beginFrame(root as never)
    const visible = syncForest(registry, { cardId: 'visible-card', label: 'Island' }) as unknown as FakeContainer
    registry.endFrame()

    expect(visible).toBe(hidden)
    expect(visible.alpha).toBe(1)
    expect(visible.input).toBeNull()
    expect(visible.listenerCount()).toBe(0)
    expect(visible.getData('cardId')).toBe('visible-card')
    expect(visible.getData('secretName')).toBeUndefined()
    expect(registry.createdCount()).toBe(1)
  })
})
