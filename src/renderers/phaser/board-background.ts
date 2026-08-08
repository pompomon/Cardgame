import type Phaser from 'phaser'
import { BOARD_BACKGROUND_VARIANTS } from '../../app/board-assets'
import {
  BOARD_THEMES,
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from '../../app/board-theme'
import { DEFAULT_RENDER_QUALITY_PREFERENCE } from '../../app/render-quality'
import type { AppViewModel, RenderQualityPreference } from '../../app/types'
import {
  AMBIENCE_ATLAS_FRAMES,
  boardAmbienceAtlasTextureKey,
  boardBackgroundTextureKey,
  buildPhaserBoardAssetManifest,
  resolveLoadedBoardBackgroundTextureKey,
  type PhaserBoardAssetManifest,
} from './asset-manifest'
import { DEPTH_BOARD_AMBIENCE, DEPTH_BOARD_BACKGROUND } from './depth'
import { clamp, type SceneLayout } from './layout'
import { isPhoneSizedViewport } from './quality'
import { computeCoverCrop } from './rounded-cover'

const PHASER_WHITE_TEXTURE_KEY = '__WHITE'
const VISIBILITY_CHANGE_EVENT = 'visibilitychange'

const BOARD_FALLBACK_COLORS: Readonly<Record<BoardTheme, number>> = {
  classic: 0x25174a,
  moonlit: 0x101a38,
  verdant: 0x18342d,
}

const AMBIENCE_POSITIONS = [
  [0.08, 0.16],
  [0.22, 0.72],
  [0.36, 0.32],
  [0.5, 0.82],
  [0.64, 0.2],
  [0.78, 0.62],
  [0.92, 0.38],
  [0.14, 0.48],
  [0.58, 0.52],
  [0.86, 0.86],
] as const

export const MAX_BOARD_AMBIENCE_SPRITES = AMBIENCE_POSITIONS.length

export interface BoardCoverFit {
  readonly sourceX: number
  readonly sourceY: number
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly scale: number
}

export interface BoardAmbiencePolicy {
  readonly spriteCount: number
}

export interface PageVisibilitySource {
  readonly hidden: boolean
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

interface AmbienceEntry {
  readonly sprite: Phaser.GameObjects.Sprite
  readonly tween: Phaser.Tweens.Tween
  active: boolean
}

function positiveDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function computeBoardCoverFit(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): BoardCoverFit {
  const safeSourceWidth = positiveDimension(sourceWidth)
  const safeSourceHeight = positiveDimension(sourceHeight)
  const safeTargetWidth = positiveDimension(targetWidth)
  const safeTargetHeight = positiveDimension(targetHeight)
  const crop = computeCoverCrop(
    safeSourceWidth,
    safeSourceHeight,
    safeTargetWidth,
    safeTargetHeight,
  )
  return {
    ...crop,
    scale: Math.max(
      safeTargetWidth / safeSourceWidth,
      safeTargetHeight / safeSourceHeight,
    ),
  }
}

export function resolveBoardAmbiencePolicy(
  quality: RenderQualityPreference,
  width: number,
  height: number,
  reducedMotion: boolean,
  pageHidden: boolean,
): BoardAmbiencePolicy {
  if (reducedMotion || pageHidden || quality === 'low') {
    return { spriteCount: 0 }
  }
  const phoneSized = isPhoneSizedViewport(width, height)
  switch (quality) {
    case 'high':
      return { spriteCount: phoneSized ? 5 : MAX_BOARD_AMBIENCE_SPRITES }
    case 'auto':
    case 'balanced':
      return { spriteCount: phoneSized ? 3 : 6 }
    default:
      return { spriteCount: phoneSized ? 3 : 6 }
  }
}

function browserVisibilitySource(): PageVisibilitySource | null {
  return typeof document === 'undefined'
    ? null
    : document as PageVisibilitySource
}

function textureSourceDimensions(
  scene: Phaser.Scene,
  key: string,
): { readonly width: number; readonly height: number } | null {
  if (!scene.textures.exists(key)) {
    return null
  }
  const source = scene.textures.get(key).getSourceImage() as {
    readonly width?: unknown
    readonly height?: unknown
  } | null
  if (
    !source
    || typeof source.width !== 'number'
    || typeof source.height !== 'number'
    || !Number.isFinite(source.width)
    || !Number.isFinite(source.height)
    || source.width <= 0
    || source.height <= 0
  ) {
    return null
  }
  return { width: source.width, height: source.height }
}

export class BoardBackgroundView {
  private readonly scene: Phaser.Scene
  private readonly visibilitySource: PageVisibilitySource | null
  private readonly backgroundImage: Phaser.GameObjects.Image
  private readonly ambienceEntries: AmbienceEntry[] = []
  private readonly onVisibilityChange = (): void => {
    this.setPageHidden(this.visibilitySource?.hidden ?? false)
  }

  private layout: Pick<SceneLayout, 'width' | 'height'> = { width: 1, height: 1 }
  private theme: BoardTheme = DEFAULT_BOARD_THEME
  private quality: RenderQualityPreference = DEFAULT_RENDER_QUALITY_PREFERENCE
  private reducedMotion = false
  private pageHidden = false
  private manifest: PhaserBoardAssetManifest | null = null
  private manifestSignature = ''
  private activeBackgroundTextureKey: string | null = null
  private activeAmbienceTextureKey: string | null = null
  private destroyed = false

  constructor(
    scene: Phaser.Scene,
    visibilitySource: PageVisibilitySource | null = browserVisibilitySource(),
  ) {
    this.scene = scene
    this.visibilitySource = visibilitySource
    this.pageHidden = visibilitySource?.hidden ?? false
    this.backgroundImage = scene.add
      .image(0, 0, PHASER_WHITE_TEXTURE_KEY)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_BOARD_BACKGROUND)
    visibilitySource?.addEventListener(
      VISIBILITY_CHANGE_EVENT,
      this.onVisibilityChange,
    )
  }

  sync(view: AppViewModel, layout: SceneLayout): void {
    if (this.destroyed) {
      return
    }
    this.layout = layout
    this.theme = view.boardTheme
    this.quality = view.renderQualityPreference
    this.reducedMotion = view.animationSpeed === 'off'
    const signature = `${this.theme}:${this.quality}`
    if (signature !== this.manifestSignature) {
      this.manifestSignature = signature
      this.manifest = buildPhaserBoardAssetManifest(this.theme, this.quality)
    }
    this.syncBackground()
    this.syncAmbience()
  }

  resize(layout: SceneLayout): void {
    if (this.destroyed) {
      return
    }
    this.layout = layout
    this.syncBackground()
    this.syncAmbience()
  }

  setPageHidden(hidden: boolean): void {
    if (this.destroyed || hidden === this.pageHidden) {
      return
    }
    this.pageHidden = hidden
    this.syncAmbience()
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.visibilitySource?.removeEventListener(
      VISIBILITY_CHANGE_EVENT,
      this.onVisibilityChange,
    )

    for (const entry of this.ambienceEntries) {
      entry.tween.remove()
      entry.sprite.setTexture(PHASER_WHITE_TEXTURE_KEY)
      entry.sprite.destroy()
    }
    this.ambienceEntries.length = 0
    this.backgroundImage.setTexture(PHASER_WHITE_TEXTURE_KEY)
    this.backgroundImage.destroy()
    this.activeBackgroundTextureKey = null
    this.activeAmbienceTextureKey = null
    this.pruneBackgroundTextures(null)
    this.pruneAmbienceTextures(null)
  }

  private syncBackground(): void {
    const key = this.manifest
      ? resolveLoadedBoardBackgroundTextureKey(
          this.manifest,
          (candidate) => this.scene.textures.exists(candidate),
        )
      : null
    const dimensions = key
      ? textureSourceDimensions(this.scene, key)
      : null
    if (!key || !dimensions) {
      this.useFallbackBackground()
      this.pruneBackgroundTextures(null)
      return
    }

    const previousKey = this.activeBackgroundTextureKey
    if (key !== previousKey) {
      this.backgroundImage.setTexture(key)
      this.activeBackgroundTextureKey = key
    }
    this.backgroundImage
      .clearTint()
      .setVisible(true)
      .setPosition(this.layout.width / 2, this.layout.height / 2)
    const fit = computeBoardCoverFit(
      dimensions.width,
      dimensions.height,
      this.layout.width,
      this.layout.height,
    )
    this.backgroundImage
      .setScale(fit.scale)
      .setCrop(
        fit.sourceX,
        fit.sourceY,
        fit.sourceWidth,
        fit.sourceHeight,
      )

    if (previousKey && previousKey !== key) {
      this.removeTexture(previousKey)
    }
    this.pruneBackgroundTextures(key)
  }

  private useFallbackBackground(): void {
    const previousKey = this.activeBackgroundTextureKey
    if (previousKey) {
      this.backgroundImage.setTexture(PHASER_WHITE_TEXTURE_KEY)
      this.activeBackgroundTextureKey = null
    }
    this.backgroundImage
      .setCrop()
      .setPosition(this.layout.width / 2, this.layout.height / 2)
      .setDisplaySize(
        positiveDimension(this.layout.width),
        positiveDimension(this.layout.height),
      )
      .setTint(BOARD_FALLBACK_COLORS[this.theme])
      .setVisible(true)
    if (previousKey) {
      this.removeTexture(previousKey)
    }
  }

  private syncAmbience(): void {
    const desiredTextureKey = boardAmbienceAtlasTextureKey(this.theme)
    const hasDesiredTexture = this.scene.textures.exists(desiredTextureKey)
    if (!hasDesiredTexture) {
      this.detachAmbienceTexture()
      this.pruneAmbienceTextures(null)
      return
    }

    this.useAmbienceTexture(desiredTextureKey)
    const policy = resolveBoardAmbiencePolicy(
      this.quality,
      this.layout.width,
      this.layout.height,
      this.reducedMotion,
      this.pageHidden,
    )
    this.ensureAmbienceEntries(policy.spriteCount, desiredTextureKey)
    this.updateAmbienceEntries(policy.spriteCount)
    this.pruneAmbienceTextures(desiredTextureKey)
  }

  private useAmbienceTexture(key: string): void {
    if (key === this.activeAmbienceTextureKey) {
      return
    }
    const previousKey = this.activeAmbienceTextureKey
    for (let index = 0; index < this.ambienceEntries.length; index += 1) {
      this.ambienceEntries[index].sprite.setTexture(
        key,
        AMBIENCE_ATLAS_FRAMES[index % AMBIENCE_ATLAS_FRAMES.length],
      )
    }
    this.activeAmbienceTextureKey = key
    if (previousKey) {
      this.removeTexture(previousKey)
    }
  }

  private detachAmbienceTexture(): void {
    const previousKey = this.activeAmbienceTextureKey
    for (const entry of this.ambienceEntries) {
      if (entry.active) {
        entry.active = false
        entry.sprite.setVisible(false)
      }
      if (!entry.tween.isPaused()) {
        entry.tween.pause()
      }
      entry.sprite.setTexture(PHASER_WHITE_TEXTURE_KEY)
    }
    this.activeAmbienceTextureKey = null
    if (previousKey) {
      this.removeTexture(previousKey)
    }
  }

  private ensureAmbienceEntries(count: number, textureKey: string): void {
    const boundedCount = clamp(
      Math.floor(count),
      0,
      MAX_BOARD_AMBIENCE_SPRITES,
    )
    while (this.ambienceEntries.length < boundedCount) {
      const index = this.ambienceEntries.length
      const frame = AMBIENCE_ATLAS_FRAMES[index % AMBIENCE_ATLAS_FRAMES.length]
      const baseAlpha = frame === 'ambient-glow' ? 0.16 : 0.24
      const sprite = this.scene.add
        .sprite(0, 0, textureKey, frame)
        .setDepth(DEPTH_BOARD_AMBIENCE)
        .setScrollFactor(0)
        .setAlpha(baseAlpha)
        .setVisible(false)
      const tween = this.scene.tweens.add({
        targets: sprite,
        alpha: baseAlpha * 0.45,
        duration: 2200 + index * 170,
        ease: 'Sine.InOut',
        yoyo: true,
        repeat: -1,
      })
      this.ambienceEntries.push({ sprite, tween, active: false })
    }
  }

  private updateAmbienceEntries(activeCount: number): void {
    const boundedCount = clamp(
      Math.floor(activeCount),
      0,
      this.ambienceEntries.length,
    )
    const minDimension = Math.min(
      positiveDimension(this.layout.width),
      positiveDimension(this.layout.height),
    )
    const scale = clamp(minDimension / 820, 0.45, 1.15)
    for (let index = 0; index < this.ambienceEntries.length; index += 1) {
      const entry = this.ambienceEntries[index]
      const [xRatio, yRatio] = AMBIENCE_POSITIONS[index]
      entry.sprite
        .setPosition(this.layout.width * xRatio, this.layout.height * yRatio)
        .setScale(scale * (index % 2 === 0 ? 0.72 : 1))
      const active = index < boundedCount
      if (active === entry.active) {
        continue
      }
      entry.active = active
      entry.sprite.setVisible(active)
      if (active) {
        if (entry.tween.isPaused()) {
          entry.tween.resume()
        }
      } else if (!entry.tween.isPaused()) {
        entry.tween.pause()
      }
    }
  }

  private pruneBackgroundTextures(keepKey: string | null): void {
    for (const theme of BOARD_THEMES) {
      for (const variant of BOARD_BACKGROUND_VARIANTS) {
        const key = boardBackgroundTextureKey(theme, variant)
        if (key !== keepKey) {
          this.removeTexture(key)
        }
      }
    }
  }

  private pruneAmbienceTextures(keepKey: string | null): void {
    for (const theme of BOARD_THEMES) {
      const key = boardAmbienceAtlasTextureKey(theme)
      if (key !== keepKey) {
        this.removeTexture(key)
      }
    }
  }

  private removeTexture(key: string): void {
    if (key !== PHASER_WHITE_TEXTURE_KEY && this.scene.textures.exists(key)) {
      this.scene.textures.remove(key)
    }
  }
}
