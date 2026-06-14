import Phaser from 'phaser'

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
