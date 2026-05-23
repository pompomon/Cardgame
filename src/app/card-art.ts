import { CARD_VISUAL_STYLE_OPTIONS } from './card-visual-styles'
import type { CardVisualStyle } from './types'
import { BASIC_LANDS, type BasicLand } from '../game/types'

// Vite exposes the deployed base URL on `import.meta.env.BASE_URL`. The
// access must be a literal `import.meta.env.BASE_URL` member expression so
// Vite's static replacement engages at build time; routing the lookup through
// an intermediate alias (e.g. `meta.env?.BASE_URL`) leaves the reference
// untransformed in the production bundle, which then evaluates to `undefined`
// in the browser and silently breaks every `/cards/...` URL on GitHub Pages.
function basePath(): string {
  const base = import.meta.env.BASE_URL
  if (typeof base === 'string' && base.length > 0) {
    return base.endsWith('/') ? base : `${base}/`
  }
  return '/'
}

export function cardArtKey(land: BasicLand, style: CardVisualStyle): string {
  return `card-art:${style}:${land}`
}

export function cardArtUrl(land: BasicLand, style: CardVisualStyle): string {
  return `${basePath()}cards/${style}/${land}.png`
}

/**
 * Texture key for the geometric HD-fallback raster shipped under
 * `public/cards/hd-fallback/<Land>.png`. Preloaded alongside the primary
 * `hd` texture so the Phaser renderer can fall back to deterministic
 * geometric art when the photoreal asset is missing.
 */
export function cardArtFallbackKey(land: BasicLand, style: CardVisualStyle): string {
  return `card-art:${style}-fallback:${land}`
}

/**
 * Returns the URL of the runtime raster fallback for `(land, style)`, or
 * `null` when no fallback is shipped. Currently only the `hd` style ships a
 * fallback — the deterministic geometric PNGs at
 * `public/cards/hd-fallback/<Land>.png` produced by
 * `scripts/generate-card-art.mjs` — to back-stop the photoreal HD art.
 */
export function cardArtFallbackUrl(
  land: BasicLand,
  style: CardVisualStyle,
): string | null {
  if (style !== 'hd') {
    return null
  }
  return `${basePath()}cards/hd-fallback/${land}.png`
}

export const CARD_BACK_KEY = 'card-art:back'

export function cardBackUrl(): string {
  return `${basePath()}cards/card-back.png`
}

export interface CardArtEntry {
  readonly land: BasicLand
  readonly style: CardVisualStyle
  readonly key: string
  readonly url: string
  /**
   * Optional runtime raster fallback. Populated for `hd` (the geometric
   * `hd-fallback/` PNG) and `undefined` for styles without a shipped raster
   * fallback layer. When present, both `fallbackKey` and `fallbackUrl` are
   * set in lock-step.
   */
  readonly fallbackKey?: string
  readonly fallbackUrl?: string
}

function buildAllCardArt(): ReadonlyArray<CardArtEntry> {
  const entries: CardArtEntry[] = []
  for (const styleOption of CARD_VISUAL_STYLE_OPTIONS) {
    for (const land of BASIC_LANDS) {
      const fallbackUrl = cardArtFallbackUrl(land, styleOption.value)
      const entry: CardArtEntry = {
        land,
        style: styleOption.value,
        key: cardArtKey(land, styleOption.value),
        url: cardArtUrl(land, styleOption.value),
        ...(fallbackUrl !== null
          ? {
              fallbackKey: cardArtFallbackKey(land, styleOption.value),
              fallbackUrl,
            }
          : {}),
      }
      entries.push(entry)
    }
  }
  return Object.freeze(entries)
}

export const ALL_CARD_ART: ReadonlyArray<CardArtEntry> = buildAllCardArt()
