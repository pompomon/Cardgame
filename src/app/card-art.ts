import { CARD_VISUAL_STYLE_OPTIONS } from './card-visual-styles'
import type { CardVisualStyle } from './types'
import { BASIC_LANDS, type BasicLand } from '../game/types'

// Vite exposes the deployed base URL on `import.meta.env.BASE_URL`. When
// running unit tests under vitest there is no Vite shim, so default to '/'.
function basePath(): string {
  try {
    const meta = import.meta as unknown as { env?: { BASE_URL?: string } }
    const base = meta.env?.BASE_URL
    if (typeof base === 'string' && base.length > 0) {
      return base.endsWith('/') ? base : `${base}/`
    }
  } catch {
    // Ignore: tests/non-Vite environments simply use '/'.
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
