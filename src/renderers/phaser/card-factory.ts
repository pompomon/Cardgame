// Card GameObject factory shared by the cardgame scene's battlefield/hand/
// log/menu rendering. Texture *loading* (preloadCardArt) lives in
// card-art-loader.ts; this module only builds GameObjects from textures
// that are assumed already loaded (falling back to the procedural pixel
// icon when they aren't). Kept free of scene-instance state (registries,
// scroll offsets, …) so it can be reused anywhere a card needs to be drawn.
import type Phaser from 'phaser'
import { CARD_BACK_KEY, cardArtKey } from '../../app/card-art'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import { bucketIconSize, cardVisualPaletteFor, isRasterCardVisualStyle, landPixelRects } from '../../app/card-visuals'
import type { AppViewModel } from '../../app/types'
import { HIDDEN_HAND_CARD_NAME } from '../../app/types'
import { isBasicLand, type BasicLand } from '../../game/types'
import {
  cardRenderContentForMode,
  canRenderCardBackTexture,
  resolveRasterCardArtTextureKey,
  type CardRenderMode,
} from './card-rendering'
import type { SceneLayout } from './layout'
import {
  buildButton,
  BUTTON_TEXT_HORIZONTAL_PADDING,
  BUTTON_TEXT_MAX_LINES,
  type ButtonRenderOptions,
} from './button'
import { buildCardFrame, buildCoverImage, buildLabelStrip, buildPolishedPanel, buildRoundedCoverImage } from './visual-primitives'
import { colorHexToNumber, parseFontPx } from './ui-utils'
import {
  BUTTON_THEME,
  cardStyleForLand,
  COLOR_CARD_BACK_FILL,
  COLOR_CARD_BACK_INNER_FILL,
  COLOR_CARD_BACK_STROKE,
  COLOR_CARD_HIGHLIGHT_STROKE,
  UI_THEME,
} from './theme'
import { CARD_CHOICE_ICON_HEIGHT_RATIO, CARD_CHOICE_ICON_MIN_SIZE, CARD_CHOICE_ICON_WIDTH_RATIO, CARD_FACE_ICON_MIN_SIZE } from './scene-config'


export function addPixelIconToContainer(
  scene: Phaser.Scene,
  land: BasicLand,
  visualStyle: AppViewModel['cardVisualStyle'],
  left: number,
  top: number,
  size: number,
  container: Phaser.GameObjects.Container,
): void {
  const palette = cardVisualPaletteFor(land, visualStyle)
  const primary = colorHexToNumber(palette.iconPrimary)
  const secondary = colorHexToNumber(palette.iconSecondary)
  const effectiveSize = bucketIconSize(size)
  const rects = landPixelRects(land, effectiveSize)
  const icon = scene.add.graphics()
  icon.setPosition(left, top)
  for (const rect of rects) {
    icon.fillStyle(rect.tone === 'primary' ? primary : secondary)
    icon.fillRect(rect.x, rect.y, rect.size, rect.size)
  }
  container.add(icon)
}

// Renders the card art image centered at (centerX, centerY) inside `container`.
// Falls back to the procedural pixel icon when the texture is not yet
// available (e.g. during preload, missing asset, or in unit tests with no
// loader). Returns `true` only when a raster-style image was placed so
// callers can suppress their own palette `cardFill` rectangle and let
// the painted art carry the visuals instead of stacking under a neon
// frame. Classic/Monochrome textures are placeholder palette swatches
// and intentionally return `false` so their palette frame stays drawn.
export function addCardArtToContainer(
  scene: Phaser.Scene,
  land: BasicLand,
  visualStyle: AppViewModel['cardVisualStyle'],
  centerX: number,
  centerY: number,
  size: number,
  container: Phaser.GameObjects.Container,
  options: { fit?: 'contain' | 'cover'; coverWidth?: number; coverHeight?: number } = {},
): boolean {
  // Walk the texture-fallback chain in order: primary (photoreal) →
  // geometric raster fallback (e.g. hd-fallback) → procedural pixel-icon.
  // The fallback chain is only populated for styles that ship a backup
  // raster (currently `hd`); other styles fall straight from primary to
  // the procedural pixel-template.
  const textureExists = (key: string): boolean => scene.textures?.exists(key) ?? false
  const rasterKey = resolveRasterCardArtTextureKey(land, visualStyle, textureExists)
  const primaryKey = cardArtKey(land, visualStyle)
  const resolvedKey = rasterKey ?? (textureExists(primaryKey) ? primaryKey : null)
  if (resolvedKey !== null) {
    if (options.fit === 'cover' && options.coverWidth && options.coverHeight) {
      // Cover-fit: scale uniformly so the texture fills the target rectangle
      // and crop the overflow so the visible region is exactly coverWidth ×
      // coverHeight, centered on (centerX, centerY). Using setCrop instead
      // of a Phaser GeometryMask because Phaser 4's GeometryMask is a no-op
      // under the WebGL renderer.
      const coverImage = buildCoverImage(scene, resolvedKey, options.coverWidth, options.coverHeight, size)
      coverImage.setPosition(centerX, centerY)
      container.add(coverImage)
      return isRasterCardVisualStyle(visualStyle)
    }
    const image = scene.add.image(centerX, centerY, resolvedKey)
    image.setOrigin(0.5, 0.5)
    image.setDisplaySize(size, size)
    container.add(image)
    return isRasterCardVisualStyle(visualStyle)
  }
  // Fallback: keep the original pixel-rect icon path so cards remain
  // visible. Bucket the size to match what `addPixelIconToContainer` will
  // use internally so positioning stays centered (otherwise the icon can
  // be off-by-one when `bucketIconSize(size) !== size`).
  const effectiveSize = bucketIconSize(size)
  const left = centerX - Math.floor(effectiveSize / 2)
  const top = centerY - Math.floor(effectiveSize / 2)
  addPixelIconToContainer(scene, land, visualStyle, left, top, effectiveSize, container)
  return false
}

