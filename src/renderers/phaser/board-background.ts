import type Phaser from 'phaser'
import { ALL_BOARD_BACKGROUND_ASSETS } from '../../app/board-assets'
import type { BoardTheme } from '../../app/board-theme'
import type { RenderQualityPreference } from '../../app/render-quality'
import type { AnimationSpeed, AppViewModel } from '../../app/types'
import { AMBIENCE_ATLAS_FRAMES, boardBackgroundTextureKey } from './asset-manifest'
import { DEPTH_BOARD_AMBIENCE, DEPTH_BOARD_BACKGROUND } from './depth'
import { clamp, type SceneLayout } from './layout'
import { isPhoneSizedViewport } from './quality'

const WHITE_TEXTURE_KEY = '__WHITE'
const AMBIENCE_UPDATE_EVENT = 'update'
const MAX_AMBIENCE_DELTA_MS = 100

const BOARD_FALLBACK_COLORS: Readonly<Record<BoardTheme, number>> = {
  classic: 0x20170f,
  moonlit: 0x10172b,
  verdant: 0x10251a,
}

export const MAX_BOARD_AMBIENCE_SPRITES = 16

export interface CoverFitCrop {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scale: number
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function computeCoverFitCrop(
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): CoverFitCrop {
  const safeSourceWidth = positiveFinite(sourceWidth)
  const safeSourceHeight = positiveFinite(sourceHeight)
  const safeViewportWidth = positiveFinite(viewportWidth)
  const safeViewportHeight = positiveFinite(viewportHeight)
  const scale = Math.max(
    safeViewportWidth / safeSourceWidth,
    safeViewportHeight / safeSourceHeight,
  )
  const width = Math.min(safeSourceWidth, safeViewportWidth / scale)
  const height = Math.min(safeSourceHeight, safeViewportHeight / scale)

  return {
    x: Math.max(0, (safeSourceWidth - width) / 2),
    y: Math.max(0, (safeSourceHeight - height) / 2),
    width,
    height,
    scale,
  }
}

export interface BoardAmbiencePolicyInput {
  readonly quality: RenderQualityPreference
  readonly animationSpeed: AnimationSpeed
  readonly reducedMotion: boolean
  readonly pageVisible: boolean
  readonly width: number
  readonly height: number
}

export interface BoardAmbiencePolicy {
  readonly visibleSpriteCount: number
  readonly animated: boolean
}

export function resolveBoardAmbiencePolicy(
  input: BoardAmbiencePolicyInput,
): BoardAmbiencePolicy {
  if (
    input.quality === 'low'
    || input.animationSpeed === 'off'
    || input.reducedMotion
    || !input.pageVisible
  ) {
    return { visibleSpriteCount: 0, animated: false }
  }

  const desktopCount = input.quality === 'high'
    ? MAX_BOARD_AMBIENCE_SPRITES
    : MAX_BOARD_AMBIENCE_SPRITES / 2
  const visibleSpriteCount = isPhoneSizedViewport(input.width, input.height)
    ? desktopCount / 2
    : desktopCount
  return { visibleSpriteCount, animated: true }
}

export interface BoardBackgroundAssetState {
  readonly textureKey: string | null
  readonly settled: boolean
}

export interface BoardBackgroundEnvironment {
  readonly reducedMotion: boolean
  readonly pageVisible: boolean
}

type BoardBackgroundViewModel = Pick<
  AppViewModel,
  'animationSpeed' | 'boardTheme' | 'renderQualityPreference'
>

interface AmbienceSprite {
  readonly image: Phaser.GameObjects.Image
  readonly phase: number
  readonly speed: number
  baseX: number
  baseY: number
  amplitude: number
  alpha: number
}

export class BoardBackgroundView {
  private readonly scene: Phaser.Scene
  private readonly fallback: Phaser.GameObjects.Rectangle
  private readonly background: Phaser.GameObjects.Image
  private readonly ambience: AmbienceSprite[] = []
  private currentBackgroundTextureKey: string | null = null
  private currentAmbienceTextureKey: string | null = null
  private activeAmbienceCount = 0
  private elapsedMs = 0
  private destroyed = false

