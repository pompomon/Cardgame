import { describe, expect, it } from 'vitest'
import { canPreviewCard, isCardPreviewSuppressed } from '../renderers/card-preview'
import { computeCardPreviewLayout } from '../renderers/phaser/card-preview'

describe('card preview policy', () => {
  it('allows ordinary cards during normal play', () => {
    const context = { phase: 'main' as const, pendingPlayLandTargetSelection: false, menuOpen: false }
    expect(canPreviewCard(context)).toBe(true)
    expect(canPreviewCard(context, true)).toBe(false)
  })

  it('suppresses previews during every target-selection path and menus', () => {
    expect(isCardPreviewSuppressed({ phase: 'main', pendingPlayLandTargetSelection: true, menuOpen: false })).toBe(true)
    expect(isCardPreviewSuppressed({ phase: 'plains_target', pendingPlayLandTargetSelection: false, menuOpen: false })).toBe(true)
    expect(isCardPreviewSuppressed({ phase: 'swamp_target', pendingPlayLandTargetSelection: false, menuOpen: false })).toBe(true)
    expect(isCardPreviewSuppressed({ phase: 'main', pendingPlayLandTargetSelection: false, menuOpen: true })).toBe(true)
  })
})

describe('Phaser card preview layout', () => {
  it('preserves card scale and keeps the preview inside the safe area', () => {
    const preview = computeCardPreviewLayout({
      viewportWidth: 390,
      viewportHeight: 844,
      safeAreaLeft: 0,
      safeAreaTop: 44,
      safeAreaWidth: 390,
      safeAreaHeight: 766,
      cardWidth: 60,
      cardHeight: 84,
      margin: 12,
    })

    expect(preview.scale).toBeGreaterThan(1)
    expect(preview.centerX).toBe(195)
    expect(preview.centerY).toBe(427)
    expect(60 * preview.scale).toBeLessThanOrEqual(366)
    expect(84 * preview.scale).toBeLessThanOrEqual(742)
  })

  it('never shrinks cards in very small viewports', () => {
    const preview = computeCardPreviewLayout({
      viewportWidth: 40,
      viewportHeight: 40,
      safeAreaLeft: 0,
      safeAreaTop: 0,
      safeAreaWidth: 40,
      safeAreaHeight: 40,
      cardWidth: 60,
      cardHeight: 84,
      margin: 12,
    })

    expect(preview.scale).toBe(1)
  })

  it('keeps the preview inside a landscape safe area', () => {
    const preview = computeCardPreviewLayout({
      viewportWidth: 2000,
      viewportHeight: 748,
      safeAreaLeft: 76,
      safeAreaTop: 68,
      safeAreaWidth: 1924,
      safeAreaHeight: 680,
      cardWidth: 72,
      cardHeight: 100,
      margin: 16,
    })

    expect(preview.centerX).toBe(1038)
    expect(preview.centerY).toBe(408)
    expect(72 * preview.scale).toBeLessThanOrEqual(1892)
    expect(100 * preview.scale).toBeLessThanOrEqual(648)
  })
})
