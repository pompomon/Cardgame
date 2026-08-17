import Phaser from 'phaser'
import { computeRoundedCoverTextureSize, paintRoundedCover, roundedCoverTextureKey } from './rounded-cover'
// Physical Tabletop felt palette. Keep in sync with the CSS tokens in
// src/style.css (--felt-base, --felt-shadow, --felt-active-glow) and with
// the COLOR_FELT_*/COLOR_TABLE_WOOD_* constants in
// src/renderers/phaser/theme.ts.
import { COLOR_FELT_ACTIVE_GLOW, COLOR_FELT_BASE, COLOR_FELT_SHADOW } from './theme'

export interface PolishedPanelConfig {
  fill: number
  stroke: number
  width: number
  height: number
  radius?: number
  alpha?: number
  strokeAlpha?: number
  strokeWidth?: number
  shadow?: boolean
  shadowAlpha?: number
  shadowOffset?: number
  topSheen?: boolean
}

export function buildPolishedPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  config: PolishedPanelConfig,
): Phaser.GameObjects.Container {
  const {
    fill,
    stroke,
    width,
    height,
    radius = 10,
    alpha = 1,
    strokeAlpha = 0.95,
    strokeWidth = 1,
    shadow = true,
    shadowAlpha = 0.22,
    shadowOffset = 4,
    topSheen = true,
  } = config
  const container = scene.add.container(x, y)
  if (shadow) {
    const shadowShape = scene.add.graphics()
    shadowShape.fillStyle(0x000000, shadowAlpha)
    shadowShape.fillRoundedRect(
      -width / 2 + shadowOffset,
      -height / 2 + shadowOffset,
      width,
      height,
      radius,
    )
    container.add(shadowShape)
  }
  const surface = scene.add.graphics()
  surface.fillStyle(fill, alpha)
  surface.fillRoundedRect(-width / 2, -height / 2, width, height, radius)
  surface.lineStyle(strokeWidth, stroke, strokeAlpha)
  surface.strokeRoundedRect(-width / 2, -height / 2, width, height, radius)
  container.add(surface)
  if (topSheen && height >= 18) {
    const sheen = scene.add.graphics()
    sheen.fillStyle(0xffffff, 0.08)
    sheen.fillRoundedRect(
      -width / 2 + 2,
      -height / 2 + 2,
      Math.max(0, width - 4),
      Math.max(0, Math.min(height * 0.28, 18)),
      Math.max(0, radius - 2),
    )
    container.add(sheen)
  }
  container.setSize(width, height)
  return container
}

export function buildLabelStrip(
  scene: Phaser.Scene,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const strip = scene.add.graphics()
  strip.fillStyle(0x000000, 0.66)
  strip.fillRoundedRect(-width / 2, y - height / 2, width, height, 6)
  strip.lineStyle(1, 0xffffff, 0.08)
  strip.strokeRoundedRect(-width / 2, y - height / 2, width, height, 6)
  return strip
}

export function buildCoverImage(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  fallbackSize: number,
): Phaser.GameObjects.Image {
  const image = scene.add.image(0, 0, key)
  const source = scene.textures.get(key).getSourceImage() as { width?: number; height?: number } | null
  const texW = (source && typeof source.width === 'number' && source.width > 0) ? source.width : fallbackSize
  const texH = (source && typeof source.height === 'number' && source.height > 0) ? source.height : fallbackSize
  const scale = Math.max(width / texW, height / texH)
  const cropW = Math.min(texW, width / scale)
  const cropH = Math.min(texH, height / scale)
  image.setScale(scale)
  image.setCrop(
    Math.max(0, (texW - cropW) / 2),
    Math.max(0, (texH - cropH) / 2),
    cropW,
    cropH,
  )
  return image
}

export function buildRoundedCoverImage(
  scene: Phaser.Scene,
  sourceKey: string,
  width: number,
  height: number,
  radius: number,
  fallbackSize: number,
): Phaser.GameObjects.Image {
  const targetWidth = Math.max(1, Math.round(width))
  const targetHeight = Math.max(1, Math.round(height))
  const targetRadius = Math.max(0, Math.round(radius))
  const source = scene.textures.get(sourceKey).getSourceImage() as
    | (CanvasImageSource & { width?: number; height?: number })
    | null
  if (!source) {
    return buildCoverImage(scene, sourceKey, targetWidth, targetHeight, fallbackSize)
  }
  const sourceWidth = typeof source.width === 'number' && source.width > 0 ? source.width : fallbackSize
  const sourceHeight = typeof source.height === 'number' && source.height > 0 ? source.height : fallbackSize
  const textureSize = computeRoundedCoverTextureSize(
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    targetRadius,
  )
  const textureKey = roundedCoverTextureKey(sourceKey, textureSize.width, textureSize.height, textureSize.radius)
  if (!scene.textures.exists(textureKey)) {
    const texture = scene.textures.createCanvas(textureKey, textureSize.width, textureSize.height)
    if (texture) {
      paintRoundedCover(
        texture.getContext(),
        source,
        sourceWidth,
        sourceHeight,
        textureSize.width,
        textureSize.height,
        textureSize.radius,
      )
      texture.refresh()
    }
  }
  if (!scene.textures.exists(textureKey)) {
    return buildCoverImage(scene, sourceKey, targetWidth, targetHeight, fallbackSize)
  }
  return scene.add.image(0, 0, textureKey).setDisplaySize(targetWidth, targetHeight)
}

