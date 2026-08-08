import { describe, expect, it, vi } from 'vitest'

import type { BoardTheme } from '../app/board-theme'
import type { AppViewModel, RenderQualityPreference } from '../app/types'
import {
  BoardBackgroundView,
  computeBoardCoverFit,
  MAX_BOARD_AMBIENCE_SPRITES,
  resolveBoardAmbiencePolicy,
  type PageVisibilitySource,
} from '../renderers/phaser/board-background'
import { buildLayout, orientationFromViewport } from '../renderers/phaser/layout'

type MockFunction = ReturnType<typeof vi.fn>

interface DisplayObjectDouble {
  textureKey: string
  setOrigin: MockFunction
  setScrollFactor: MockFunction
  setDepth: MockFunction
  clearTint: MockFunction
  setVisible: MockFunction
  setPosition: MockFunction
  setScale: MockFunction
  setCrop: MockFunction
  setTexture: MockFunction
  setDisplaySize: MockFunction
  setTint: MockFunction
  setAlpha: MockFunction
  destroy: MockFunction
}

interface TweenDouble {
  paused: boolean
  pause: MockFunction
  resume: MockFunction
  isPaused: MockFunction
  remove: MockFunction
}

function createDisplayObject(textureKey: string): DisplayObjectDouble {
  let display: DisplayObjectDouble
  const chain = vi.fn(() => display)
  display = {
    textureKey,
    setOrigin: vi.fn(() => display),
    setScrollFactor: vi.fn(() => display),
    setDepth: vi.fn(() => display),
    clearTint: vi.fn(() => display),
    setVisible: vi.fn(() => display),
    setPosition: vi.fn(() => display),
    setScale: vi.fn(() => display),
    setCrop: vi.fn(() => display),
    setTexture: vi.fn((key: string) => {
      display.textureKey = key
      return display
    }),
    setDisplaySize: vi.fn(() => display),
    setTint: vi.fn(() => display),
    setAlpha: vi.fn(() => display),
    destroy: chain,
  }
  return display
}

function createTween(): TweenDouble {
  const tween: TweenDouble = {
    paused: false,
    pause: vi.fn(() => {
      tween.paused = true
      return tween
    }),
    resume: vi.fn(() => {
      tween.paused = false
      return tween
    }),
    isPaused: vi.fn(() => tween.paused),
    remove: vi.fn(() => tween),
  }
  return tween
}

function createVisibilityHarness(initialHidden = false): {
  readonly source: PageVisibilitySource
  readonly addListener: MockFunction
  readonly removeListener: MockFunction
  listenerCount(): number
  emit(hidden: boolean): void
} {
  let hidden = initialHidden
  const listeners = new Set<() => void>()
  const addListener = vi.fn((_type: string, listener: () => void) => {
    listeners.add(listener)
  })
  const removeListener = vi.fn((_type: string, listener: () => void) => {
    listeners.delete(listener)
  })
  return {
    source: {
      get hidden() {
        return hidden
      },
      addEventListener: addListener,
      removeEventListener: removeListener,
    },
    addListener,
    removeListener,
    listenerCount: () => listeners.size,
    emit: (nextHidden) => {
      hidden = nextHidden
      for (const listener of [...listeners]) {
        listener()
      }
    },
  }
}

function createSceneHarness(): {
  readonly scene: unknown
  readonly images: DisplayObjectDouble[]
  readonly sprites: DisplayObjectDouble[]
  readonly tweens: TweenDouble[]
  readonly removeTexture: MockFunction
  addTexture(key: string, width: number, height: number): void
  hasTexture(key: string): boolean
} {
  const textureSizes = new Map<string, { readonly width: number; readonly height: number }>()
  textureSizes.set('__WHITE', { width: 1, height: 1 })
  const images: DisplayObjectDouble[] = []
  const sprites: DisplayObjectDouble[] = []
  const tweens: TweenDouble[] = []
  const removeTexture = vi.fn((key: string) => {
    textureSizes.delete(key)
  })
  const scene = {
    add: {
      image: vi.fn((_x: number, _y: number, key: string) => {
        const image = createDisplayObject(key)
        images.push(image)
        return image
      }),
      sprite: vi.fn((_x: number, _y: number, key: string) => {
        const sprite = createDisplayObject(key)
        sprites.push(sprite)
        return sprite
      }),
    },
    textures: {
      exists: vi.fn((key: string) => textureSizes.has(key)),
      get: vi.fn((key: string) => ({
        getSourceImage: () => textureSizes.get(key) ?? null,
      })),
      remove: removeTexture,
    },
    tweens: {
      add: vi.fn(() => {
        const tween = createTween()
        tweens.push(tween)
        return tween
      }),
    },
  }
  return {
    scene,
    images,
    sprites,
    tweens,
    removeTexture,
    addTexture: (key, width, height) => {
      textureSizes.set(key, { width, height })
    },
    hasTexture: (key) => textureSizes.has(key),
  }
}

