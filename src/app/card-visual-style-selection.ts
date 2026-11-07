import { DEFAULT_CARD_VISUAL_STYLE, isCardVisualStyle } from './card-visual-styles'
import { readStorageItem, writeStorageItem } from './safe-storage'
import type { CardVisualStyle } from './types'

const STORAGE_KEY = 'cardgame.card-visual-style'
const MONOCHROME_STORAGE_KEY = 'cardgame.monochrome-cards'

export function persistCardVisualStyle(style: CardVisualStyle): void {
  writeStorageItem(STORAGE_KEY, style)
}

export function readStoredCardVisualStyle(): CardVisualStyle {
  const value = readStorageItem(STORAGE_KEY)
  if (value === 'monochrome') {
    writeStorageItem(STORAGE_KEY, 'anime')
    persistMonochromeCards(true)
    return 'anime'
  }
  if (value === 'hd' || value === 'neon') {
    writeStorageItem(STORAGE_KEY, 'anime')
    return 'anime'
  }
  return isCardVisualStyle(value) ? value : DEFAULT_CARD_VISUAL_STYLE
}

export function persistMonochromeCards(enabled: boolean): void {
  writeStorageItem(MONOCHROME_STORAGE_KEY, String(enabled))
}

export function readStoredMonochromeCards(): boolean {
  return readStorageItem(MONOCHROME_STORAGE_KEY) === 'true'
}
