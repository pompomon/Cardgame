import { describe, expect, it, vi } from 'vitest'
import type { BoardTheme } from '../app/board-theme'
import {
  BoardBackgroundView,
  computeCoverFitCrop,
  resolveBoardAmbiencePolicy,
  type BoardBackgroundSyncOptions,
} from '../renderers/phaser/board-background'
import { buildLayout } from '../renderers/phaser/layout'
import { resolvePhaserQualityProfile } from '../renderers/phaser/quality'

class FakeDisplayObject {
  destroyed = false
  visible = true
  x = 0
  y = 0
  alpha = 1
  textureKey: string | null = null
  frame: string | null = null
  crop: [number, number, number, number] | null = null
  displaySize: [number, number] | null = null
  scale: [number, number] | null = null

  setOrigin(): this { return this }
  setDepth(): this { return this }
  setBlendMode(): this { return this }
  setScale(x: number, y = x): this {
    this.scale = [x, y]
    return this
  }
  setPosition(x: number, y: number): this {
    this.x = x
    this.y = y
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

  setTexture(key: string, frame?: string): this {
    this.textureKey = key
    this.frame = frame ?? null
    return this
  }

  setCrop(x: number, y: number, width: number, height: number): this {
    this.crop = [x, y, width, height]
    return this
  }

  setDisplaySize(width: number, height: number): this {
    this.displaySize = [width, height]
    return this
  }

  setSize(width: number, height: number): this {
    this.displaySize = [width, height]
    return this
  }

  setFillStyle(): this { return this }

  destroy(): void {
    this.destroyed = true
  }
}

class FakeContainer extends FakeDisplayObject {
  readonly children: FakeDisplayObject[] = []

  add(child: FakeDisplayObject): this {
    this.children.push(child)
    return this
  }

