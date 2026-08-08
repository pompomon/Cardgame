import type Phaser from 'phaser'
import { BOARD_BACKGROUND_VARIANTS } from '../../app/board-assets'
import { BOARD_THEMES, type BoardTheme } from '../../app/board-theme'
import type { RenderQualityPreference } from '../../app/render-quality'
import {
  AMBIENCE_ATLAS_FRAMES,
  boardAmbienceTextureKey,
  boardBackgroundTextureKey,
  boardBackgroundVariantsForQuality,
} from './asset-manifest'
import { DEPTH_BOARD_AMBIENCE, DEPTH_BOARD_BACKGROUND } from './depth'
import { clamp } from './layout'
import { resolveBoardAmbiencePolicy, type BoardAmbiencePolicy } from './quality'
import { computeCoverCrop, type CoverCrop } from './rounded-cover'

const BACKGROUND_ALPHA = 0.9
const FALLBACK_COLORS: Readonly<Record<BoardTheme, number>> = Object.freeze({
  classic: 0x2b174f,
  moonlit: 0x101f46,
  verdant: 0x173d32,
})

export interface BoardBackgroundFit extends CoverCrop {
  readonly scale: number
}

export interface BoardBackgroundSyncOptions {
  readonly theme: BoardTheme
  readonly quality: RenderQualityPreference
  readonly width: number
  readonly height: number
  readonly animationsEnabled: boolean
  readonly reducedMotion: boolean
  readonly pageVisible: boolean
}

interface AmbienceEntry {
  readonly image: Phaser.GameObjects.Image
  readonly xRatio: number
  readonly yRatio: number
  readonly phase: number
}

function normalizeDimension(value: number, fallback = 1): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function computeBoardBackgroundFit(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): BoardBackgroundFit {
  const safeSourceWidth = normalizeDimension(sourceWidth)
  const safeSourceHeight = normalizeDimension(sourceHeight)
  const safeTargetWidth = normalizeDimension(targetWidth)
  const safeTargetHeight = normalizeDimension(targetHeight)
  return {
    ...computeCoverCrop(
      safeSourceWidth,
      safeSourceHeight,
      safeTargetWidth,
      safeTargetHeight,
    ),
    scale: Math.max(
      safeTargetWidth / safeSourceWidth,
      safeTargetHeight / safeSourceHeight,
    ),
  }
}

function textureSourceSize(
  scene: Phaser.Scene,
  key: string,
  image: Phaser.GameObjects.Image,
): { width: number; height: number } {
  const source = scene.textures.get(key).getSourceImage() as
    | { width?: unknown; height?: unknown }
    | null
  return {
    width: normalizeDimension(
      typeof source?.width === 'number' ? source.width : Number.NaN,
      normalizeDimension(image.width),
    ),
    height: normalizeDimension(
      typeof source?.height === 'number' ? source.height : Number.NaN,
      normalizeDimension(image.height),
    ),
  }
}

function ambienceRatios(index: number): Pick<AmbienceEntry, 'xRatio' | 'yRatio' | 'phase'> {
  return {
    xRatio: ((index * 37 + 13) % 97) / 96,
    yRatio: ((index * 53 + 29) % 89) / 88,
    phase: index * 0.83,
  }
}

