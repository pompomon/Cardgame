import { DEFAULT_CARD_VISUAL_STYLE, isCardVisualStyle } from './card-visual-styles'
import { readStorageItem, writeStorageItem } from './safe-storage'
import type { CardVisualStyle } from './types'

const STORAGE_KEY = 'cardgame.card-visual-style'

export function persistCardVisualStyle(style: CardVisualStyle): void {
  writeStorageItem(STORAGE_KEY, style)
}

export function readStoredCardVisualStyle(): CardVisualStyle {
  const value = readStorageItem(STORAGE_KEY)
  if (value === 'neon') {
    // Migration: the legacy 'neon' slot was replaced by the high-resolution
    // 'hd' style. Upgrade the persisted preference in place so users who
    // previously picked Neon keep landing on the new style across sessions.
    writeStorageItem(STORAGE_KEY, 'hd')
    return 'hd'
  }
  return isCardVisualStyle(value) ? value : DEFAULT_CARD_VISUAL_STYLE
}
