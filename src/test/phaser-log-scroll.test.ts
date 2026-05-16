import { describe, expect, it } from 'vitest'

import { computeLogScrollLayout } from '../renderers/phaser/log-scroll'

// These tests lock the scroll-clamping math that prevents in-scene log tiles
// from rendering above the menu/header or below the player-info container.
// The renderer relies on this helper for both the in-scene log viewport and
// the menu-overlay log viewport.
describe('computeLogScrollLayout', () => {
  it('pins to top when content fits inside the viewport (no negative offset)', () => {
    const result = computeLogScrollLayout({
      contentTopY: 100,
      viewportTopY: 100,
      viewportBottomY: 300,
      contentHeight: 80, // shorter than viewport (200px)
      bottomPadding: 6,
      requestedOffset: null,
      pinnedToBottom: true,
    })
    expect(result.maxScroll).toBe(0)
    expect(result.scrollOffset).toBe(0)
    // contentY must NEVER go above contentTopY when content fits, otherwise
    // tiles spill upward into the header strip (the bug we are fixing).
    expect(result.contentY).toBe(100)
    expect(result.pinnedToBottom).toBe(true)
  })

  it('pins to bottom when requested offset is null and content overflows', () => {
    const result = computeLogScrollLayout({
      contentTopY: 100,
      viewportTopY: 100,
      viewportBottomY: 300,
      contentHeight: 500, // way larger than viewport
      bottomPadding: 0,
      requestedOffset: null,
      pinnedToBottom: true,
    })
    expect(result.maxScroll).toBe(300) // 500 - (300-100)
    expect(result.scrollOffset).toBe(300)
    expect(result.contentY).toBe(-200) // 100 - 300
    expect(result.pinnedToBottom).toBe(true)
  })

  it('clamps a requested offset above maxScroll back to maxScroll', () => {
    const result = computeLogScrollLayout({
      contentTopY: 100,
      viewportTopY: 100,
      viewportBottomY: 300,
      contentHeight: 400,
      bottomPadding: 0,
      requestedOffset: 99999,
      pinnedToBottom: false,
    })
    expect(result.scrollOffset).toBe(200)
    expect(result.pinnedToBottom).toBe(true)
  })

  it('clamps a negative requested offset back to 0', () => {
    const result = computeLogScrollLayout({
      contentTopY: 100,
      viewportTopY: 100,
      viewportBottomY: 300,
      contentHeight: 400,
      bottomPadding: 0,
      requestedOffset: -50,
      pinnedToBottom: false,
    })
    expect(result.scrollOffset).toBe(0)
    expect(result.contentY).toBe(100)
    expect(result.pinnedToBottom).toBe(false)
  })

  it('honors bottomPadding so the last tile is not flush against the panel edge', () => {
    const result = computeLogScrollLayout({
      contentTopY: 0,
      viewportTopY: 0,
      viewportBottomY: 100,
      contentHeight: 100,
      bottomPadding: 12,
      requestedOffset: null,
      pinnedToBottom: true,
    })
    // Effective content (112) exceeds viewport (100) by 12 -> maxScroll = 12.
    expect(result.maxScroll).toBe(12)
    expect(result.scrollOffset).toBe(12)
  })

  it('preserves the invariant: contentY in [viewportTopY - maxScroll, viewportTopY] for arbitrary offsets', () => {
    const cases = [
      { contentHeight: 0, requested: null },
      { contentHeight: 50, requested: null },
      { contentHeight: 200, requested: 0 },
      { contentHeight: 200, requested: 50 },
      { contentHeight: 200, requested: 1000 },
      { contentHeight: 5000, requested: -1000 },
    ]
    for (const c of cases) {
      const result = computeLogScrollLayout({
        contentTopY: 200,
        viewportTopY: 200,
        viewportBottomY: 400,
        contentHeight: c.contentHeight,
        bottomPadding: 6,
        requestedOffset: c.requested,
        pinnedToBottom: c.requested === null,
      })
      expect(result.contentY).toBeLessThanOrEqual(200)
      expect(result.contentY).toBeGreaterThanOrEqual(200 - result.maxScroll)
      // When the viewport could still scroll further (content overflows),
      // the bottom of the rendered content must reach or pass the viewport
      // bottom. When content fits, this invariant doesn't apply because the
      // tile column simply ends inside the viewport.
      if (result.maxScroll > 0 && result.pinnedToBottom) {
        const effectiveBottom = result.contentY + c.contentHeight + 6
        expect(effectiveBottom).toBeGreaterThanOrEqual(400 - 0.5)
      }
    }
  })

  it('treats degenerate (zero-height) viewports as fully scrolled', () => {
    const result = computeLogScrollLayout({
      contentTopY: 0,
      viewportTopY: 0,
      viewportBottomY: 0,
      contentHeight: 50,
      bottomPadding: 0,
      requestedOffset: null,
      pinnedToBottom: true,
    })
    expect(result.maxScroll).toBe(50)
    expect(result.scrollOffset).toBe(50)
  })
})
