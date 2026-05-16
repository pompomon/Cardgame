import type { CardVisualStyle } from './types'

export const CARD_VISUAL_STYLE_OPTIONS: ReadonlyArray<{ value: CardVisualStyle; label: string }> = [
  { value: 'classic', label: 'Classic' },
  { value: 'hd', label: 'HD' },
  { value: 'monochrome', label: 'Monochrome' },
]

export const DEFAULT_CARD_VISUAL_STYLE: CardVisualStyle = 'classic'

export function isCardVisualStyle(value: unknown): value is CardVisualStyle {
  return value === 'classic' || value === 'hd' || value === 'monochrome'
}