// Face-down placeholder rendered when the AI's hand is hidden from the
// local human viewer. Keeps the hand slot visible (so the human can see
// card count) without revealing card identities.
export function renderHiddenCard(
  scene: Phaser.Scene,
  layout: SceneLayout,
  x: number,
  y: number,
  dimensions: { width: number; height: number } = { width: layout.cardWidth, height: layout.cardHeight },
  enableShadows = true,
): Phaser.GameObjects.Container {
  const cardWidth = dimensions.width
  const cardHeight = dimensions.height
  const card = scene.add.container(x, y)
  if (canRenderCardBackTexture((key) => scene.textures?.exists(key) ?? false)) {
    card.add(buildCoverImage(scene, CARD_BACK_KEY, cardWidth, cardHeight, Math.max(cardWidth, cardHeight)))
    card.add(buildCardFrame(scene, cardWidth, cardHeight, COLOR_CARD_BACK_STROKE, 1, {
      shadow: enableShadows,
    }))
    return card
  }
  const back = buildPolishedPanel(scene, 0, 0, {
    fill: COLOR_CARD_BACK_FILL,
    stroke: COLOR_CARD_BACK_STROKE,
    width: cardWidth,
    height: cardHeight,
    radius: 8,
    shadow: enableShadows,
    shadowAlpha: 0.25,
    shadowOffset: 3,
  })
  card.add(back)
  // Cross-hatch pattern to mark the card as face-down.
  const inset = 6
  const innerW = Math.max(0, cardWidth - inset * 2)
  const innerH = Math.max(0, cardHeight - inset * 2)
  if (innerW > 0 && innerH > 0) {
    const innerBg = scene.add.rectangle(0, 0, innerW, innerH, COLOR_CARD_BACK_INNER_FILL).setStrokeStyle(1, COLOR_CARD_BACK_STROKE)
    card.add(innerBg)
  }
  const glyph = scene.add.text(0, 0, '?', {
    color: UI_THEME.secondaryText,
    fontSize: layout.titleFontSize,
    fontStyle: 'bold',
  }).setOrigin(0.5, 0.5)
  card.add(glyph)
  return card
}

export interface StaticCardConfig {
  onClick?: () => void
  highlight?: boolean
  mode?: CardRenderMode
  visualStyle?: AppViewModel['cardVisualStyle']
  dimensions?: { width: number; height: number }
  enableShadows?: boolean
}

