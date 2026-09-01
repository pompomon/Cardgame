// Color palette and card-style tokens shared across the Phaser lobby and
// cardgame scenes. Tokenized to match the CSS custom properties in
// src/style.css so the DOM and Phaser renderers stay visually consistent.
// Battlefield backdrop parchment colours (base, tints, vignette) live in
// src/renderers/phaser/visual-primitives.ts alongside buildBattlefieldBackdrop.
// To re-skin: update the BATTLEFIELD_* constants there AND the :root tokens in
// src/style.css together, including the entries below.
import { isBasicLand } from '../../game/types'
import type { AppViewModel } from '../../app/types'
import { cardVisualPaletteFor } from '../../app/card-visuals'
import { colorHexToNumber } from './ui-utils'

export const COLOR_BATTLEFIELD_ACTIVE_STROKE = 0x72b048    // sage green  = --battlefield-active-stroke
export const COLOR_BATTLEFIELD_NON_ACTIVE_STROKE = 0xb46878 // muted rose  = --battlefield-nonactive-stroke
export const COLOR_STATUS_ACTIVE_FILL = COLOR_BATTLEFIELD_ACTIVE_STROKE
export const COLOR_STATUS_NON_ACTIVE_FILL = COLOR_BATTLEFIELD_NON_ACTIVE_STROKE
export const STATUS_FILL_ALPHA = 0.05
export const COLOR_PLAYER_ACTIVE_FILL = 0x1e4f7a
export const COLOR_PLAYER_NON_ACTIVE_FILL = 0x4a1f5e
export const COLOR_BORDER_SUBTLE = 0x3a4a8a
export const COLOR_BORDER_STRONG = 0x5d7cff
export const COLOR_LOG_PANEL_FILL = 0x161f4d
export const COLOR_LOG_VIEWPORT_FILL = 0x0f1740

// Physical Tabletop tokens — keep mirrored with the CSS custom properties of
// the same intent in src/style.css (--table-wood-*, --felt-*, --ledger-*,
// --stack-*).
export const COLOR_TABLE_WOOD_LIGHT = 0x8a5c36  // = --table-wood-light
export const COLOR_TABLE_WOOD_BASE = 0x6b4328   // = --table-wood-base
export const COLOR_TABLE_WOOD_DARK = 0x422818   // = --table-wood-dark
export const COLOR_FELT_BASE = 0x1f5c3d         // = --felt-base
export const COLOR_FELT_SHADOW = 0x123723       // = --felt-shadow
export const COLOR_FELT_ACTIVE_GLOW = 0xffe296  // ≈ --felt-active-glow
export const COLOR_LEDGER_SURFACE = 0xecdcae        // = --ledger-surface
export const COLOR_LEDGER_SURFACE_STRONG = 0xe2cd92 // = --ledger-surface-strong
export const COLOR_LEDGER_BORDER = 0x8a6d3a         // = --ledger-border
export const COLOR_LEDGER_TEXT = '#3b2b12'          // = --ledger-text
export const COLOR_STACK_EDGE = 0x5d7cff            // = --stack-edge
// Neutral player-info panel base: a 5%-opaque status tint, restrained border,
// and active-only lighting distinguish state without a saturated fill.
export const COLOR_PLAYER_PANEL_FILL = 0x1f2a5e

export const UI_THEME = {
  buttonFill: 0x28368a,
  buttonStroke: COLOR_BORDER_STRONG,
  panelFill: 0x1f2a5e,
  panelStroke: COLOR_BORDER_SUBTLE,
  viewportFill: COLOR_LOG_VIEWPORT_FILL,
  backdropFill: 0x000000,
  scrimFill: 0x000000,
  primaryText: '#f3f6ff',
  secondaryText: '#c0d0ff',
}

export const BUTTON_THEME = {
  fill: UI_THEME.buttonFill,
  stroke: UI_THEME.buttonStroke,
  text: UI_THEME.primaryText,
}

// Additional shared color tokens for special-purpose UI surfaces. Kept here
// so the entire palette lives in one module.
export const COLOR_APP_BACKGROUND_HEX = '#1b1148'
export const COLOR_APP_BACKGROUND = 0x1b1148
export const COLOR_WINNER_TEXT = '#ffe27a'
export const COLOR_ERROR_TEXT = '#ffd0d8'
export const COLOR_SUCCESS_TEXT = '#d6ffd9'
export const COLOR_CARD_HIGHLIGHT_STROKE = 0xffe680
export const COLOR_CARD_BACK_FILL = 0x2c3a78
export const COLOR_CARD_BACK_INNER_FILL = 0x475ec2
export const COLOR_CARD_BACK_STROKE = 0x5d7cff

export interface CardStyle {
  fill: number
  stroke: number
  text: string
}

export function cardStyleForLand(name: string, visualStyle: AppViewModel['cardVisualStyle']): CardStyle {
  if (!isBasicLand(name)) {
    return { fill: 0x132652, stroke: 0x4f6caa, text: UI_THEME.primaryText }
  }
  const palette = cardVisualPaletteFor(name, visualStyle)
  return {
    fill: colorHexToNumber(palette.cardFill),
    stroke: colorHexToNumber(palette.cardStroke),
    text: palette.cardText,
  }
}