  private readonly onUpdate = (_time: number, delta: number): void => {
    if (this.destroyed || this.activeAmbienceCount === 0) {
      return
    }
    const safeDelta = Number.isFinite(delta)
      ? clamp(delta, 0, MAX_AMBIENCE_DELTA_MS)
      : 0
    this.elapsedMs = (this.elapsedMs + safeDelta) % 120_000
    for (let index = 0; index < this.activeAmbienceCount; index += 1) {
      const entry = this.ambience[index]
      const angle = entry.phase + this.elapsedMs * entry.speed
      entry.image.setPosition(
        entry.baseX + Math.cos(angle * 0.7) * entry.amplitude * 0.35,
        entry.baseY + Math.sin(angle) * entry.amplitude,
      )
      entry.image.setAlpha(entry.alpha * (0.78 + Math.sin(angle * 0.55) * 0.22))
    }
  }

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.fallback = scene.add.rectangle(0, 0, 1, 1, BOARD_FALLBACK_COLORS.classic)
      .setOrigin(0, 0)
      .setDepth(DEPTH_BOARD_BACKGROUND)
    this.background = scene.add.image(0, 0, WHITE_TEXTURE_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH_BOARD_BACKGROUND)
      .setVisible(false)
    scene.events.on(AMBIENCE_UPDATE_EVENT, this.onUpdate)
  }

  sync(
    view: BoardBackgroundViewModel,
    layout: Pick<SceneLayout, 'width' | 'height'>,
    assets: BoardBackgroundAssetState,
    environment: BoardBackgroundEnvironment,
  ): void {
    if (this.destroyed) {
      return
    }

    const width = positiveFinite(layout.width)
    const height = positiveFinite(layout.height)
    this.fallback
      .setPosition(0, 0)
      .setSize(width, height)
      .setFillStyle(BOARD_FALLBACK_COLORS[view.boardTheme])

    if (assets.textureKey && this.scene.textures.exists(assets.textureKey)) {
      this.useBackgroundTexture(assets.textureKey)
      this.fitBackground(width, height)
    } else if (assets.settled) {
      this.clearBackgroundTexture()
    } else if (this.currentBackgroundTextureKey !== null) {
      this.fitBackground(width, height)
    }

    if (assets.settled) {
      this.evictUnusedBackgroundTextures(this.currentBackgroundTextureKey)
    }

    this.syncAmbience(view, width, height, environment)
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.scene.events.off(AMBIENCE_UPDATE_EVENT, this.onUpdate)
    this.activeAmbienceCount = 0
    this.background.setTexture(WHITE_TEXTURE_KEY).setVisible(false)
    this.currentBackgroundTextureKey = null
    this.evictUnusedBackgroundTextures(null)
    for (const entry of this.ambience) {
      entry.image.destroy()
    }
    this.ambience.length = 0
    this.background.destroy()
    this.fallback.destroy()
  }

  private useBackgroundTexture(textureKey: string): void {
    if (textureKey === this.currentBackgroundTextureKey) {
      return
    }
    const previousTextureKey = this.currentBackgroundTextureKey
    this.background
      .setTexture(textureKey)
      .setAlpha(1)
      .setVisible(true)
    this.currentBackgroundTextureKey = textureKey
    if (
      previousTextureKey
      && previousTextureKey !== textureKey
      && this.scene.textures.exists(previousTextureKey)
    ) {
      this.scene.textures.remove(previousTextureKey)
    }
  }

  private clearBackgroundTexture(): void {
    const previousTextureKey = this.currentBackgroundTextureKey
    this.background
      .setTexture(WHITE_TEXTURE_KEY)
      .setVisible(false)
    this.currentBackgroundTextureKey = null
    if (previousTextureKey && this.scene.textures.exists(previousTextureKey)) {
      this.scene.textures.remove(previousTextureKey)
    }
  }

