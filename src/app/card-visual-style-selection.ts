import { DEFAULT_CARD_VISUAL_STYLE, isCardVisualStyle } from './card-visual-styles'
import type { CardVisualStyle } from './types'

const STORAGE_KEY = 'cardgame.card-visual-style'

export function persistCardVisualStyle(style: CardVisualStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style)
  } catch {
    // Ignore storage failures and keep default/in-memory behavior.
  }
}

export function readStoredCardVisualStyle(): CardVisualStyle {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isCardVisualStyle(value) ? value : DEFAULT_CARD_VISUAL_STYLE
  } catch {
    return DEFAULT_CARD_VISUAL_STYLE
  }
}
