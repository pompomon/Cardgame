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
    if (value === 'neon') {
      // Migration: the legacy 'neon' slot was replaced by the high-resolution
      // 'hd' style. Upgrade the persisted preference in place so users who
      // previously picked Neon keep landing on the new style across sessions.
      try {
        localStorage.setItem(STORAGE_KEY, 'hd')
      } catch {
        // Ignore storage failures; the in-memory value still upgrades below.
      }
      return 'hd'
    }
    return isCardVisualStyle(value) ? value : DEFAULT_CARD_VISUAL_STYLE
  } catch {
    return DEFAULT_CARD_VISUAL_STYLE
  }
}
