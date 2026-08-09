import { describe, expect, it, vi } from 'vitest'

vi.mock('../renderers/phaser/card-factory', () => ({
  renderStaticCard: vi.fn(),
}))

import { HIDDEN_HAND_CARD_NAME } from '../app/types'
import {
  cardFaceTextureSignature,
  cardMoveDurationMs,
  shouldAnimateCardDragEnd,
  shouldResolveCardDrop,
  type CardViewDescriptor,
} from '../renderers/phaser/card-view'
import { CardViewRegistry } from '../renderers/phaser/card-view-registry'
import { buildLayout } from '../renderers/phaser/layout'
import { withFakeTimers } from './helpers/timers'

type Listener = (...args: unknown[]) => void

class FakeDataManager {
  readonly values = new Map<string, unknown>()

  set(key: string, value: unknown): void {
    this.values.set(key, value)
  }

  get(key: string): unknown {
    return this.values.get(key)
  }

  reset(): this {
    this.values.clear()
    return this
  }
}

class FakeHitArea {
  width: number
  height: number

  constructor(
    width: number,
    height: number,
  ) {
    this.width = width
    this.height = height
  }

  setSize(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }
}

class FakeContainer {
  readonly data = new FakeDataManager()
  readonly children: FakeContainer[] = []
  readonly listeners = new Map<string, Listener[]>()
  readonly childDestroyListeners = new Map<FakeContainer, Listener>()
  parentContainer: FakeContainer | null = null
  input: {
    enabled: boolean
    draggable: boolean
    hitArea: FakeHitArea
  } | null = null
  removedInteractiveCount = 0
  destroyed = false
  visible = true
  alpha = 1
  depth = 0
  scaleX = 1
  scaleY = 1
  rotation = 0
  x = 0
  y = 0
  width = 0
  height = 0

  add(child: FakeContainer | FakeContainer[]): this {
    for (const entry of Array.isArray(child) ? child : [child]) {
      entry.parentContainer?.remove(entry, false)
      entry.parentContainer = this
      this.children.push(entry)
      const onDestroy = (): void => {
        this.remove(entry, false)
      }
      entry.on('destroy', onDestroy)
      this.childDestroyListeners.set(entry, onDestroy)
    }
    return this
  }

  remove(child: FakeContainer, destroyChild = false): this {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
      const onDestroy = this.childDestroyListeners.get(child)
      if (onDestroy) {
        child.off('destroy', onDestroy)
        this.childDestroyListeners.delete(child)
      }
      child.parentContainer = null
      if (destroyChild) {
        child.destroy(true)
      }
    }
    return this
  }

  removeAll(destroyChildren = false): this {
    for (const child of [...this.children]) {
      this.remove(child, destroyChildren)
    }
    return this
  }

  moveTo(child: FakeContainer, index: number): this {
    const currentIndex = this.children.indexOf(child)
    if (currentIndex < 0) {
      return this
    }
    this.children.splice(currentIndex, 1)
    this.children.splice(Math.max(0, Math.min(index, this.children.length)), 0, child)
    return this
  }

  bringToTop(child: FakeContainer): this {
    return this.moveTo(child, this.children.length - 1)
  }

  sort(property: 'depth'): this {
    this.children.sort((first, second) => first[property] - second[property])
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

  setDepth(depth: number): this {
    this.depth = depth
    return this
  }

  setScale(x: number, y = x): this {
    this.scaleX = x
    this.scaleY = y
    return this
  }

  setRotation(rotation: number): this {
    this.rotation = rotation
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

  setData(key: string, value: unknown): this {
    this.data.set(key, value)
    return this
  }

  getData(key: string): unknown {
    return this.data.get(key)
  }

  setInteractive(): this {
    if (this.input) {
      this.input.enabled = true
    } else {
      this.input = {
        enabled: true,
        draggable: false,
        hitArea: new FakeHitArea(this.width, this.height),
      }
    }
    return this
  }

  disableInteractive(): this {
    if (this.input) {
      this.input.enabled = false
    }
    return this
  }

  removeInteractive(): this {
    this.removedInteractiveCount += 1
    this.input = null
    return this
  }

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
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

  removeAllListeners(event?: string): this {
    if (event === undefined) {
      this.listeners.clear()
    } else {
      this.listeners.delete(event)
    }
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args)
    }
  }

  listenerCount(): number {
    let count = 0
    for (const listeners of this.listeners.values()) {
      count += listeners.length
    }
    return count
  }

  destroy(destroyChildren = true): void {
    if (this.destroyed) {
      return
    }
    this.emit('destroy', this)
    this.removeAll(destroyChildren)
    this.destroyed = true
  }
}

