// Single source of truth for card visual style options.
//
// `CARD_VISUAL_STYLES` is the canonical tuple — the `CardVisualStyle`
// union type, `isCardVisualStyle` guard, and the lobby `{value,label}`
// options array are all derived from it. `RASTER_CARD_VISUAL_STYLES`
// (which styles ship raster PNGs vs. procedural SVG icons) also lives
// here so renderers route through `isRasterCardVisualStyle` instead of
// re-declaring the set. Adding a new style requires only an entry in
// `CARD_VISUAL_STYLES`, a label below, and (for raster styles) inclusion
// in `RASTER_CARD_VISUAL_STYLES`.

export const CARD_VISUAL_STYLES = ['classic', 'hd', 'monochrome'] as const

export type CardVisualStyle = typeof CARD_VISUAL_STYLES[number]

export const DEFAULT_CARD_VISUAL_STYLE: CardVisualStyle = 'classic'

const CARD_VISUAL_STYLE_LABELS: Record<CardVisualStyle, string> = {
  classic: 'Classic',
  hd: 'HD',
  monochrome: 'Monochrome',
}

export const CARD_VISUAL_STYLE_OPTIONS: ReadonlyArray<{
  value: CardVisualStyle
  label: string
}> = CARD_VISUAL_STYLES.map((value) => ({
  value,
  label: CARD_VISUAL_STYLE_LABELS[value],
}))

export function isCardVisualStyle(value: unknown): value is CardVisualStyle {
  return typeof value === 'string'
    && (CARD_VISUAL_STYLES as readonly string[]).includes(value)
}

// Styles whose shipped artwork is photographic / rasterised PNG art rather
// than the procedural pixel template. Callers use this to choose CSS
// `image-rendering` and whether to draw the palette card frame behind the
// art. Keep in sync with the contents of `public/cards/<style>/*.png`.
const RASTER_CARD_VISUAL_STYLE_SET: ReadonlySet<CardVisualStyle> = new Set(['hd', 'monochrome'])

export function isRasterCardVisualStyle(style: CardVisualStyle): boolean {
  return RASTER_CARD_VISUAL_STYLE_SET.has(style)
}