export function buildCardFrame(
  scene: Phaser.Scene,
  width: number,
  height: number,
  stroke: number,
  strokeWidth: number,
  options: { highlight?: boolean } = {},
): Phaser.GameObjects.Container {
  const frame = scene.add.container(0, 0)
  const shadow = scene.add.graphics()
  shadow.fillStyle(0x000000, 0.28)
  shadow.fillRoundedRect(-width / 2 + 3, -height / 2 + 4, width, height, 9)
  frame.add(shadow)
  const border = scene.add.graphics()
  border.lineStyle(strokeWidth, stroke, options.highlight ? 1 : 0.92)
  border.strokeRoundedRect(-width / 2, -height / 2, width, height, 8)
  frame.add(border)
  if (options.highlight) {
    const glow = scene.add.graphics()
    glow.lineStyle(2, stroke, 0.36)
    glow.strokeRoundedRect(-width / 2 - 3, -height / 2 - 3, width + 6, height + 6, 10)
    frame.add(glow)
  }
  return frame
}

// Physical Tabletop felt palette. Keep in sync with the CSS tokens in
// src/style.css (--felt-base, --felt-shadow, --felt-active-glow) and with
// the COLOR_FELT_*/COLOR_TABLE_WOOD_* constants in
// src/renderers/phaser/theme.ts.

export interface BattlefieldBackdropConfig {
  width: number
  height: number
  kind: 'active' | 'non-active'
  /** Border stroke colour — should match the CSS --battlefield-*-stroke token. */
  stroke: number
}

/**
 * Builds a felt-inset backdrop for a battlefield play area.
 *
 * Visual layers (bottom → top):
 *   1. Drop shadow
 *   2. Felt base gradient (linear, dark → base)
 *   3. Soft upper-left sheen highlight
 *   4. Restrained decorative stroke
 *   5. Active-only soft directional lighting glow along the top edge
 *
 * Entirely procedural — no external texture assets required. Both active
 * and non-active insets share the same felt tone; only the border colour
 * and (for the active side) the lighting glow communicate whose turn it is
 * — no full-panel colour tint.
 */
export function buildBattlefieldBackdrop(
  scene: Phaser.Scene,
  x: number,
  y: number,
  config: BattlefieldBackdropConfig,
): Phaser.GameObjects.Container {
  const { width, height, kind, stroke } = config
  const radius = 12
  const isActive = kind === 'active'
  const hw = width / 2
  const hh = height / 2
  const container = scene.add.container(x, y)

  // Layer 1: Drop shadow
  const shadow = scene.add.graphics()
  shadow.fillStyle(0x000000, 0.26)
  shadow.fillRoundedRect(-hw + 4, -hh + 4, width, height, radius)
  container.add(shadow)

  // Layer 2: Felt base (shared tone for both active/non-active insets)
  const base = scene.add.graphics()
  base.fillStyle(COLOR_FELT_SHADOW, 1)
  base.fillRoundedRect(-hw, -hh, width, height, radius)
  base.fillStyle(COLOR_FELT_BASE, 0.9)
  base.fillRoundedRect(-hw, -hh, width, height * 0.7, { tl: radius, tr: radius, bl: 0, br: 0 })
  container.add(base)

  // Layer 3: Soft upper-left sheen (subtle, not a status colour tint)
  const sheen = scene.add.graphics()
  sheen.fillStyle(0xffffff, 0.08)
  sheen.fillRoundedRect(-hw + 2, -hh + 2, width * 0.6, Math.min(height * 0.4, height - 4), radius - 2)
  container.add(sheen)

  // Layer 4: Restrained decorative stroke — the primary status signal.
  const strokeLine = scene.add.graphics()
  strokeLine.lineStyle(isActive ? 3 : 2, stroke, 0.92)
  strokeLine.strokeRoundedRect(-hw, -hh, width, height, radius)
  container.add(strokeLine)

  // Layer 5: Active-only soft directional lighting glow along the top edge.
  if (isActive) {
    const glow = scene.add.graphics()
    const glowHeight = Math.max(6, height * 0.22)
    glow.fillStyle(COLOR_FELT_ACTIVE_GLOW, 0.16)
    glow.fillRoundedRect(-hw, -hh, width, glowHeight, { tl: radius, tr: radius, bl: 0, br: 0 })
    container.add(glow)
  }

  container.setSize(width, height)
  return container
}
