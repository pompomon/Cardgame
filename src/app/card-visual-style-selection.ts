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
    const monochrome = readStorageItem(MONOCHROME_STORAGE_KEY)
    // Keep the legacy marker until the checkbox is saved so a quota failure cannot lose it.
    if (monochrome === 'true' || monochrome === 'false' || persistMonochromeCards(true)) {
      writeStorageItem(STORAGE_KEY, 'anime')
    }
    return 'anime'
  }
  if (value === 'hd' || value === 'neon') {
    writeStorageItem(STORAGE_KEY, 'anime')
    return 'anime'
  }
  return isCardVisualStyle(value) ? value : DEFAULT_CARD_VISUAL_STYLE
}

export function persistMonochromeCards(enabled: boolean): boolean {
  return writeStorageItem(MONOCHROME_STORAGE_KEY, String(enabled))
}

export function readStoredMonochromeCards(): boolean {
  const value = readStorageItem(MONOCHROME_STORAGE_KEY)
  if (value === 'true' || value === 'false') return value === 'true'
  return readStorageItem(STORAGE_KEY) === 'monochrome'
}