interface Harness {
  readonly scene: {
    readonly add: { container: () => FakeContainer }
    readonly input: {
      setDraggable: (container: FakeContainer, value?: boolean) => void
    }
    readonly textures: { exists: (key: string) => boolean }
    readonly tweens: {
      add: (config: {
        targets: FakeContainer
        x: number
        y: number
        duration: number
        onComplete?: () => void
      }) => { remove: () => void }
    }
  }
  readonly root: FakeContainer
  readonly createdContainers: FakeContainer[]
  readonly renderedFaces: Array<FakeContainer & { renderedLabel: string }>
  readonly renderCard: ReturnType<typeof vi.fn>
  readonly bindPreview: ReturnType<typeof vi.fn>
  readonly tweenCount: () => number
  readonly textures: Set<string>
}

function createHarness(): Harness {
  const createdContainers: FakeContainer[] = []
  const renderedFaces: Array<FakeContainer & { renderedLabel: string }> = []
  const textures = new Set<string>()
  let tweenCount = 0
  const scene = {
    add: {
      container: () => {
        const container = new FakeContainer()
        createdContainers.push(container)
        return container
      },
    },
    input: {
      setDraggable: (container: FakeContainer, value = true) => {
        container.input ??= {
          enabled: value,
          draggable: value,
          hitArea: new FakeHitArea(container.width, container.height),
        }
        container.input.enabled = value
        container.input.draggable = value
      },
    },
    textures: {
      exists: (key: string) => textures.has(key),
    },
    tweens: {
      add: (config: {
        targets: FakeContainer
        x: number
        y: number
        duration: number
        onComplete?: () => void
      }) => {
        tweenCount += 1
        const timer = setTimeout(() => {
          config.onComplete?.()
        }, config.duration)
        return {
          remove: () => {
            clearTimeout(timer)
          },
        }
      },
    },
  }
  const renderCard = vi.fn((
    _scene: unknown,
    _layout: unknown,
    _x: number,
    _y: number,
    label: string,
  ) => {
    const face = Object.assign(new FakeContainer(), { renderedLabel: label })
    renderedFaces.push(face)
    return face
  })
  return {
    scene,
    root: new FakeContainer(),
    createdContainers,
    renderedFaces,
    renderCard,
    bindPreview: vi.fn((card: FakeContainer) => {
      card.on('pointerover', () => {})
    }),
    tweenCount: () => tweenCount,
    textures,
  }
}

const layout = buildLayout(1280, 720, 'horizontal')

function descriptor(
  cardId: string,
  overrides: Partial<CardViewDescriptor> = {},
): CardViewDescriptor {
  return {
    cardId,
    instanceId: null,
    playerIndex: 0,
    zone: 'hand',
    name: 'Forest',
    x: 100,
    y: 600,
    width: layout.handCardWidth,
    height: layout.handCardHeight,
    highlight: false,
    draggable: false,
    preview: true,
    interactionKey: `preview:${cardId}`,
    ...overrides,
  }
}

function createRegistry(harness: Harness, maxPoolSize?: number): CardViewRegistry {
  return new CardViewRegistry({
    scene: harness.scene as never,
    renderCard: harness.renderCard as never,
    bindPreview: harness.bindPreview as never,
    maxPoolSize,
  })
}

function sync(
  registry: CardViewRegistry,
  harness: Harness,
  descriptors: readonly CardViewDescriptor[],
  animationSpeed: 'off' | 'fast' | 'normal' | 'slow' = 'off',
): void {
  registry.sync(descriptors, {
    root: harness.root as never,
    layout,
    visualStyle: 'hd',
    animationSpeed,
  })
}

