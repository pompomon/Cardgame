import { beforeEach, describe, expect, it } from 'vitest'
import { noteRasterCardArtLoadFailure, renderCardTile, renderLandIcon, resetRasterCardArtLoadFailuresForTests } from '../renderers/dom'

describe('DOM renderer card tile output', () => {
  beforeEach(() => {
    resetRasterCardArtLoadFailuresForTests()
  })

  it('renders HD card tiles using the shipped PNG with a raster icon class', () => {
    const html = renderCardTile('Forest', 'hd')
    expect(html).toContain('src="/cards/hd/Forest.png"')
    expect(html).toContain('card-tile-icon--raster')
    expect(html).toContain('card-tile--raster')
    // The neon palette swatch must be suppressed for raster tiles so the
    // PNG art is not stacked under a colored fill.
    expect(html).not.toContain('--tile-fill:')
    // Procedural SVG is retained as the `onerror` fallback so cards stay
    // visible even when the PNG fails to load.
    expect(html).toContain('onerror=')
    expect(html).toContain('data:image/svg+xml')
  })

  it('renders Classic and Monochrome card tiles using the procedural SVG and palette swatch', () => {
    for (const style of ['classic', 'monochrome'] as const) {
      const html = renderCardTile('Mountain', style)
      expect(html).not.toContain(`src="/cards/${style}/Mountain.png"`)
      expect(html).toContain('src="data:image/svg+xml')
      expect(html).toContain('--tile-fill:')
      expect(html).not.toContain('card-tile--raster')
      expect(html).not.toContain('card-tile-icon--raster')
      expect(html).not.toContain('onerror=')
    }
  })

  it('keeps the procedural icon for tiny action glyphs even in HD mode', () => {
    const html = renderLandIcon('Island', 'hd', 16, 'action-icon', { forceProcedural: true })
    expect(html).toContain('src="data:image/svg+xml')
    expect(html).not.toContain('/cards/hd/Island.png')
    expect(html).not.toContain('action-icon--raster')
    expect(html).not.toContain('onerror=')
  })

  it('uses the HD PNG (with raster class) for normal-sized HD glyphs', () => {
    const html = renderLandIcon('Swamp', 'hd', 22, 'card-tile-icon')
    expect(html).toContain('src="/cards/hd/Swamp.png"')
    expect(html).toContain('card-tile-icon--raster')
  })

  it('uses procedural art directly after a raster URL has failed in-session', () => {
    noteRasterCardArtLoadFailure('/cards/hd/Forest.png')
    const html = renderLandIcon('Forest', 'hd', 22, 'card-tile-icon')
    expect(html).toContain('src="data:image/svg+xml')
    expect(html).not.toContain('/cards/hd/Forest.png')
    expect(html).not.toContain('card-tile-icon--raster')
    expect(html).not.toContain('onerror=')
  })
})
