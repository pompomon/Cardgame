import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import {
  BoardBackgroundView,
  computeBoardBackgroundFit,
  type BoardBackgroundSyncState,
} from '../renderers/phaser/board-background'

const REPO_ROOT = join(__dirname, '..', '..')

interface FakeImage {
  texture: { key: string }
  frame: string | number | undefined
  visible: boolean
  alpha: number
  x: number
  y: number
  scale: number
  rotation: number
  setOrigin: ReturnType<typeof vi.fn>
  setDepth: ReturnType<typeof vi.fn>
  setVisible: ReturnType<typeof vi.fn>
  setAlpha: ReturnType<typeof vi.fn>
  setTexture: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
  setScale: ReturnType<typeof vi.fn>
  setCrop: ReturnType<typeof vi.fn>
  setRotation: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

interface FakeRectangle {
  setOrigin: ReturnType<typeof vi.fn>
  setDepth: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
  setDisplaySize: ReturnType<typeof vi.fn>
  setFillStyle: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

class FakeVisibilityDocument {
  hidden = false
  private readonly listeners = new Set<() => void>()

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener)
  }

  emit(hidden: boolean): void {
    this.hidden = hidden
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

function createFakeImage(key: string, frame?: string | number): FakeImage {
  const image = {} as FakeImage
  image.texture = { key }
  image.frame = frame
  image.visible = true
  image.alpha = 1
  image.x = 0
  image.y = 0
  image.scale = 1
  image.rotation = 0
  image.setOrigin = vi.fn(() => image)
  image.setDepth = vi.fn(() => image)
  image.setVisible = vi.fn((visible: boolean) => {
    image.visible = visible
    return image
  })
  image.setAlpha = vi.fn((alpha: number) => {
    image.alpha = alpha
    return image
  })
  image.setTexture = vi.fn((textureKey: string, nextFrame?: string | number) => {
    image.texture.key = textureKey
    image.frame = nextFrame
    return image
  })
  image.setPosition = vi.fn((x: number, y: number) => {
    image.x = x
    image.y = y
    return image
  })
  image.setScale = vi.fn((scale: number) => {
    image.scale = scale
    return image
  })
  image.setCrop = vi.fn(() => image)
  image.setRotation = vi.fn((rotation: number) => {
    image.rotation = rotation
    return image
  })
  image.destroy = vi.fn()
  return image
}

function createFakeRectangle(): FakeRectangle {
  const rectangle = {} as FakeRectangle
  rectangle.setOrigin = vi.fn(() => rectangle)
  rectangle.setDepth = vi.fn(() => rectangle)
  rectangle.setPosition = vi.fn(() => rectangle)
  rectangle.setDisplaySize = vi.fn(() => rectangle)
  rectangle.setFillStyle = vi.fn(() => rectangle)
  rectangle.destroy = vi.fn()
  return rectangle
}

function createSceneHarness(initialTextures: Readonly<Record<string, readonly [number, number]>>) {
  const textures = new Map<string, readonly [number, number]>(
    Object.entries(initialTextures),
  )
  const images: FakeImage[] = []
  const rectangle = createFakeRectangle()
  const updateListeners = new Set<(time: number, delta: number) => void>()
  const removedTextures: string[] = []
  const scene = {
    add: {
      rectangle: vi.fn(() => rectangle),
      image: vi.fn((_x: number, _y: number, key: string, frame?: string | number) => {
        const image = createFakeImage(key, frame)
        images.push(image)
        return image
      }),
    },
    events: {
      on: vi.fn((_event: string, listener: (time: number, delta: number) => void) => {
        updateListeners.add(listener)
      }),
      off: vi.fn((_event: string, listener: (time: number, delta: number) => void) => {
        updateListeners.delete(listener)
      }),
    },
    textures: {
      exists: (key: string) => textures.has(key),
      getFrame: (key: string) => {
        const size = textures.get(key)
        if (!size) {
          throw new Error(`Missing texture: ${key}`)
        }
        return { realWidth: size[0], realHeight: size[1] }
      },
      remove: (key: string) => {
        removedTextures.push(key)
        textures.delete(key)
      },
    },
  }
  return {
    scene,
    images,
    rectangle,
    removedTextures,
    addTexture: (key: string, width: number, height: number) => {
      textures.set(key, [width, height])
    },
    emitUpdate: (delta: number) => {
      for (const listener of [...updateListeners]) {
        listener(0, delta)
      }
    },
    updateListenerCount: () => updateListeners.size,
  }
}

function syncState(overrides: Partial<BoardBackgroundSyncState> = {}): BoardBackgroundSyncState {
  return {
    width: 1280,
    height: 720,
    theme: 'classic',
    quality: 'balanced',
    animationSpeed: 'normal',
    reducedMotion: false,
    ...overrides,
  }
}

function visibleAmbience(images: readonly FakeImage[]): FakeImage[] {
  return images.filter((image) =>
    image.texture.key.startsWith('board-atlas:ambience:')
    && image.visible,
  )
}

describe('Phaser retained board background', () => {
  it('computes WebGL-safe cover crops for landscape, portrait, narrow, wide, and high-resolution art', () => {
    expect(computeBoardBackgroundFit(1920, 1080, 1280, 720)).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 1920,
      sourceHeight: 1080,
      scale: 2 / 3,
      centerX: 640,
      centerY: 360,
    })

    const portrait = computeBoardBackgroundFit(1920, 1080, 390, 844)
    expect(portrait.sourceHeight).toBe(1080)
    expect(portrait.sourceWidth).toBeCloseTo(499.05, 2)
    expect(portrait.sourceX).toBeCloseTo(710.47, 2)
    expect(portrait.centerX).toBe(195)
    expect(portrait.centerY).toBe(422)

    const narrow = computeBoardBackgroundFit(1920, 1080, 320, 720)
    expect(narrow.sourceWidth).toBe(480)
    expect(narrow.sourceX).toBe(720)
    expect(narrow.sourceHeight).toBe(1080)

    const wide = computeBoardBackgroundFit(1920, 1080, 1600, 600)
    expect(wide.sourceWidth).toBe(1920)
    expect(wide.sourceHeight).toBe(720)
    expect(wide.sourceY).toBe(180)

    const highResolution = computeBoardBackgroundFit(3840, 2160, 390, 844)
    expect(highResolution.sourceHeight).toBe(2160)
    expect(highResolution.sourceWidth).toBeCloseTo(portrait.sourceWidth * 2, 5)
  })

  it('retains background and ambience objects across unchanged syncs and resize', () => {
    const harness = createSceneHarness({
      'board-background:classic:balanced': [1280, 720],
      'board-atlas:ambience:classic': [128, 64],
    })
    const visibility = new FakeVisibilityDocument()
    const view = new BoardBackgroundView(harness.scene as never, {
      visibilityDocument: visibility,
    })

    view.sync(syncState())
    const createdAfterWarmup = harness.images.length
    const backgroundLayers = harness.images.filter((image) =>
      image.texture.key.startsWith('board-background:'),
    )
    expect(backgroundLayers).toHaveLength(2)
    expect(visibleAmbience(harness.images)).toHaveLength(6)

    for (let index = 0; index < 100; index += 1) {
      view.sync(syncState())
    }
    view.sync(syncState({ width: 844, height: 390 }))

    expect(harness.images).toHaveLength(createdAfterWarmup)
    for (const layer of backgroundLayers) {
      expect(layer.setCrop).toHaveBeenLastCalledWith(
        0,
        64.26540284360192,
        1280,
        591.4691943127962,
      )
      expect(layer.setScale).toHaveBeenLastCalledWith(0.659375)
      expect(layer.setPosition).toHaveBeenLastCalledWith(422, 195)
    }
  })

  it('crossfades a loaded theme in place and evicts the stale large texture', () => {
    const harness = createSceneHarness({
      'board-background:classic:balanced': [1280, 720],
      'board-atlas:ambience:classic': [128, 64],
      'board-atlas:ambience:moonlit': [128, 64],
    })
    const view = new BoardBackgroundView(harness.scene as never, {
      visibilityDocument: new FakeVisibilityDocument(),
    })
    view.sync(syncState())
    harness.addTexture('board-background:moonlit:balanced', 1280, 720)

    view.sync(syncState({ theme: 'moonlit' }))
    expect(harness.images.filter((image) =>
      image.texture.key.startsWith('board-background:'),
    )).toHaveLength(2)
    expect(harness.removedTextures).not.toContain('board-background:classic:balanced')

    harness.emitUpdate(350)

    expect(harness.removedTextures).toContain('board-background:classic:balanced')
    const backgroundLayers = harness.images.slice(0, 2)
    expect(backgroundLayers.every((image) =>
      image.texture.key === 'board-background:moonlit:balanced',
    )).toBe(true)
    expect(backgroundLayers.filter((image) => image.visible)).toHaveLength(1)
  })

  it('disables ambience for reduced motion, low quality, animation off, and hidden pages', () => {
    const harness = createSceneHarness({
      'board-background:classic:hd': [1920, 1080],
      'board-background:classic:low': [960, 540],
      'board-atlas:ambience:classic': [128, 64],
    })
    const visibility = new FakeVisibilityDocument()
    const view = new BoardBackgroundView(harness.scene as never, {
      visibilityDocument: visibility,
    })

    view.sync(syncState({ quality: 'high' }))
    expect(visibleAmbience(harness.images)).toHaveLength(10)

    view.sync(syncState({ quality: 'high', reducedMotion: true }))
    expect(visibleAmbience(harness.images)).toHaveLength(0)

    view.sync(syncState({ quality: 'low' }))
    expect(visibleAmbience(harness.images)).toHaveLength(0)

    view.sync(syncState({ quality: 'high', animationSpeed: 'off' }))
    expect(visibleAmbience(harness.images)).toHaveLength(0)

    view.sync(syncState({ quality: 'high' }))
    visibility.emit(true)
    expect(visibleAmbience(harness.images)).toHaveLength(0)
    visibility.emit(false)
    expect(visibleAmbience(harness.images)).toHaveLength(10)
  })

  it('bounds high-quality ambience on phone viewports', () => {
    const harness = createSceneHarness({
      'board-background:classic:hd': [1920, 1080],
      'board-atlas:ambience:classic': [128, 64],
    })
    const view = new BoardBackgroundView(harness.scene as never, {
      visibilityDocument: new FakeVisibilityDocument(),
    })

    view.sync(syncState({ width: 390, height: 844, quality: 'high' }))

    expect(visibleAmbience(harness.images)).toHaveLength(5)
  })

  it('cleans up scene/document listeners, objects, and large textures idempotently', () => {
    const harness = createSceneHarness({
      'board-background:classic:balanced': [1280, 720],
      'board-atlas:ambience:classic': [128, 64],
    })
    const visibility = new FakeVisibilityDocument()
    const view = new BoardBackgroundView(harness.scene as never, {
      visibilityDocument: visibility,
    })
    view.sync(syncState())
    expect(harness.updateListenerCount()).toBe(1)
    expect(visibility.listenerCount()).toBe(1)

    view.destroy()
    view.destroy()

    expect(harness.updateListenerCount()).toBe(0)
    expect(visibility.listenerCount()).toBe(0)
    expect(harness.rectangle.destroy).toHaveBeenCalledOnce()
    expect(harness.images.every((image) =>
      image.destroy.mock.calls.length === 1,
    )).toBe(true)
    expect(harness.removedTextures).toContain('board-background:classic:balanced')
  })

  it('wires preload, retained sync, and shutdown cleanup through CardgameScene', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'src/renderers/phaser/cardgame-scene.ts'),
      'utf8',
    )
    expect(source).toContain('preloadPhaserBoardAssets(')
    expect(source).toContain('new BoardBackgroundView(this)')
    expect(source).toContain('this.boardBackground?.sync({')
    expect(source).toContain('this.boardBackground?.destroy()')
  })
})