describe('Phaser retained card views', () => {
  it('reconciles create, update, remove, reorder, and pool reuse by stable card id', () => {
    const harness = createHarness()
    const registry = createRegistry(harness)
    const first = descriptor('card-a')
    const second = descriptor('card-b', { x: 200 })

    sync(registry, harness, [first, second])
    const firstContainer = registry.get('card-a')!.container
    const secondContainer = registry.get('card-b')!.container
    expect(registry.activeCount).toBe(2)
    expect(harness.renderCard).toHaveBeenCalledTimes(2)

    for (let index = 0; index < 100; index += 1) {
      sync(registry, harness, [first, second])
    }
    expect(registry.get('card-a')!.container).toBe(firstContainer)
    expect(registry.get('card-b')!.container).toBe(secondContainer)
    expect(harness.createdContainers).toHaveLength(3)
    expect(harness.renderCard).toHaveBeenCalledTimes(2)

    sync(registry, harness, [second, first])
    expect((registry.layer as unknown as FakeContainer).children).toEqual([
      secondContainer,
      firstContainer,
    ])

    sync(registry, harness, [second, descriptor('card-c', { name: 'Island' })])
    expect(registry.get('card-c')!.container).toBe(firstContainer)
    expect(registry.get('card-a')).toBeNull()
    expect(registry.activeCount).toBe(2)
    expect(registry.pooledCount).toBe(0)
    expect(harness.renderCard).toHaveBeenCalledTimes(3)
  })

  it('keeps one outer view across a hand-to-battlefield move and lands exactly at the tween target', () => {
    withFakeTimers(() => {
      const harness = createHarness()
      const registry = createRegistry(harness)
      sync(registry, harness, [descriptor('stable-card', { x: 80, y: 600 })], 'normal')
      const view = registry.get('stable-card')!
      const container = view.container as unknown as FakeContainer

      sync(registry, harness, [descriptor('stable-card', {
        instanceId: 'battlefield-instance-7',
        zone: 'battlefield',
        x: 420,
        y: 350,
        interactionKey: 'preview:battlefield:stable-card',
      })], 'normal')
      sync(registry, harness, [descriptor('stable-card', {
        instanceId: 'battlefield-instance-7',
        zone: 'battlefield',
        x: 420,
        y: 350,
        interactionKey: 'preview:battlefield:stable-card',
      })], 'normal')

      expect(registry.get('stable-card')!.container).toBe(container)
      expect(harness.tweenCount()).toBe(1)
      expect(container.x).toBe(80)
      vi.advanceTimersByTime(cardMoveDurationMs('normal'))
      expect(container.x).toBe(420)
      expect(container.y).toBe(350)
      expect(container.getData('instanceId')).toBe('battlefield-instance-7')
      expect(container.getData('zone')).toBe('battlefield')
      registry.destroy()
    })
  })

  it('fully resets pooled views so hidden-hand content and input cannot leak on reuse', () => {
    const harness = createHarness()
    const registry = createRegistry(harness)
    sync(registry, harness, [descriptor('hidden-card', {
      name: HIDDEN_HAND_CARD_NAME,
      draggable: true,
      interactionKey: 'drag:hidden-card',
    })])
    const hiddenView = registry.get('hidden-card')!
    const container = hiddenView.container as unknown as FakeContainer
    const hiddenFace = harness.renderedFaces[0]
    container.setAlpha(0.3).setDepth(99).setScale(1.5).setRotation(0.5)

    expect(harness.renderCard.mock.calls[0][4]).toBe(HIDDEN_HAND_CARD_NAME)
    sync(registry, harness, [])

    expect(registry.pooledCount).toBe(1)
    expect(container.visible).toBe(false)
    expect(container.alpha).toBe(1)
    expect(container.depth).toBe(0)
    expect(container.scaleX).toBe(1)
    expect(container.rotation).toBe(0)
    expect(container.children).toEqual([])
    expect(container.data.values.size).toBe(0)
    expect(container.listeners.get('destroy')).toHaveLength(1)
    expect(container.listenerCount()).toBe(1)
    expect(container.input).toMatchObject({
      enabled: false,
      draggable: false,
      hitArea: { width: 0, height: 0 },
    })
    expect(container.removedInteractiveCount).toBe(0)
    expect(hiddenFace.destroyed).toBe(true)

    sync(registry, harness, [descriptor('public-card', { name: 'Island' })])
    expect(registry.get('public-card')!.container).toBe(container)
    expect(harness.renderCard.mock.calls.at(-1)?.[4]).toBe('Island')
    expect(container.getData('cardId')).toBe('public-card')
    expect([...container.data.values.values()]).not.toContain(HIDDEN_HAND_CARD_NAME)
  })

  it('preserves the Phaser parent lifecycle listener when pool eviction destroys a view', () => {
    const harness = createHarness()
    const registry = createRegistry(harness, 0)
    sync(registry, harness, [descriptor('lifecycle-card', {
      draggable: true,
      interactionKey: 'drag:lifecycle-card',
    })])
    const container = registry.get('lifecycle-card')!.container as unknown as FakeContainer
    const layer = registry.layer as unknown as FakeContainer
    expect(layer.children).toContain(container)

    sync(registry, harness, [])

    expect(container.destroyed).toBe(true)
    expect(layer.children).not.toContain(container)
  })

  it('rebuilds only the face when failed raster art falls back, then stays idempotent', () => {
    const harness = createHarness()
    const registry = createRegistry(harness)
    const primary = 'card-art:hd:Forest'
    const fallback = 'card-art:hd-fallback:Forest'
    harness.textures.add(primary)
    harness.textures.add(fallback)
    const card = descriptor('fallback-card')

    expect(cardFaceTextureSignature('Forest', 'hd', (key) => harness.textures.has(key))).toBe(primary)
    sync(registry, harness, [card])
    const outer = registry.get('fallback-card')!.container
    const primaryFace = harness.renderedFaces[0]

    harness.textures.delete(primary)
    expect(cardFaceTextureSignature('Forest', 'hd', (key) => harness.textures.has(key))).toBe(fallback)
    sync(registry, harness, [card])
    expect(registry.get('fallback-card')!.container).toBe(outer)
    expect(primaryFace.destroyed).toBe(true)
    expect(harness.renderCard).toHaveBeenCalledTimes(2)

    harness.textures.delete(fallback)
    sync(registry, harness, [card])
    sync(registry, harness, [card])
    expect(harness.renderCard).toHaveBeenCalledTimes(3)
  })

  it('requires a fresh pointer down before a pooled view can submit its new action', () => {
    const harness = createHarness()
    const registry = createRegistry(harness)
    sync(registry, harness, [descriptor('dragged-card', {
      draggable: true,
      preview: false,
      interactionKey: 'drag:dragged-card',
    })])
    const container = registry.get('dragged-card')!.container as unknown as FakeContainer
    container.emit('pointerdown', { id: 3 })

    const submitResponse = vi.fn()
    sync(registry, harness, [descriptor('response-card', {
      name: 'Island',
      preview: false,
      onClick: submitResponse,
      interactionKey: 'response:response-card',
    })])
    expect(registry.get('response-card')!.container).toBe(container)

    container.emit('pointerup', { id: 3 })
    expect(submitResponse).not.toHaveBeenCalled()
    container.emit('pointerdown', { id: 4 })
    container.emit('pointerup', { id: 4 })
    expect(submitResponse).toHaveBeenCalledOnce()
  })

  it('rejects canceled and outside click releases before submitting an action', () => {
    const harness = createHarness()
    const registry = createRegistry(harness)
    const submitResponse = vi.fn()
    sync(registry, harness, [descriptor('response-card', {
      preview: false,
      onClick: submitResponse,
      interactionKey: 'response:response-card',
    })])
    const container = registry.get('response-card')!.container as unknown as FakeContainer

    container.emit('pointerdown', { id: 1, wasCanceled: false })
    container.emit('pointerout', { id: 1, wasCanceled: false })
    container.emit('pointerup', { id: 1, wasCanceled: false })
    container.emit('pointerdown', { id: 2, wasCanceled: false })
    container.emit('pointerup', { id: 2, wasCanceled: true })
    container.emit('pointerup', { id: 2, wasCanceled: false })
    expect(submitResponse).not.toHaveBeenCalled()

    container.emit('pointerdown', { id: 3, wasCanceled: false })
    container.emit('pointerup', { id: 3, wasCanceled: false })
    expect(submitResponse).toHaveBeenCalledOnce()
  })

  it('never animates a canceled drag release toward its drop target', () => {
    expect(shouldAnimateCardDragEnd({ wasCanceled: true }, true, false)).toBe(false)
    expect(shouldAnimateCardDragEnd({ wasCanceled: false }, false, false)).toBe(false)
    expect(shouldAnimateCardDragEnd({ wasCanceled: false }, true, true)).toBe(false)
    expect(shouldAnimateCardDragEnd({ wasCanceled: false }, true, false)).toBe(true)
  })

  it('resolves drops only for active, uncanceled drags while the menu is closed', () => {
    expect(shouldResolveCardDrop({ wasCanceled: true }, false, true)).toBe(false)
    expect(shouldResolveCardDrop({ wasCanceled: false }, true, true)).toBe(false)
    expect(shouldResolveCardDrop({ wasCanceled: false }, false, false)).toBe(false)
    expect(shouldResolveCardDrop({ wasCanceled: false }, false, true)).toBe(true)
  })

  it('recreates hit areas after card dimensions change', () => {
    const harness = createHarness()
    const registry = createRegistry(harness)
    const onClick = vi.fn()
    sync(registry, harness, [descriptor('sized-card', {
      preview: false,
      onClick,
      interactionKey: 'click:sized-card',
      width: 80,
      height: 110,
    })])
    const container = registry.get('sized-card')!.container as unknown as FakeContainer
    const input = container.input
    expect(input?.hitArea).toMatchObject({ width: 80, height: 110 })

    sync(registry, harness, [descriptor('sized-card', {
      preview: false,
      onClick,
      interactionKey: 'click:sized-card',
      width: 120,
      height: 160,
    })])
    expect(container.input).toBe(input)
    expect(container.input?.hitArea).toMatchObject({ width: 120, height: 160 })
    expect(container.removedInteractiveCount).toBe(0)
  })

  it('keeps the stable card layer between chrome and modal controls', () => {
    const harness = createHarness()
    const registry = createRegistry(harness)
    const chrome = new FakeContainer()
    const modal = new FakeContainer()
    harness.root.add(chrome)
    sync(registry, harness, [descriptor('layered-card')])
    harness.root.add(modal)
    expect(harness.root.children).toEqual([
      chrome,
      registry.layer,
      modal,
    ])

    harness.root.remove(chrome, true)
    harness.root.remove(modal, true)
    const nextChrome = new FakeContainer()
    const nextModal = new FakeContainer()
    harness.root.add(nextChrome)
    sync(registry, harness, [descriptor('layered-card')])
    harness.root.add(nextModal)
    expect(harness.root.children).toEqual([
      nextChrome,
      registry.layer,
      nextModal,
    ])
  })

  it('defers zone movement during drag and snaps interrupted drags safely', () => {
    withFakeTimers(() => {
      const harness = createHarness()
      const registry = createRegistry(harness)
      const handCard = descriptor('drag-card', {
        draggable: true,
        x: 80,
        y: 600,
        interactionKey: 'drag:drag-card',
      })
      sync(registry, harness, [handCard], 'normal')
      const container = registry.get('drag-card')!.container as unknown as FakeContainer
      registry.beginDrag(container as never)
      expect(registry.isActiveDrag(container as never)).toBe(true)
      container.setPosition(250, 500)

      const battlefieldCard = descriptor('drag-card', {
        instanceId: 'instance-9',
        zone: 'battlefield',
        x: 420,
        y: 350,
        interactionKey: 'preview:battlefield:drag-card',
      })
      sync(registry, harness, [battlefieldCard], 'normal')
      expect(harness.tweenCount()).toBe(0)
      expect(container.x).toBe(250)

      registry.endDrag(container as never, true)
      expect(harness.tweenCount()).toBe(1)
      vi.advanceTimersByTime(cardMoveDurationMs('normal'))
      expect(container.x).toBe(420)
      expect(container.y).toBe(350)

      sync(registry, harness, [handCard], 'off')
      registry.beginDrag(container as never)
      container.setPosition(300, 520)
      sync(registry, harness, [handCard], 'off')
      expect(container.x).toBe(300)
      registry.cancelActiveDrags()
      expect(registry.isActiveDrag(container as never)).toBe(false)
      expect(container.x).toBe(80)
      expect(container.y).toBe(600)
      registry.destroy()
    })
  })

  it('cancels retained resources and destroys active and pooled views idempotently', () => {
    const harness = createHarness()
    const registry = createRegistry(harness)
    sync(registry, harness, [
      descriptor('active-card'),
      descriptor('pooled-card', { x: 200 }),
    ])
    const activeContainer = registry.get('active-card')!.container as unknown as FakeContainer
    const pooledContainer = registry.get('pooled-card')!.container as unknown as FakeContainer
    sync(registry, harness, [descriptor('active-card')])

    registry.destroy()
    registry.destroy()

    expect(activeContainer.destroyed).toBe(true)
    expect(pooledContainer.destroyed).toBe(true)
    expect((registry.layer as unknown as FakeContainer).destroyed).toBe(true)
  })
})
