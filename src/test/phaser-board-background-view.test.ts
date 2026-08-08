import { describe, expect, it, vi } from 'vitest'
import {
  BoardBackgroundView,
  computeBoardBackgroundFit,
  type BoardBackgroundSyncOptions,
} from '../renderers/phaser/board-background'

interface FakeImage {
  key: string
  frame: string | number | undefined
  width: number
  height: number
  visible: boolean
  alpha: number
  depth: number
  setOrigin: ReturnType<typeof vi.fn>
  setAlpha: ReturnType<typeof vi.fn>
  setDepth: ReturnType<typeof vi.fn>
  setVisible: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
  setScale: ReturnType<typeof vi.fn>
  setCrop: ReturnType<typeof vi.fn>
  setTexture: ReturnType<typeof vi.fn>
  setDisplaySize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

interface FakeTexture {
  readonly width: number
  readonly height: number
  readonly frames: ReadonlySet<string>
}

function fakeImage(key: string, frame?: string | number): FakeImage {
  const image: FakeImage = {
    key,
    frame,
    width: 64,
    height: 64,
    visible: true,
    alpha: 1,
    depth: 0,
    setOrigin: vi.fn(),
    setAlpha: vi.fn(),
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    setPosition: vi.fn(),
    setScale: vi.fn(),
    setCrop: vi.fn(),
    setTexture: vi.fn(),
    setDisplaySize: vi.fn(),
    destroy: vi.fn(),
  }
  image.setOrigin.mockImplementation(() => image)
  image.setAlpha.mockImplementation((alpha: number) => {
    image.alpha = alpha
    return image
  })
  image.setDepth.mockImplementation((depth: number) => {
    image.depth = depth
    return image
  })
  image.setVisible.mockImplementation((visible: boolean) => {
    image.visible = visible
    return image
  })
  image.setPosition.mockImplementation(() => image)
  image.setScale.mockImplementation(() => image)
  image.setCrop.mockImplementation(() => image)
  image.setTexture.mockImplementation((nextKey: string, nextFrame?: string | number) => {
    image.key = nextKey
    image.frame = nextFrame
    return image
  })
  image.setDisplaySize.mockImplementation(() => image)
  return image
}

function createHarness(): {
  readonly scene: never
  readonly images: FakeImage[]
  readonly fallback: {
    setPosition: ReturnType<typeof vi.fn>
    setDisplaySize: ReturnType<typeof vi.fn>
    setFillStyle: ReturnType<typeof vi.fn>
    setDepth: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  readonly ambienceLayer: {
    add: ReturnType<typeof vi.fn>
    setDepth: ReturnType<typeof vi.fn>
    setVisible: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  readonly textures: Map<string, FakeTexture>
  readonly removeTexture: ReturnType<typeof vi.fn>
  addTexture(key: string, width: number, height: number, frames?: readonly string[]): void
} {
  const images: FakeImage[] = []
  const textures = new Map<string, FakeTexture>()
  const fallback = {
    setPosition: vi.fn(),
    setDisplaySize: vi.fn(),
    setFillStyle: vi.fn(),
    setDepth: vi.fn(),
    destroy: vi.fn(),
  }
  fallback.setPosition.mockImplementation(() => fallback)
  fallback.setDisplaySize.mockImplementation(() => fallback)
  fallback.setFillStyle.mockImplementation(() => fallback)
  fallback.setDepth.mockImplementation(() => fallback)
  const ambienceLayer = {
    add: vi.fn(),
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    destroy: vi.fn(),
  }
  ambienceLayer.add.mockImplementation(() => ambienceLayer)
  ambienceLayer.setDepth.mockImplementation(() => ambienceLayer)
  ambienceLayer.setVisible.mockImplementation(() => ambienceLayer)
  const removeTexture = vi.fn((key: string) => {
    textures.delete(key)
  })
  const scene = {
    add: {
      rectangle: vi.fn(() => fallback),
      container: vi.fn(() => ambienceLayer),
      image: vi.fn((_x: number, _y: number, key: string, frame?: string | number) => {
        const image = fakeImage(key, frame)
        const texture = textures.get(key)
        if (texture) {
          image.width = texture.width
          image.height = texture.height
        }
        images.push(image)
        return image
      }),
    },
    textures: {
      exists: (key: string) => textures.has(key),
      get: (key: string) => ({
        getSourceImage: () => {
          const texture = textures.get(key)
          return texture
            ? { width: texture.width, height: texture.height }
            : null
        },
        has: (frame: string) => textures.get(key)?.frames.has(frame) ?? false,
      }),
      remove: removeTexture,
    },
  }
  return {
    scene: scene as never,
    images,
    fallback,
    ambienceLayer,
    textures,
    removeTexture,
    addTexture: (key, width, height, frames = []) => {
      textures.set(key, {
        width,
        height,
        frames: new Set(frames),
      })
    },
  }
}

const BALANCED_OPTIONS: BoardBackgroundSyncOptions = {
  theme: 'classic',
  quality: 'balanced',
  width: 1280,
  height: 720,
  animationsEnabled: true,
  reducedMotion: false,
  pageVisible: true,
}

function addClassicAssets(harness: ReturnType<typeof createHarness>): void {
  harness.addTexture('board-background:classic:balanced', 1280, 720)
  harness.addTexture(
    'board-atlas:ambience:classic',
    128,
    64,
    ['ambient-mote', 'ambient-glow'],
  )
}

describe('retained Phaser board background', () => {
  it('computes centered cover crops for landscape, portrait, wide, and high-resolution targets', () => {
    expect(computeBoardBackgroundFit(1920, 1080, 1280, 720)).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 1920,
      sourceHeight: 1080,
      scale: 2 / 3,
    })

    const portrait = computeBoardBackgroundFit(1920, 1080, 390, 844)
    expect(portrait.sourceX).toBeCloseTo(710.45, 1)
    expect(portrait.sourceY).toBe(0)
    expect(portrait.sourceWidth).toBeCloseTo(499.05, 1)
    expect(portrait.sourceHeight).toBe(1080)

    const wide = computeBoardBackgroundFit(1920, 1080, 2560, 720)
    expect(wide.sourceX).toBe(0)
    expect(wide.sourceY).toBe(270)
    expect(wide.sourceWidth).toBe(1920)
    expect(wide.sourceHeight).toBe(540)

    const highResolution = computeBoardBackgroundFit(1920, 1080, 1170, 2532)
    expect(Number.isFinite(highResolution.scale)).toBe(true)
    expect(highResolution.sourceX).toBeGreaterThan(0)
    expect(highResolution.sourceX + highResolution.sourceWidth).toBeLessThanOrEqual(1920)
    expect(highResolution.sourceHeight).toBe(1080)
  })

  it('retains display objects across unchanged syncs, animation frames, and resize', () => {
    const harness = createHarness()
    addClassicAssets(harness)
    const view = new BoardBackgroundView(harness.scene)

    view.sync(BALANCED_OPTIONS)
    expect(harness.images).toHaveLength(7)
    const background = harness.images[0]
    const ambience = harness.images.slice(1)

    view.sync(BALANCED_OPTIONS)
    view.update(1000)
    view.sync({ ...BALANCED_OPTIONS, width: 844, height: 390 })
    view.update(2000)

    expect(harness.images).toHaveLength(7)
    expect(harness.images[0]).toBe(background)
    expect(harness.images.slice(1)).toEqual(ambience)
    expect(background.setCrop).toHaveBeenCalledTimes(3)
    expect(background.setScale).toHaveBeenLastCalledWith(844 / 1280)
    expect(ambience.slice(0, 3).every((image) =>
      image.setPosition.mock.calls.length >= 5
    )).toBe(true)
    expect(ambience.slice(3).every((image) =>
      image.setPosition.mock.calls.length >= 3
    )).toBe(true)
  })

  it('switches themes in place and evicts superseded theme textures', () => {
    const harness = createHarness()
    addClassicAssets(harness)
    const view = new BoardBackgroundView(harness.scene)
    view.sync(BALANCED_OPTIONS)
    const retainedImages = [...harness.images]

    harness.addTexture('board-background:moonlit:balanced', 1280, 720)
    harness.addTexture(
      'board-atlas:ambience:moonlit',
      128,
      64,
      ['ambient-mote', 'ambient-glow'],
    )
    view.sync({ ...BALANCED_OPTIONS, theme: 'moonlit' })

    expect(harness.images).toEqual(retainedImages)
    expect(harness.images[0].setTexture)
      .toHaveBeenCalledWith('board-background:moonlit:balanced')
    expect(harness.images.slice(1).every((image) =>
      image.key === 'board-atlas:ambience:moonlit'
    )).toBe(true)
    expect(harness.textures.has('board-background:classic:balanced')).toBe(false)
    expect(harness.textures.has('board-atlas:ambience:classic')).toBe(false)
    expect(harness.removeTexture).toHaveBeenCalledWith('board-background:classic:balanced')
  })

  it('reuses a bounded ambience pool and disables it for low quality, reduced motion, and hidden pages', () => {
    const harness = createHarness()
    addClassicAssets(harness)
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    const view = new BoardBackgroundView(harness.scene)

    view.sync({ ...BALANCED_OPTIONS, quality: 'high' })
    expect(harness.images).toHaveLength(13)
    expect(harness.images.slice(1).filter((image) => image.visible)).toHaveLength(12)

    view.sync({ ...BALANCED_OPTIONS, quality: 'low' })
    expect(harness.images).toHaveLength(13)
    expect(harness.ambienceLayer.setVisible).toHaveBeenLastCalledWith(false)
    expect(harness.images.slice(1).some((image) => image.visible)).toBe(false)

    view.sync({ ...BALANCED_OPTIONS, quality: 'high', reducedMotion: true })
    expect(harness.ambienceLayer.setVisible).toHaveBeenLastCalledWith(false)
    view.sync({ ...BALANCED_OPTIONS, quality: 'high', pageVisible: false })
    expect(harness.ambienceLayer.setVisible).toHaveBeenLastCalledWith(false)
    view.sync({ ...BALANCED_OPTIONS, quality: 'high', animationsEnabled: false })
    expect(harness.ambienceLayer.setVisible).toHaveBeenLastCalledWith(false)
    expect(harness.images).toHaveLength(13)
  })

  it('falls back procedurally and cleans up objects and owned textures idempotently', () => {
    const harness = createHarness()
    const view = new BoardBackgroundView(harness.scene)
    view.sync(BALANCED_OPTIONS)

    expect(harness.images).toHaveLength(0)
    expect(harness.fallback.setFillStyle).toHaveBeenCalled()

    addClassicAssets(harness)
    view.sync(BALANCED_OPTIONS)
    const background = harness.images[0]
    view.destroy()
    view.destroy()
    view.sync(BALANCED_OPTIONS)
    view.update(1000)

    expect(background.destroy).toHaveBeenCalledTimes(1)
    expect(harness.fallback.destroy).toHaveBeenCalledTimes(1)
    expect(harness.ambienceLayer.destroy).toHaveBeenCalledTimes(1)
    expect(harness.ambienceLayer.destroy).toHaveBeenCalledWith(true)
    expect(harness.textures.size).toBe(0)
    expect(harness.images).toHaveLength(7)
  })
})