function view(
  boardTheme: BoardTheme,
  renderQualityPreference: RenderQualityPreference,
  animationSpeed: AppViewModel['animationSpeed'] = 'normal',
): AppViewModel {
  return {
    boardTheme,
    renderQualityPreference,
    animationSpeed,
  } as AppViewModel
}

function layout(width: number, height: number) {
  return buildLayout(width, height, orientationFromViewport(width, height))
}

describe('Phaser retained board background', () => {
  it('computes centered cover-fit crops for landscape, portrait, wide, and high-DPR sizes', () => {
    expect(computeBoardCoverFit(1920, 1080, 1280, 720)).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 1920,
      sourceHeight: 1080,
      scale: 2 / 3,
    })

    const portrait = computeBoardCoverFit(1920, 1080, 390, 844)
    expect(portrait.sourceY).toBe(0)
    expect(portrait.sourceHeight).toBe(1080)
    expect(portrait.sourceWidth * portrait.scale).toBeCloseTo(390)
    expect(portrait.sourceHeight * portrait.scale).toBeCloseTo(844)
    expect(portrait.sourceX).toBeCloseTo(
      (1920 - portrait.sourceWidth) / 2,
    )

    const wide = computeBoardCoverFit(1920, 1080, 2560, 720)
    expect(wide.sourceX).toBe(0)
    expect(wide.sourceWidth).toBe(1920)
    expect(wide.sourceHeight * wide.scale).toBeCloseTo(720)
    expect(wide.sourceY).toBeCloseTo((1080 - wide.sourceHeight) / 2)

    const highDpr = computeBoardCoverFit(1920, 1080, 390 * 3, 844 * 3)
    expect(highDpr.sourceX).toBeCloseTo(portrait.sourceX)
    expect(highDpr.sourceWidth).toBeCloseTo(portrait.sourceWidth)
    expect(highDpr.scale).toBeCloseTo(portrait.scale * 3)

    const normalized = computeBoardCoverFit(Number.NaN, -1, 0, Infinity)
    expect(Object.values(normalized).every(Number.isFinite)).toBe(true)
  })

  it('bounds ambience by quality, phone size, reduced motion, and page visibility', () => {
    expect(resolveBoardAmbiencePolicy('high', 1280, 820, false, false))
      .toEqual({ spriteCount: MAX_BOARD_AMBIENCE_SPRITES })
    expect(resolveBoardAmbiencePolicy('high', 390, 844, false, false))
      .toEqual({ spriteCount: 5 })
    expect(resolveBoardAmbiencePolicy('auto', 390, 844, false, false))
      .toEqual({ spriteCount: 3 })
    expect(resolveBoardAmbiencePolicy('balanced', 1280, 820, false, false))
      .toEqual({ spriteCount: 6 })
    expect(resolveBoardAmbiencePolicy('low', 1280, 820, false, false))
      .toEqual({ spriteCount: 0 })
    expect(resolveBoardAmbiencePolicy('high', 1280, 820, true, false))
      .toEqual({ spriteCount: 0 })
    expect(resolveBoardAmbiencePolicy('high', 1280, 820, false, true))
      .toEqual({ spriteCount: 0 })
  })

  it('retains layers across repeated syncs, resize, and a theme change', () => {
    const harness = createSceneHarness()
    const visibility = createVisibilityHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    harness.addTexture('board-atlas:ambience:classic', 128, 64)
    const board = new BoardBackgroundView(
      harness.scene as never,
      visibility.source,
    )
    const desktop = layout(1280, 820)
    const classic = view('classic', 'high')

    board.sync(classic, desktop)
    for (let index = 0; index < 100; index += 1) {
      board.sync(classic, desktop)
    }

    expect(harness.images).toHaveLength(1)
    expect(harness.sprites).toHaveLength(MAX_BOARD_AMBIENCE_SPRITES)
    expect(harness.tweens).toHaveLength(MAX_BOARD_AMBIENCE_SPRITES)
    expect(harness.images[0].setTexture)
      .toHaveBeenCalledTimes(1)
    expect(harness.images[0].setTexture)
      .toHaveBeenCalledWith('board-background:classic:hd')

    const portrait = layout(390, 844)
    const expectedCrop = computeBoardCoverFit(1920, 1080, 390, 844)
    board.resize(portrait)
    expect(harness.images).toHaveLength(1)
    expect(harness.images[0].setPosition)
      .toHaveBeenLastCalledWith(195, 422)
    expect(harness.images[0].setCrop).toHaveBeenLastCalledWith(
      expectedCrop.sourceX,
      expectedCrop.sourceY,
      expectedCrop.sourceWidth,
      expectedCrop.sourceHeight,
    )

    harness.addTexture('board-background:moonlit:balanced', 1280, 720)
    harness.addTexture('board-atlas:ambience:moonlit', 128, 64)
    board.sync(view('moonlit', 'balanced'), portrait)

    expect(harness.images).toHaveLength(1)
    expect(harness.sprites).toHaveLength(MAX_BOARD_AMBIENCE_SPRITES)
    expect(harness.images[0].setTexture)
      .toHaveBeenLastCalledWith('board-background:moonlit:balanced')
    expect(harness.sprites[0].setTexture)
      .toHaveBeenLastCalledWith('board-atlas:ambience:moonlit', 'ambient-mote')
    expect(harness.hasTexture('board-background:classic:hd')).toBe(false)
    expect(harness.hasTexture('board-atlas:ambience:classic')).toBe(false)
  })

  it('pauses and resumes existing ambience without allocating new objects', () => {
    const harness = createSceneHarness()
    const visibility = createVisibilityHarness()
    harness.addTexture('board-background:verdant:hd', 1920, 1080)
    harness.addTexture('board-atlas:ambience:verdant', 128, 64)
    const board = new BoardBackgroundView(
      harness.scene as never,
      visibility.source,
    )
    const desktop = layout(1280, 820)

    board.sync(view('verdant', 'high'), desktop)
    const createdSprites = harness.sprites.length
    const createdTweens = harness.tweens.length
    board.sync(view('verdant', 'low'), desktop)
    expect(harness.sprites.every((sprite) =>
      sprite.setVisible.mock.lastCall?.[0] === false
    )).toBe(true)
    expect(harness.tweens.every((tween) => tween.paused)).toBe(true)

    board.sync(view('verdant', 'high', 'off'), desktop)
    expect(harness.tweens.every((tween) => tween.paused)).toBe(true)

    board.sync(view('verdant', 'high'), desktop)
    expect(harness.tweens.every((tween) => !tween.paused)).toBe(true)
    visibility.emit(true)
    expect(harness.tweens.every((tween) => tween.paused)).toBe(true)
    visibility.emit(false)
    expect(harness.tweens.every((tween) => !tween.paused)).toBe(true)
    expect(harness.sprites).toHaveLength(createdSprites)
    expect(harness.tweens).toHaveLength(createdTweens)
  })

  it('uses the themed procedural fallback when textures are unavailable', () => {
    const harness = createSceneHarness()
    const board = new BoardBackgroundView(harness.scene as never, null)

    board.sync(view('moonlit', 'high'), layout(844, 390))

    expect(harness.images).toHaveLength(1)
    expect(harness.images[0].textureKey).toBe('__WHITE')
    expect(harness.images[0].setDisplaySize)
      .toHaveBeenLastCalledWith(844, 390)
    expect(harness.images[0].setTint)
      .toHaveBeenLastCalledWith(0x101a38)
    expect(harness.sprites).toHaveLength(0)
  })

  it('cleans up textures, tweens, objects, and visibility listeners idempotently', () => {
    const harness = createSceneHarness()
    const visibility = createVisibilityHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    harness.addTexture('board-atlas:ambience:classic', 128, 64)
    const board = new BoardBackgroundView(
      harness.scene as never,
      visibility.source,
    )
    board.sync(view('classic', 'high'), layout(1280, 820))

    board.destroy()
    board.destroy()

    expect(visibility.listenerCount()).toBe(0)
    expect(visibility.removeListener).toHaveBeenCalledTimes(1)
    expect(harness.images[0].destroy).toHaveBeenCalledTimes(1)
    expect(harness.sprites.every((sprite) =>
      sprite.destroy.mock.calls.length === 1
    )).toBe(true)
    expect(harness.tweens.every((tween) =>
      tween.remove.mock.calls.length === 1
    )).toBe(true)
    expect(harness.hasTexture('board-background:classic:hd')).toBe(false)
    expect(harness.hasTexture('board-atlas:ambience:classic')).toBe(false)
  })
})
