import type Phaser from 'phaser'
import { describe, expect, it } from 'vitest'
import {
  BoardBackgroundView,
  computeCoverFitCrop,
  MAX_BOARD_AMBIENCE_SPRITES,
  resolveBoardAmbiencePolicy,
} from '../renderers/phaser/board-background'
import { AMBIENCE_ATLAS_FRAMES } from '../renderers/phaser/asset-manifest'

class FakeImage {
  x = 0
  y = 0
  scaleX = 1
  scaleY = 1
  alpha = 1
  visible = true
  depth = 0
  destroyed = false
  crop: { x: number; y: number; width: number; height: number } | null = null
  textureKey: string
  frame: string | number | undefined

  constructor(textureKey: string, frame: string | number | undefined) {
    this.textureKey = textureKey
    this.frame = frame
  }

  setOrigin(): this {
    return this
  }

  setDepth(depth: number): this {
    this.depth = depth
    return this
  }

  setVisible(visible: boolean): this {
    this.visible = visible
    return this
  }

  setTexture(textureKey: string, frame?: string | number): this {
    this.textureKey = textureKey
    this.frame = frame
    return this
  }

  setAlpha(alpha: number): this {
    this.alpha = alpha
    return this
  }

  setPosition(x: number, y: number): this {
    this.x = x
    this.y = y
    return this
  }

  setScale(x: number, y = x): this {
    this.scaleX = x
    this.scaleY = y
    return this
  }

  setCrop(x: number, y: number, width: number, height: number): this {
    this.crop = { x, y, width, height }
    return this
  }

  destroy(): void {
    this.destroyed = true
  }
}

class FakeRectangle {
  x = 0
  y = 0
  width = 1
  height = 1
  fillColor = 0
  depth = 0
  destroyed = false

  setOrigin(): this {
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

  setFillStyle(fillColor: number): this {
    this.fillColor = fillColor
    return this
  }

  destroy(): void {
    this.destroyed = true
  }
}

class FakeEvents {
  private readonly listeners = new Map<string, Set<(...args: number[]) => void>>()

  on(event: string, listener: (...args: number[]) => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event: string, listener: (...args: number[]) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string, ...args: number[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args)
    }
  }

  count(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

class FakeTextures {
  private readonly sources = new Map<string, { width: number; height: number }>()
  private readonly frames = new Map<string, Set<string>>()
  readonly removed: string[] = []

  constructor() {
    this.add('__WHITE', 1, 1)
  }

  add(
    key: string,
    width: number,
    height: number,
    frames: readonly string[] = [],
  ): void {
    this.sources.set(key, { width, height })
    this.frames.set(key, new Set(frames))
  }

  exists(key: string): boolean {
    return this.sources.has(key)
  }

  get(key: string): {
    getSourceImage(): { width: number; height: number } | null
    has(frame: string): boolean
  } {
    return {
      getSourceImage: () => this.sources.get(key) ?? null,
      has: (frame) => this.frames.get(key)?.has(frame) ?? false,
    }
  }

  remove(key: string): void {
    this.sources.delete(key)
    this.frames.delete(key)
    this.removed.push(key)
  }
}

function createSceneHarness(): {
  readonly scene: Phaser.Scene
  readonly images: FakeImage[]
  readonly rectangles: FakeRectangle[]
  readonly events: FakeEvents
  readonly textures: FakeTextures
} {
  const images: FakeImage[] = []
  const rectangles: FakeRectangle[] = []
  const events = new FakeEvents()
  const textures = new FakeTextures()
  const scene = {
    add: {
      image: (
        _x: number,
        _y: number,
        textureKey: string,
        frame?: string | number,
      ) => {
        const image = new FakeImage(textureKey, frame)
        images.push(image)
        return image
      },
      rectangle: (
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        fillColor: number,
      ) => {
        const rectangle = new FakeRectangle()
        rectangle.fillColor = fillColor
        rectangles.push(rectangle)
        return rectangle
      },
    },
    events,
    textures,
  } as unknown as Phaser.Scene
  return { scene, images, rectangles, events, textures }
}

describe('Phaser board background cover fit', () => {
  it('fills landscape, portrait, narrow, wide, and high-DPR viewports', () => {
    const sourceWidth = 1920
    const sourceHeight = 1080
    const viewports = [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
      { width: 320, height: 900 },
      { width: 2000, height: 500 },
      { width: 1170, height: 2532 },
    ]

    for (const viewport of viewports) {
      const crop = computeCoverFitCrop(
        sourceWidth,
        sourceHeight,
        viewport.width,
        viewport.height,
      )
      expect(crop.width * crop.scale).toBeCloseTo(viewport.width)
      expect(crop.height * crop.scale).toBeCloseTo(viewport.height)
      expect(crop.x).toBeGreaterThanOrEqual(0)
      expect(crop.y).toBeGreaterThanOrEqual(0)
      expect(crop.x + crop.width).toBeLessThanOrEqual(sourceWidth)
      expect(crop.y + crop.height).toBeLessThanOrEqual(sourceHeight)
    }
  })

  it('normalizes invalid dimensions to finite positive crop values', () => {
    const crop = computeCoverFitCrop(Number.NaN, -1, 0, Number.POSITIVE_INFINITY)
    expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1, scale: 1 })
  })
})