  private fitBackground(width: number, height: number): void {
    const textureKey = this.currentBackgroundTextureKey
    if (!textureKey || !this.scene.textures.exists(textureKey)) {
      return
    }
    const source = this.scene.textures.get(textureKey).getSourceImage() as
      | { width?: unknown; height?: unknown }
      | null
    const sourceWidth = typeof source?.width === 'number' ? source.width : 1
    const sourceHeight = typeof source?.height === 'number' ? source.height : 1
    const crop = computeCoverFitCrop(sourceWidth, sourceHeight, width, height)
    this.background
      .setPosition(width / 2, height / 2)
      .setScale(crop.scale)
      .setCrop(crop.x, crop.y, crop.width, crop.height)
  }

  private syncAmbience(
    view: BoardBackgroundViewModel,
    width: number,
    height: number,
    environment: BoardBackgroundEnvironment,
  ): void {
    const textureKey = `board-atlas:ambience:${view.boardTheme}`
    const textureReady = this.scene.textures.exists(textureKey)
      && AMBIENCE_ATLAS_FRAMES.every((frame) =>
        this.scene.textures.get(textureKey).has(frame),
      )
    const policy = resolveBoardAmbiencePolicy({
      quality: view.renderQualityPreference,
      animationSpeed: view.animationSpeed,
      reducedMotion: environment.reducedMotion,
      pageVisible: environment.pageVisible,
      width,
      height,
    })
    const visibleCount = textureReady ? policy.visibleSpriteCount : 0

    if (textureReady) {
      this.ensureAmbienceSprites(visibleCount, textureKey)
      if (textureKey !== this.currentAmbienceTextureKey) {
        for (let index = 0; index < this.ambience.length; index += 1) {
          this.ambience[index].image.setTexture(
            textureKey,
            AMBIENCE_ATLAS_FRAMES[index % AMBIENCE_ATLAS_FRAMES.length],
          )
        }
        this.currentAmbienceTextureKey = textureKey
      }
    }

    this.activeAmbienceCount = visibleCount
    const minDimension = Math.min(width, height)
    for (let index = 0; index < this.ambience.length; index += 1) {
      const entry = this.ambience[index]
      const visible = index < visibleCount
      const xFraction = ((index * 37 + 13) % 100) / 100
      const yFraction = ((index * 61 + 19) % 100) / 100
      entry.baseX = xFraction * width
      entry.baseY = yFraction * height
      entry.amplitude = clamp(minDimension * (0.012 + (index % 3) * 0.004), 4, 18)
      entry.alpha = 0.12 + (index % 4) * 0.035
      entry.image
        .setPosition(entry.baseX, entry.baseY)
        .setScale(clamp(minDimension / 1100 + (index % 3) * 0.08, 0.22, 0.72))
        .setAlpha(entry.alpha)
        .setVisible(visible)
    }
  }

  private ensureAmbienceSprites(count: number, textureKey: string): void {
    while (this.ambience.length < count && this.ambience.length < MAX_BOARD_AMBIENCE_SPRITES) {
      const index = this.ambience.length
      const image = this.scene.add.image(
        0,
        0,
        textureKey,
        AMBIENCE_ATLAS_FRAMES[index % AMBIENCE_ATLAS_FRAMES.length],
      )
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH_BOARD_AMBIENCE)
        .setVisible(false)
      this.ambience.push({
        image,
        phase: index * 1.73,
        speed: 0.00022 + (index % 5) * 0.000025,
        baseX: 0,
        baseY: 0,
        amplitude: 0,
        alpha: 0,
      })
    }
  }

  private evictUnusedBackgroundTextures(keepTextureKey: string | null): void {
    for (const asset of ALL_BOARD_BACKGROUND_ASSETS) {
      const key = boardBackgroundTextureKey(asset.theme, asset.variant)
      if (key !== keepTextureKey && this.scene.textures.exists(key)) {
        this.scene.textures.remove(key)
      }
    }
  }
}
