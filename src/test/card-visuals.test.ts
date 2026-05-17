import { describe, expect, it } from 'vitest'
import { bucketIconSize, cardArtSourceFor, cardVisualPaletteFor, isRasterCardVisualStyle, landIconDataUrl, landPixelRects, stylePreviewDataUrl } from '../app/card-visuals'

describe('card-visuals', () => {
  it('produces distinct icon data by card type and style', () => {
    const forestClassic = landIconDataUrl('Forest', 'classic', 32)
    const mountainClassic = landIconDataUrl('Mountain', 'classic', 32)
    const forestHd = landIconDataUrl('Forest', 'hd', 32)
    expect(forestClassic).not.toBe(mountainClassic)
    expect(forestClassic).not.toBe(forestHd)
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


  it('returns non-negative rect coordinates for very small sizes', () => {
    const rects = landPixelRects('Forest', 8)
    expect(rects.length).toBeGreaterThan(0)
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('fills full preview width even when size is not evenly divisible by lane count', () => {
    const preview = stylePreviewDataUrl('classic', 22)
    const svg = decodeURIComponent(preview.split(',')[1] ?? '')
    // Outer SVG keeps the requested display size; viewBox is internally scaled.
    expect(svg).toContain('width="22" height="22"')
    const viewBoxMatch = svg.match(/viewBox="0 0 (\d+) \1"/)
    expect(viewBoxMatch).not.toBeNull()
    const internalSize = Number(viewBoxMatch?.[1])
    // The first three full-height rects are the lane backgrounds; their widths
    // should sum to the internal viewBox size with no transparent gap.
    const laneRects = Array.from(svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)" height="(\d+)"/g))
      .filter((m) => Number(m[3]) === internalSize)
      .slice(0, 3)
    expect(laneRects).toHaveLength(3)
    const totalLaneWidth = laneRects.reduce((sum, m) => sum + Number(m[2]), 0)
    expect(totalLaneWidth).toBe(internalSize)
  })

  it('keeps preview icons inside their lane for small previews', () => {
    const preview = stylePreviewDataUrl('classic', 22)
    const svg = decodeURIComponent(preview.split(',')[1] ?? '')
    // Every <rect> must have non-negative x and y coordinates.
    const matches = Array.from(svg.matchAll(/<rect [^>]*x="(-?\d+)"[^>]*y="(-?\d+)"/g))
    expect(matches.length).toBeGreaterThan(0)
    for (const match of matches) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(0)
      expect(Number(match[2])).toBeGreaterThanOrEqual(0)
    }
  })

  it('exposes bucketIconSize that snaps to even sizes with an 8px floor', () => {
    expect(bucketIconSize(5)).toBe(8)
    expect(bucketIconSize(13)).toBe(14)
    expect(bucketIconSize(20)).toBe(20)
  })

  it('exposes palette entries for card and icon rendering', () => {
    const palette = cardVisualPaletteFor('Island', 'classic')
    expect(palette.cardFill).toMatch(/^#/)
    expect(palette.cardStroke).toMatch(/^#/)
    expect(palette.cardText).toMatch(/^#/)
    expect(palette.iconPrimary).toMatch(/^#/)
    expect(palette.iconSecondary).toMatch(/^#/)
  })

  it('flags hd and monochrome as raster card visual styles', () => {
    expect(isRasterCardVisualStyle('hd')).toBe(true)
    expect(isRasterCardVisualStyle('monochrome')).toBe(true)
    expect(isRasterCardVisualStyle('classic')).toBe(false)
  })

  describe('cardArtSourceFor', () => {
    it('returns the shipped PNG URL for HD and keeps the procedural SVG as fallback', () => {
      const source = cardArtSourceFor('Forest', 'hd', 64)
      expect(source.isRaster).toBe(true)
      expect(source.primaryUrl).toBe('/cards/hd/Forest.png')
      expect(source.proceduralUrl.startsWith('data:image/svg+xml')).toBe(true)
    })

    it('returns the shipped PNG URL for Monochrome (cartoon cats) and keeps the procedural SVG as fallback', () => {
      const source = cardArtSourceFor('Forest', 'monochrome', 64)
      expect(source.isRaster).toBe(true)
      expect(source.primaryUrl).toBe('/cards/monochrome/Forest.png')
      expect(source.proceduralUrl.startsWith('data:image/svg+xml')).toBe(true)
    })

    it('returns the procedural SVG as the primary URL for classic', () => {
      const source = cardArtSourceFor('Mountain', 'classic', 64)
      expect(source.isRaster).toBe(false)
      expect(source.primaryUrl.startsWith('data:image/svg+xml')).toBe(true)
      expect(source.primaryUrl).toBe(source.proceduralUrl)
    })

    it('forceProcedural: true keeps the procedural icon even for raster styles', () => {
      for (const style of ['hd', 'monochrome'] as const) {
        const source = cardArtSourceFor('Island', style, 16, { forceProcedural: true })
        expect(source.isRaster).toBe(false)
        expect(source.primaryUrl.startsWith('data:image/svg+xml')).toBe(true)
        expect(source.primaryUrl).toBe(source.proceduralUrl)
      }
    })
  })
})