describe('Phaser board ambience policy', () => {
  it('bounds desktop and phone ambience by quality', () => {
    const base = {
      animationSpeed: 'normal' as const,
      reducedMotion: false,
      pageVisible: true,
    }
    expect(resolveBoardAmbiencePolicy({
      ...base,
      quality: 'high',
      width: 1280,
      height: 820,
    }).visibleSpriteCount).toBe(MAX_BOARD_AMBIENCE_SPRITES)
    expect(resolveBoardAmbiencePolicy({
      ...base,
      quality: 'high',
      width: 390,
      height: 844,
    }).visibleSpriteCount).toBe(MAX_BOARD_AMBIENCE_SPRITES / 2)
    expect(resolveBoardAmbiencePolicy({
      ...base,
      quality: 'balanced',
      width: 1280,
      height: 820,
    }).visibleSpriteCount).toBe(MAX_BOARD_AMBIENCE_SPRITES / 2)
    expect(resolveBoardAmbiencePolicy({
      ...base,
      quality: 'auto',
      width: 390,
      height: 844,
    }).visibleSpriteCount).toBe(MAX_BOARD_AMBIENCE_SPRITES / 4)
  })

  it.each([
    { quality: 'low' as const, animationSpeed: 'normal' as const, reducedMotion: false, pageVisible: true },
    { quality: 'high' as const, animationSpeed: 'off' as const, reducedMotion: false, pageVisible: true },
    { quality: 'high' as const, animationSpeed: 'normal' as const, reducedMotion: true, pageVisible: true },
    { quality: 'high' as const, animationSpeed: 'normal' as const, reducedMotion: false, pageVisible: false },
  ])('disables ambience for constrained environment %#', (environment) => {
    expect(resolveBoardAmbiencePolicy({
      ...environment,
      width: 1280,
      height: 820,
    })).toEqual({ visibleSpriteCount: 0, animated: false })
  })
})