export function renderStaticCard(
  scene: Phaser.Scene,
  layout: SceneLayout,
  x: number,
  y: number,
  label: string,
  config: StaticCardConfig = {},
  defaultVisualStyle?: AppViewModel['cardVisualStyle'],
): Phaser.GameObjects.Container {
  if (label === HIDDEN_HAND_CARD_NAME) {
    return renderHiddenCard(scene, layout, x, y, config.dimensions, config.enableShadows)
  }
  const visualStyle = config.visualStyle ?? defaultVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
  const style = cardStyleForLand(label, visualStyle)
  const strokeWidth = config.highlight ? 3 : 1
  const strokeColor = config.highlight ? COLOR_CARD_HIGHLIGHT_STROKE : style.stroke
  const content = cardRenderContentForMode(config.mode ?? 'standard')
  const cardWidth = config.dimensions?.width ?? layout.cardWidth
  const cardHeight = config.dimensions?.height ?? layout.cardHeight
  const willUseRasterArt = isBasicLand(label) && resolveRasterCardArtTextureKey(
    label,
    visualStyle,
    (key) => scene.textures?.exists(key) ?? false,
  ) !== null
  // Fill rectangle is unfilled (alpha 0) for HD so the cover-fit image
  // shows through; for procedural styles keep the palette swatch behind
  // the centered pixel icon as before. The stroke is intentionally NOT
  // applied here for HD — it's added as a separate top-most rectangle
  // below so the image cannot cover the card border.
  const fillRect = willUseRasterArt
    ? scene.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0)
    : buildPolishedPanel(scene, 0, 0, {
        fill: style.fill,
        stroke: strokeColor,
        width: cardWidth,
        height: cardHeight,
        radius: 8,
        strokeWidth,
        shadow: config.enableShadows !== false,
        shadowAlpha: 0.24,
        shadowOffset: 3,
      })
  const card = scene.add.container(x, y, [fillRect])
  if (isBasicLand(label)) {
    if (willUseRasterArt) {
      if (content.roundArtwork) {
        const rasterKey = resolveRasterCardArtTextureKey(label, visualStyle, (key) => scene.textures?.exists(key) ?? false)
        if (rasterKey) {
          card.add(buildRoundedCoverImage(scene, rasterKey, cardWidth, cardHeight, 8, Math.max(cardWidth, cardHeight)))
        }
      } else {
        addCardArtToContainer(scene, label, visualStyle, 0, 0, Math.max(cardWidth, cardHeight), card, {
          fit: 'cover',
          coverWidth: cardWidth,
          coverHeight: cardHeight,
        })
      }
    } else {
      // Procedural styles: keep the existing ~66% centered icon layout so
      // the small pixel template stays readable above the card title.
      const artSize = Math.max(
        CARD_FACE_ICON_MIN_SIZE,
        Math.floor(Math.min(
          cardWidth * 0.66,
          cardHeight * 0.6,
        )),
      )
      addCardArtToContainer(scene, label, visualStyle, 0, -8, artSize, card)
    }
  }
  if (willUseRasterArt) {
    if (content.showLabel) {
      const fontPx = parseFontPx(layout.bodyFontSize, 14)
      const stripHeight = Math.max(fontPx + 8, 18)
      const stripWidth = Math.max(0, cardWidth - 4)
      const stripY = cardHeight / 2 - stripHeight / 2 - 2
      const backdrop = buildLabelStrip(scene, stripY, stripWidth, stripHeight)
      card.add(backdrop)
      const text = scene.add.text(0, stripY, label, {
        color: style.text,
        fontSize: layout.bodyFontSize,
        align: 'center',
        wordWrap: { width: cardWidth - 12 },
      }).setOrigin(0.5, 0.5)
      text.setShadow(0, 1, '#000000', 2, false, true)
      card.add(text)
    }
    card.add(buildCardFrame(scene, cardWidth, cardHeight, strokeColor, strokeWidth, {
      highlight: config.highlight,
      shadow: config.enableShadows,
    }))
  } else if (content.showLabel) {
    const text = scene.add.text(0, 0, label, {
      color: style.text,
      fontSize: layout.bodyFontSize,
      align: 'center',
      wordWrap: { width: cardWidth - 12 },
    }).setOrigin(0.5, 0)
    text.y = Math.max(8, cardHeight * 0.17)
    card.add(text)
  }
  if (config.onClick) {
    card.setSize(cardWidth, cardHeight)
    card.setInteractive({ useHandCursor: true })
    card.on('pointerup', config.onClick)
  }
  return card
}

export function createCardChoiceButton(
  scene: Phaser.Scene,
  label: string,
  cardName: string,
  x: number,
  y: number,
  onClick: () => void,
  width: number,
  height: number,
  fontSize: string,
  visualStyle: AppViewModel['cardVisualStyle'],
  options: ButtonRenderOptions = {},
): Phaser.GameObjects.Container {
  const style = cardStyleForLand(cardName, visualStyle)
  const background = buildPolishedPanel(scene, 0, 0, {
    fill: style.fill,
    stroke: style.stroke,
    width,
    height,
    radius: 10,
    strokeWidth: 2,
    shadow: options.enableShadows !== false,
    shadowAlpha: 0.2,
    shadowOffset: 3,
  })
  const text = scene.add.text(0, 0, label, {
    color: style.text,
    fontSize,
    align: 'center',
    wordWrap: { width: Math.max(8, width - BUTTON_TEXT_HORIZONTAL_PADDING) },
    maxLines: BUTTON_TEXT_MAX_LINES,
  }).setOrigin(0.5)
  const button = scene.add.container(x, y, [background, text])
  const iconSize = Math.max(
    CARD_CHOICE_ICON_MIN_SIZE,
    Math.floor(Math.min(width * CARD_CHOICE_ICON_WIDTH_RATIO, height * CARD_CHOICE_ICON_HEIGHT_RATIO)),
  )
  if (isBasicLand(cardName)) {
    addCardArtToContainer(
      scene,
      cardName,
      visualStyle,
      -width / 2 + 12 + Math.floor(iconSize / 2),
      0,
      iconSize,
      button,
    )
  }
  button.setSize(width, height)
  button.setInteractive({ useHandCursor: true })
  button.on('pointerup', onClick)
  return button
}

// Re-exported so callers that only need a themed action button (not a card)
// don't have to import button.ts directly for the common case.
export function createThemedButton(
  scene: Phaser.Scene,
  label: string,
  x: number,
  y: number,
  fontSize: string,
  width: number,
  height: number,
  onClick: () => void,
  options: ButtonRenderOptions = {},
): Phaser.GameObjects.Container {
  return buildButton(scene, label, x, y, fontSize, width, height, onClick, BUTTON_THEME, options)
}