  override destroy(destroyChildren?: boolean): void {
    this.destroyed = true
    if (destroyChildren) {
      for (const child of this.children) child.destroy()
    }
  }
}

function createSceneHarness(): {
  readonly scene: {
    readonly tweens: {
      readonly add: ReturnType<typeof vi.fn>
    }
  }
  readonly images: FakeDisplayObject[]
  readonly sprites: FakeDisplayObject[]
  readonly containers: FakeContainer[]
  readonly removedTextures: string[]
  readonly tweenRemovals: ReturnType<typeof vi.fn>[]
  addTexture: (key: string, width: number, height: number, frames?: readonly string[]) => void
  textureCount: () => number
} {
  const textureSizes = new Map<string, { width: number; height: number }>()
  const textureFrames = new Map<string, Set<string>>()
  const images: FakeDisplayObject[] = []
  const sprites: FakeDisplayObject[] = []
  const containers: FakeContainer[] = []
  const removedTextures: string[] = []
  const tweenRemovals: ReturnType<typeof vi.fn>[] = []
  const scene = {
    add: {
      container: () => {
        const container = new FakeContainer()
        containers.push(container)
        return container
      },
      rectangle: () => new FakeDisplayObject(),
      image: (_x: number, _y: number, key: string) => {
        const image = new FakeDisplayObject()
        image.setTexture(key)
        images.push(image)
        return image
      },
      sprite: (_x: number, _y: number, key: string, frame: string) => {
        const sprite = new FakeDisplayObject()
        sprite.setTexture(key, frame)
        sprites.push(sprite)
        return sprite
      },
    },
    textures: {
      exists: (key: string) => textureSizes.has(key),
      get: (key: string) => ({
        getSourceImage: () => textureSizes.get(key) ?? { width: 1, height: 1 },
        has: (frame: string) => textureFrames.get(key)?.has(frame) ?? false,
      }),
      remove: (key: string) => {
        removedTextures.push(key)
        textureSizes.delete(key)
        textureFrames.delete(key)
      },
    },
    tweens: {
      add: vi.fn(() => {
        const remove = vi.fn()
        tweenRemovals.push(remove)
        return { remove }
      }),
    },
  }
  return {
    scene,
    images,
    sprites,
    containers,
    removedTextures,
    tweenRemovals,
    addTexture: (key, width, height, frames = []) => {
      textureSizes.set(key, { width, height })
      textureFrames.set(key, new Set(frames))
    },
    textureCount: () => textureSizes.size,
  }
}

const layout = buildLayout(1280, 720, 'horizontal')

function profileFor(
  preference: 'auto' | 'high' | 'balanced' | 'low',
  overrides: { width?: number; height?: number; animationSpeed?: 'off' | 'normal'; documentHidden?: boolean } = {},
) {
  return resolvePhaserQualityProfile({
    preference,
    width: overrides.width ?? 1280,
    height: overrides.height ?? 720,
    animationSpeed: overrides.animationSpeed ?? 'normal',
    documentHidden: overrides.documentHidden,
  })
}

function syncOptions(
  theme: BoardTheme,
  backgroundTextureKey: string | null,
  candidateKeys: readonly string[],
): BoardBackgroundSyncOptions {
  return {
    layout,
    theme,
    profile: profileFor('high'),
    backgroundTextureKey,
    backgroundCandidateKeys: candidateKeys,
  }
}

describe('Phaser board background view', () => {
  it('computes cover-fit crops for portrait, landscape, and invalid source sizes', () => {
    const portrait = computeCoverFitCrop(1920, 1080, 390, 844)
    expect(portrait.height).toBe(1080)
    expect(portrait.width).toBeCloseTo(499.05, 2)
    expect(portrait.x).toBeGreaterThan(700)

    const landscape = computeCoverFitCrop(1024, 1024, 1280, 720)
    expect(landscape.width).toBe(1024)
    expect(landscape.height).toBeCloseTo(576, 4)
    expect(landscape.y).toBeCloseTo(224, 4)

    expect(computeCoverFitCrop(Number.NaN, -1, 0, 0)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('retains one background image across repeated syncs and updates crop in place', () => {
    const harness = createSceneHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    const view = new BoardBackgroundView({ scene: harness.scene as never })

    const options = syncOptions('classic', 'board-background:classic:hd', ['board-background:classic:hd'])
    view.sync(options)
    for (let index = 0; index < 100; index += 1) {
      view.sync(options)
    }

    expect(harness.containers).toHaveLength(1)
    expect(harness.images).toHaveLength(1)
    expect(harness.images[0].textureKey).toBe('board-background:classic:hd')
    expect(harness.images[0].crop).toEqual([0, 0, 1920, 1080])
    expect(harness.images[0].scale).toEqual([layout.width / 1920, layout.height / 1080])
    expect(harness.images[0].displaySize).toBeNull()
  })

  it('scales a portrait crop from its cropped source dimensions', () => {
    const harness = createSceneHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    const view = new BoardBackgroundView({ scene: harness.scene as never })
    const portraitLayout = buildLayout(390, 844, 'vertical')

    view.sync({
      ...syncOptions('classic', 'board-background:classic:hd', ['board-background:classic:hd']),
      layout: portraitLayout,
    })

    const crop = computeCoverFitCrop(1920, 1080, portraitLayout.width, portraitLayout.height)
    expect(harness.images[0].scale).toEqual([
      portraitLayout.width / crop.width,
      portraitLayout.height / crop.height,
    ])
  })

  it('switches the retained image texture and evicts stale large backgrounds', () => {
    const harness = createSceneHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    harness.addTexture('board-background:verdant:balanced', 1280, 720)
    const view = new BoardBackgroundView({ scene: harness.scene as never })

    view.sync(syncOptions('classic', 'board-background:classic:hd', ['board-background:classic:hd']))
    view.sync(syncOptions('verdant', 'board-background:verdant:balanced', ['board-background:verdant:balanced']))

    expect(harness.images).toHaveLength(1)
    expect(harness.images[0].textureKey).toBe('board-background:verdant:balanced')
    expect(harness.removedTextures).toEqual(['board-background:classic:hd'])
  })

  it('keeps one large background resident across repeated theme and tier switches', () => {
    const harness = createSceneHarness()
    const view = new BoardBackgroundView({ scene: harness.scene as never })

    for (let index = 0; index < 25; index += 1) {
      const theme: BoardTheme = index % 2 === 0 ? 'classic' : 'verdant'
      const variant = index % 2 === 0 ? 'hd' : 'balanced'
      const key = `board-background:${theme}:${variant}`
      harness.addTexture(key, 1920, 1080)
      view.sync(syncOptions(theme, key, [key]))
      expect(harness.textureCount()).toBeLessThanOrEqual(1)
    }

    expect(harness.images).toHaveLength(1)
    expect(harness.removedTextures).toHaveLength(24)
    expect(harness.images[0].textureKey).toBe('board-background:classic:hd')
  })

  it('evicts the active large texture and cancels ambience tweens on destroy', () => {
    const harness = createSceneHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    harness.addTexture('board-atlas:ambience:classic', 16, 16, ['ambient-mote'])
    const view = new BoardBackgroundView({ scene: harness.scene as never })

    view.sync(syncOptions('classic', 'board-background:classic:hd', ['board-background:classic:hd']))
    view.destroy()
    view.destroy()

    expect(harness.removedTextures).toEqual(['board-background:classic:hd'])
    expect(harness.tweenRemovals).toHaveLength(8)
    expect(harness.tweenRemovals.every((remove) => remove.mock.calls.length === 1)).toBe(true)
  })

  it('projects ambience from the resolved quality profile', () => {
    expect(resolveBoardAmbiencePolicy(profileFor('high')).spriteCount).toBe(8)
    expect(resolveBoardAmbiencePolicy(profileFor('high', { width: 390, height: 844 })).spriteCount).toBe(4)
    expect(resolveBoardAmbiencePolicy(profileFor('balanced')).spriteCount).toBe(4)
    expect(resolveBoardAmbiencePolicy(profileFor('balanced', { animationSpeed: 'off' })).spriteCount).toBe(0)
    expect(resolveBoardAmbiencePolicy(profileFor('balanced', { documentHidden: true })).spriteCount).toBe(0)
    expect(resolveBoardAmbiencePolicy(profileFor('low')).spriteCount).toBe(0)

    const full = resolveBoardAmbiencePolicy(profileFor('high'))
    const reduced = resolveBoardAmbiencePolicy(profileFor('balanced'))
    expect(full.alpha).toBeGreaterThan(reduced.alpha)
    expect(full.tweenDurationMs).toBeLessThan(reduced.tweenDurationMs)
  })

  it('creates bounded ambience sprites once and removes them when quality disables ambience', () => {
    const harness = createSceneHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    harness.addTexture('board-atlas:ambience:classic', 16, 16, ['ambient-mote'])
    const view = new BoardBackgroundView({ scene: harness.scene as never })
    const options = syncOptions('classic', 'board-background:classic:hd', ['board-background:classic:hd'])

    view.sync(options)
    view.sync(options)

    expect(harness.sprites).toHaveLength(8)
    expect(harness.scene.tweens.add).toHaveBeenCalledTimes(8)

    view.sync({
      ...options,
      profile: profileFor('low'),
    })

    expect(harness.sprites.every((sprite) => sprite.destroyed)).toBe(true)
    expect(harness.tweenRemovals.every((remove) => remove.mock.calls.length === 1)).toBe(true)
  })

  it('reconciles a quality-profile downgrade in place without duplicating retained objects', () => {
    const harness = createSceneHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    harness.addTexture('board-atlas:ambience:classic', 16, 16, ['ambient-mote'])
    const view = new BoardBackgroundView({ scene: harness.scene as never })

    view.sync({
      ...syncOptions('classic', 'board-background:classic:hd', ['board-background:classic:hd']),
      profile: profileFor('high'),
    })

    // The balanced-tier texture only becomes available after the tier switch
    // triggers its load, mirroring the scene's manifest reload.
    harness.addTexture('board-background:classic:balanced', 1280, 720)
    view.sync({
      ...syncOptions('classic', 'board-background:classic:balanced', ['board-background:classic:balanced']),
      profile: profileFor('balanced'),
    })

    expect(harness.containers).toHaveLength(1)
    expect(harness.images).toHaveLength(1)
    expect(harness.images[0].textureKey).toBe('board-background:classic:balanced')
    expect(harness.sprites.filter((sprite) => !sprite.destroyed)).toHaveLength(4)
    expect(harness.removedTextures).toEqual(['board-background:classic:hd'])
  })

  it('keeps the resident background and its texture when a replacement has not loaded yet', () => {
    const harness = createSceneHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    const view = new BoardBackgroundView({ scene: harness.scene as never })

    view.sync(syncOptions('classic', 'board-background:classic:hd', ['board-background:classic:hd']))
    // Theme/tier switch whose replacement PNG is still downloading.
    view.sync(syncOptions('moonlit', null, ['board-background:moonlit:balanced']))

    expect(harness.images).toHaveLength(1)
    expect(harness.images[0].visible).toBe(true)
    expect(harness.images[0].textureKey).toBe('board-background:classic:hd')
    expect(harness.removedTextures).toEqual([])
  })

  it('evicts an older manifest texture that completes after a theme switch', () => {
    const harness = createSceneHarness()
    const view = new BoardBackgroundView({ scene: harness.scene as never })
    const staleKey = 'board-background:classic:hd'
    const activeKey = 'board-background:verdant:balanced'

    view.sync(syncOptions('classic', null, [staleKey]))
    harness.addTexture(activeKey, 1280, 720)
    view.sync(syncOptions('verdant', activeKey, [activeKey]))
    harness.addTexture(staleKey, 1920, 1080)
    view.sync(syncOptions('verdant', activeKey, [activeKey]))

    expect(harness.images[0].textureKey).toBe(activeKey)
    expect(harness.removedTextures).toEqual([staleKey])
  })

  it('evicts a stale in-flight completion during scene cleanup even without another sync', () => {
    const harness = createSceneHarness()
    const view = new BoardBackgroundView({ scene: harness.scene as never })
    const staleKey = 'board-background:classic:hd'
    const activeKey = 'board-background:moonlit:balanced'

    view.sync(syncOptions('classic', null, [staleKey]))
    harness.addTexture(activeKey, 1280, 720)
    view.sync(syncOptions('moonlit', activeKey, [activeKey]))
    harness.addTexture(staleKey, 1920, 1080)
    view.destroy()

    expect(harness.removedTextures).toEqual([staleKey, activeKey])
  })

  it('stops ambience when the page becomes hidden and restores it when visible again', () => {
    const harness = createSceneHarness()
    harness.addTexture('board-background:classic:hd', 1920, 1080)
    harness.addTexture('board-atlas:ambience:classic', 16, 16, ['ambient-mote'])
    const view = new BoardBackgroundView({ scene: harness.scene as never })
    const options = syncOptions('classic', 'board-background:classic:hd', ['board-background:classic:hd'])

    view.sync(options)
    expect(harness.sprites.filter((sprite) => !sprite.destroyed)).toHaveLength(8)

    view.sync({ ...options, profile: profileFor('high', { documentHidden: true }) })
    expect(harness.sprites.filter((sprite) => !sprite.destroyed)).toHaveLength(0)

    view.sync(options)
    expect(harness.sprites.filter((sprite) => !sprite.destroyed)).toHaveLength(8)
  })
})
