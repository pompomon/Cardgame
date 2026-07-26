import {
  ALL_CARD_ART,
  CARD_BACK_KEY,
  cardArtFallbackKey,
  cardArtKey,
  type CardArtEntry,
} from '../../app/card-art'
import { isRasterCardVisualStyle } from '../../app/card-visual-styles'
import type { CardVisualStyle } from '../../app/types'
import type { BasicLand } from '../../game/types'

const CARD_ART_ENTRIES_BY_STYLE = new Map<CardVisualStyle, readonly CardArtEntry[]>([
  ['classic', ALL_CARD_ART.filter((entry) => entry.style === 'classic')],
  ['hd', ALL_CARD_ART.filter((entry) => entry.style === 'hd')],
  ['monochrome', ALL_CARD_ART.filter((entry) => entry.style === 'monochrome')],
])

export function preloadCardArtEntriesForStyle(style: CardVisualStyle): readonly CardArtEntry[] {
  return CARD_ART_ENTRIES_BY_STYLE.get(style) ?? []
}

export function rasterCardArtTextureCandidates(
  land: BasicLand,
  visualStyle: CardVisualStyle,
): readonly string[] {
  if (!isRasterCardVisualStyle(visualStyle)) {
    return []
  }
  const candidates = [cardArtKey(land, visualStyle)]
  if (visualStyle === 'hd') {
    candidates.push(cardArtFallbackKey(land, 'hd'))
  }
  return candidates
}

export function resolveRasterCardArtTextureKey(
  land: BasicLand,
  visualStyle: CardVisualStyle,
  textureExists: (key: string) => boolean,
): string | null {
  for (const key of rasterCardArtTextureCandidates(land, visualStyle)) {
    if (textureExists(key)) {
      return key
    }
  }
  return null
}

export function canRenderCardBackTexture(textureExists: (key: string) => boolean): boolean {
  return textureExists(CARD_BACK_KEY)
}
