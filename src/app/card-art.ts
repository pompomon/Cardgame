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

export const CARD_BACK_KEY = 'card-art:back'

export function cardBackUrl(): string {
  return `${basePath()}cards/card-back.png`
}

export interface CardArtEntry {
  readonly land: BasicLand
  readonly style: CardVisualStyle
  readonly key: string
  readonly url: string
}

function buildAllCardArt(): ReadonlyArray<CardArtEntry> {
  const entries: CardArtEntry[] = []
  for (const styleOption of CARD_VISUAL_STYLE_OPTIONS) {
    for (const land of BASIC_LANDS) {
      entries.push({
        land,
        style: styleOption.value,
        key: cardArtKey(land, styleOption.value),
        url: cardArtUrl(land, styleOption.value),
      })
    }
  }
  return Object.freeze(entries)
}

export const ALL_CARD_ART: ReadonlyArray<CardArtEntry> = buildAllCardArt()