export class BoardBackgroundView {
  private readonly scene: Phaser.Scene
  private readonly fallback: Phaser.GameObjects.Rectangle
  private readonly ambienceLayer: Phaser.GameObjects.Container
  private background: Phaser.GameObjects.Image | null = null
  private currentBackgroundKey: string | null = null
  private currentAmbienceKey: string | null = null
  private readonly ambienceEntries: AmbienceEntry[] = []
  private visibleAmbienceCount = 0
  private ambiencePolicy: BoardAmbiencePolicy = {
    maxSprites: 0,
    alpha: 0,
    driftPixels: 0,
    speed: 0,
  }
  private width = 1
  private height = 1
  private lastUpdateTime = 0
  private destroyed = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.fallback = scene.add.rectangle(0, 0, 1, 1, FALLBACK_COLORS.classic)
      .setDepth(DEPTH_BOARD_BACKGROUND)
    this.ambienceLayer = scene.add.container(0, 0)
      .setDepth(DEPTH_BOARD_AMBIENCE)
  }

  sync(options: BoardBackgroundSyncOptions): void {
    if (this.destroyed) {
      return
    }
    this.width = normalizeDimension(options.width)
    this.height = normalizeDimension(options.height)
    this.fallback
      .setPosition(this.width / 2, this.height / 2)
      .setDisplaySize(this.width, this.height)
      .setFillStyle(FALLBACK_COLORS[options.theme])
      .setDepth(DEPTH_BOARD_BACKGROUND)

    this.syncBackground(options.theme, options.quality)
    this.syncAmbience(options)
    this.evictInactiveTextures()
  }

  update(time: number): void {
    if (this.destroyed || this.visibleAmbienceCount === 0) {
      return
    }
    this.lastUpdateTime = Number.isFinite(time) ? time : this.lastUpdateTime
    for (let index = 0; index < this.visibleAmbienceCount; index += 1) {
      this.positionAmbienceEntry(this.ambienceEntries[index], index)
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.background?.destroy()
    this.background = null
    this.fallback.destroy()
    this.ambienceLayer.destroy(true)
    this.visibleAmbienceCount = 0
    this.removeAllOwnedTextures()
    this.currentBackgroundKey = null
    this.currentAmbienceKey = null
  }

  private syncBackground(theme: BoardTheme, quality: RenderQualityPreference): void {
    let nextKey: string | null = null
    for (const variant of boardBackgroundVariantsForQuality(quality)) {
      const key = boardBackgroundTextureKey(theme, variant)
      if (this.scene.textures.exists(key)) {
        nextKey = key
        break
      }
    }

    if (nextKey !== null) {
      if (!this.background) {
        this.background = this.scene.add.image(0, 0, nextKey)
          .setOrigin(0.5)
          .setAlpha(BACKGROUND_ALPHA)
      } else if (nextKey !== this.currentBackgroundKey) {
        this.background.setTexture(nextKey)
      }
      this.currentBackgroundKey = nextKey
    } else if (
      this.currentBackgroundKey !== null
      && !this.scene.textures.exists(this.currentBackgroundKey)
    ) {
      this.background?.setVisible(false)
      this.currentBackgroundKey = null
    }

    if (!this.background || this.currentBackgroundKey === null) {
      return
    }

    const source = textureSourceSize(this.scene, this.currentBackgroundKey, this.background)
    const fit = computeBoardBackgroundFit(
      source.width,
      source.height,
      this.width,
      this.height,
    )
    this.background
      .setVisible(true)
      .setPosition(this.width / 2, this.height / 2)
      .setScale(fit.scale)
      .setCrop(
        fit.sourceX,
        fit.sourceY,
        fit.sourceWidth,
        fit.sourceHeight,
      )
      .setDepth(DEPTH_BOARD_BACKGROUND)
  }

  private syncAmbience(options: BoardBackgroundSyncOptions): void {
    this.ambiencePolicy = resolveBoardAmbiencePolicy(options)
    const nextAtlasKey = boardAmbienceTextureKey(options.theme)
    const atlasAvailable = this.scene.textures.exists(nextAtlasKey)
      && AMBIENCE_ATLAS_FRAMES.every((frame) =>
        this.scene.textures.get(nextAtlasKey).has(frame),
      )
    const desiredCount = atlasAvailable ? this.ambiencePolicy.maxSprites : 0

    if (atlasAvailable) {
      for (let index = 0; index < this.ambienceEntries.length; index += 1) {
        this.ambienceEntries[index].image.setTexture(
          nextAtlasKey,
          AMBIENCE_ATLAS_FRAMES[index % AMBIENCE_ATLAS_FRAMES.length],
        )
      }
      this.currentAmbienceKey = nextAtlasKey
    }

    while (this.ambienceEntries.length < desiredCount) {
      const index = this.ambienceEntries.length
      const ratios = ambienceRatios(index)
      const image = this.scene.add.image(
        0,
        0,
        nextAtlasKey,
        AMBIENCE_ATLAS_FRAMES[index % AMBIENCE_ATLAS_FRAMES.length],
      ).setOrigin(0.5)
      this.ambienceLayer.add(image)
      this.ambienceEntries.push({ image, ...ratios })
    }

    this.visibleAmbienceCount = desiredCount
    this.ambienceLayer.setVisible(desiredCount > 0).setDepth(DEPTH_BOARD_AMBIENCE)
    const shortEdge = Math.min(this.width, this.height)
    for (let index = 0; index < this.ambienceEntries.length; index += 1) {
      const entry = this.ambienceEntries[index]
      const visible = index < desiredCount
      entry.image.setVisible(visible)
      if (!visible) {
        continue
      }
      const isGlow = index % AMBIENCE_ATLAS_FRAMES.length === 1
      const size = clamp(shortEdge * (isGlow ? 0.12 : 0.045), 18, isGlow ? 76 : 42)
      entry.image
        .setDisplaySize(size, size)
        .setAlpha(this.ambiencePolicy.alpha * (isGlow ? 0.65 : 1))
      this.positionAmbienceEntry(entry, index)
    }
  }

  private positionAmbienceEntry(entry: AmbienceEntry, index: number): void {
    const drift = this.ambiencePolicy.driftPixels
    const phase = this.lastUpdateTime * this.ambiencePolicy.speed + entry.phase
    entry.image.setPosition(
      clamp(entry.xRatio * this.width + Math.sin(phase) * drift, 0, this.width),
      clamp(
        entry.yRatio * this.height + Math.cos(phase * 0.83 + index) * drift,
        0,
        this.height,
      ),
    )
  }

  private evictInactiveTextures(): void {
    for (const theme of BOARD_THEMES) {
      for (const variant of BOARD_BACKGROUND_VARIANTS) {
        const key = boardBackgroundTextureKey(theme, variant)
        if (key !== this.currentBackgroundKey && this.scene.textures.exists(key)) {
          this.scene.textures.remove(key)
        }
      }
      const ambienceKey = boardAmbienceTextureKey(theme)
      if (ambienceKey !== this.currentAmbienceKey && this.scene.textures.exists(ambienceKey)) {
        this.scene.textures.remove(ambienceKey)
      }
    }
  }

  private removeAllOwnedTextures(): void {
    for (const theme of BOARD_THEMES) {
      for (const variant of BOARD_BACKGROUND_VARIANTS) {
        const key = boardBackgroundTextureKey(theme, variant)
        if (this.scene.textures.exists(key)) {
          this.scene.textures.remove(key)
        }
      }
      const ambienceKey = boardAmbienceTextureKey(theme)
      if (this.scene.textures.exists(ambienceKey)) {
        this.scene.textures.remove(ambienceKey)
      }
    }
  }
}
