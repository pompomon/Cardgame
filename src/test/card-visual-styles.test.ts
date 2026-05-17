import { describe, expect, it } from 'vitest'
import {
  CARD_VISUAL_STYLE_OPTIONS,
  DEFAULT_CARD_VISUAL_STYLE,
  isCardVisualStyle,
} from '../app/card-visual-styles'

describe('card-visual-styles', () => {
  it('exposes three selectable card visual styles', () => {
    expect(CARD_VISUAL_STYLE_OPTIONS.map((entry) => entry.value)).toEqual([
      'classic',
      'hd',
      'monochrome',
    ])
    expect(DEFAULT_CARD_VISUAL_STYLE).toBe('classic')
  })

  it('validates style values', () => {
    expect(isCardVisualStyle('classic')).toBe(true)
    expect(isCardVisualStyle('hd')).toBe(true)
    expect(isCardVisualStyle('monochrome')).toBe(true)
    expect(isCardVisualStyle('neon')).toBe(false)
    expect(isCardVisualStyle('invalid')).toBe(false)
    expect(isCardVisualStyle(null)).toBe(false)
  })
})
