import { describe, expect, it } from 'vitest'
import { cardVisualPaletteFor, landIconDataUrl, landPixelRects, stylePreviewDataUrl } from '../app/card-visuals'

describe('card-visuals', () => {
  it('produces distinct icon data by card type and style', () => {
    const forestClassic = landIconDataUrl('Forest', 'classic', 32)
    const mountainClassic = landIconDataUrl('Mountain', 'classic', 32)
    const forestNeon = landIconDataUrl('Forest', 'neon', 32)
    expect(forestClassic).not.toBe(mountainClassic)
    expect(forestClassic).not.toBe(forestNeon)
  })

  it('reuses cached icon outputs for equal style-land-size buckets', () => {
    const first = landIconDataUrl('Swamp', 'monochrome', 37)
    const second = landIconDataUrl('Swamp', 'monochrome', 38)
    expect(first).toBe(second)
  })

  it('returns non-empty pixel geometry and style preview output', () => {
    const rects = landPixelRects('Plains', 28)
    expect(rects.length).toBeGreaterThan(0)
    const preview = stylePreviewDataUrl('classic', 30)
    expect(preview.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('exposes palette entries for card and icon rendering', () => {
    const palette = cardVisualPaletteFor('Island', 'classic')
    expect(palette.cardFill).toMatch(/^#/)
    expect(palette.cardStroke).toMatch(/^#/)
    expect(palette.cardText).toMatch(/^#/)
    expect(palette.iconPrimary).toMatch(/^#/)
    expect(palette.iconSecondary).toMatch(/^#/)
  })
})