describe('BoardBackgroundView', () => {
  const classicBackground = 'board-background:classic:hd'
  const moonlitBackground = 'board-background:moonlit:balanced'
  const classicAmbience = 'board-atlas:ambience:classic'
  const moonlitAmbience = 'board-atlas:ambience:moonlit'
  const visibleEnvironment = { reducedMotion: false, pageVisible: true }

  it('retains display objects across unchanged syncs and resizes them in place', () => {
    const harness = createSceneHarness()
    harness.textures.add(classicBackground, 1920, 1080)
    harness.textures.add(classicAmbience, 128, 64, AMBIENCE_ATLAS_FRAMES)
    const view = new BoardBackgroundView(harness.scene)
    const settings = {
      boardTheme: 'classic' as const,
      renderQualityPreference: 'high' as const,
      animationSpeed: 'normal' as const,
    }
    const assets = { textureKey: classicBackground, settled: true }

    view.sync(settings, { width: 1280, height: 720 }, assets, visibleEnvironment)
    const retainedImages = [...harness.images]
    const background = harness.images[0]
    expect(harness.images).toHaveLength(1 + MAX_BOARD_AMBIENCE_SPRITES)
    expect(background.textureKey).toBe(classicBackground)
    expect(background.crop).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })

    view.sync(settings, { width: 390, height: 844 }, assets, visibleEnvironment)
    expect(harness.images).toEqual(retainedImages)
    expect(harness.images[0]).toBe(background)
    expect(background.x).toBe(195)
    expect(background.y).toBe(422)
    expect(background.crop?.width).toBeLessThan(1920)
    expect(harness.rectangles[0]).toMatchObject({ width: 390, height: 844 })
  })

  it('switches themes in place, reuses ambience, and evicts the old large texture', () => {
    const harness = createSceneHarness()
    harness.textures.add(classicBackground, 1920, 1080)
    harness.textures.add(classicAmbience, 128, 64, AMBIENCE_ATLAS_FRAMES)
    harness.textures.add(moonlitAmbience, 128, 64, AMBIENCE_ATLAS_FRAMES)
    const view = new BoardBackgroundView(harness.scene)

    view.sync({
      boardTheme: 'classic',
      renderQualityPreference: 'high',
      animationSpeed: 'normal',
    }, { width: 1280, height: 720 }, {
      textureKey: classicBackground,
      settled: true,
    }, visibleEnvironment)
    const retainedImages = [...harness.images]
    const background = harness.images[0]
    harness.textures.add(moonlitBackground, 1280, 720)

    view.sync({
      boardTheme: 'moonlit',
      renderQualityPreference: 'balanced',
      animationSpeed: 'normal',
    }, { width: 1280, height: 720 }, {
      textureKey: moonlitBackground,
      settled: true,
    }, visibleEnvironment)

    expect(harness.images).toEqual(retainedImages)
    expect(background.textureKey).toBe(moonlitBackground)
    expect(harness.textures.removed).toContain(classicBackground)
    for (const image of harness.images.slice(1)) {
      expect(image.textureKey).toBe(moonlitAmbience)
    }
  })

  it('keeps the old texture while a switch loads, then falls back cleanly after failure', () => {
    const harness = createSceneHarness()
    harness.textures.add(classicBackground, 1920, 1080)
    const view = new BoardBackgroundView(harness.scene)
    const background = harness.images[0]

    view.sync({
      boardTheme: 'classic',
      renderQualityPreference: 'low',
      animationSpeed: 'normal',
    }, { width: 1280, height: 720 }, {
      textureKey: classicBackground,
      settled: true,
    }, visibleEnvironment)
    view.sync({
      boardTheme: 'verdant',
      renderQualityPreference: 'low',
      animationSpeed: 'normal',
    }, { width: 1280, height: 720 }, {
      textureKey: null,
      settled: false,
    }, visibleEnvironment)
    expect(background.textureKey).toBe(classicBackground)
    expect(background.visible).toBe(true)

    view.sync({
      boardTheme: 'verdant',
      renderQualityPreference: 'low',
      animationSpeed: 'normal',
    }, { width: 1280, height: 720 }, {
      textureKey: null,
      settled: true,
    }, visibleEnvironment)
    expect(background.textureKey).toBe('__WHITE')
    expect(background.visible).toBe(false)
    expect(harness.textures.removed).toContain(classicBackground)
  })

  it('pauses hidden or reduced-motion ambience without reallocating sprites', () => {
    const harness = createSceneHarness()
    harness.textures.add(classicBackground, 1920, 1080)
    harness.textures.add(classicAmbience, 128, 64, AMBIENCE_ATLAS_FRAMES)
    const view = new BoardBackgroundView(harness.scene)
    const settings = {
      boardTheme: 'classic' as const,
      renderQualityPreference: 'high' as const,
      animationSpeed: 'normal' as const,
    }
    const assets = { textureKey: classicBackground, settled: true }

    view.sync(settings, { width: 1280, height: 720 }, assets, visibleEnvironment)
    const retainedImages = [...harness.images]
    harness.events.emit('update', 0, 50)

    view.sync(settings, { width: 1280, height: 720 }, assets, {
      reducedMotion: false,
      pageVisible: false,
    })
    expect(harness.images.slice(1).every((image) => !image.visible)).toBe(true)
    const hiddenPosition = { x: harness.images[1].x, y: harness.images[1].y }
    harness.events.emit('update', 50, 50)
    expect(harness.images[1]).toMatchObject(hiddenPosition)

    view.sync(settings, { width: 1280, height: 720 }, assets, {
      reducedMotion: true,
      pageVisible: true,
    })
    expect(harness.images).toEqual(retainedImages)
    expect(harness.images.slice(1).every((image) => !image.visible)).toBe(true)
  })

  it('removes its update listener, objects, and texture idempotently', () => {
    const harness = createSceneHarness()
    harness.textures.add(classicBackground, 1920, 1080)
    harness.textures.add(classicAmbience, 128, 64, AMBIENCE_ATLAS_FRAMES)
    const view = new BoardBackgroundView(harness.scene)
    view.sync({
      boardTheme: 'classic',
      renderQualityPreference: 'balanced',
      animationSpeed: 'normal',
    }, { width: 1280, height: 720 }, {
      textureKey: classicBackground,
      settled: true,
    }, visibleEnvironment)
    expect(harness.events.count('update')).toBe(1)

    view.destroy()
    view.destroy()

    expect(harness.events.count('update')).toBe(0)
    expect(harness.images.every((image) => image.destroyed)).toBe(true)
    expect(harness.rectangles.every((rectangle) => rectangle.destroyed)).toBe(true)
    expect(harness.textures.removed.filter((key) => key === classicBackground)).toHaveLength(1)
  })
})
