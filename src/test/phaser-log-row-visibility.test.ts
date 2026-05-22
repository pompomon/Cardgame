import { describe, expect, it } from 'vitest'

import { isLogRowVisible } from '../renderers/phaser/log-row-visibility'

// Viewport spans Y=100..300 in the parent coordinate space. Rows are described
// in the column-local space (rowTop is relative to columnOriginY).
const VIEWPORT = { viewportTopY: 100, viewportBottomY: 300 }

describe('isLogRowVisible (partial-overlap mode)', () => {
  it('shows rows fully inside the viewport', () => {
    expect(isLogRowVisible({
      rowTop: 20, rowHeight: 30, columnOriginY: 100, ...VIEWPORT,
    })).toBe(true)
  })

  it('shows rows that partially overlap the top edge', () => {
    // Row spans 80..120 in parent space; partially above viewport top (100).
    expect(isLogRowVisible({
      rowTop: -20, rowHeight: 40, columnOriginY: 100, ...VIEWPORT,
    })).toBe(true)
  })

  it('hides rows entirely above the viewport', () => {
    expect(isLogRowVisible({
      rowTop: -50, rowHeight: 20, columnOriginY: 100, ...VIEWPORT,
    })).toBe(false)
  })

  it('hides rows entirely below the viewport', () => {
    expect(isLogRowVisible({
      rowTop: 250, rowHeight: 20, columnOriginY: 100, ...VIEWPORT,
    })).toBe(false)
  })
})

describe('isLogRowVisible (fully-contained mode)', () => {
  const opts = { fullyContainedOnly: true as const }

  it('shows rows fully inside the viewport', () => {
    expect(isLogRowVisible({
      rowTop: 20, rowHeight: 30, columnOriginY: 100, ...VIEWPORT, ...opts,
    })).toBe(true)
  })

  it('hides rows that partially overlap the top edge', () => {
    // Regression guard for the in-scene Replay Log: a partial top row must
    // NOT paint over the "Replay Log" heading or the header strip above it.
    expect(isLogRowVisible({
      rowTop: -20, rowHeight: 40, columnOriginY: 100, ...VIEWPORT, ...opts,
    })).toBe(false)
  })

  it('hides rows that partially overlap the bottom edge', () => {
    expect(isLogRowVisible({
      rowTop: 180, rowHeight: 40, columnOriginY: 100, ...VIEWPORT, ...opts,
    })).toBe(false)
  })

  it('treats a row flush with both viewport edges as visible', () => {
    expect(isLogRowVisible({
      rowTop: 0, rowHeight: 200, columnOriginY: 100, ...VIEWPORT, ...opts,
    })).toBe(true)
  })
})
