import { describe, expect, it } from 'vitest'

import { cullRowsToViewport, isLogRowVisible } from '../renderers/phaser/log-row-visibility'

// Viewport spans Y=100..300 in the parent coordinate space. Rows are described
// in the column-local space (rowTop is relative to columnOriginY).
const VIEWPORT = { viewportTopY: 100, viewportBottomY: 300 }

describe('isLogRowVisible (partial-overlap mode)', () => {
  it('shows rows fully inside the viewport', () => {
    expect(isLogRowVisible({
      rowTop: 20, rowHeight: 30, columnOriginY: 100, ...VIEWPORT, mode: 'overlap',
    })).toBe(true)
  })

  it('shows rows that partially overlap the top edge', () => {
    // Row spans 80..120 in parent space; partially above viewport top (100).
    expect(isLogRowVisible({
      rowTop: -20, rowHeight: 40, columnOriginY: 100, ...VIEWPORT, mode: 'overlap',
    })).toBe(true)
  })

  it('shows rows that partially overlap the bottom edge', () => {
    // Row spans 280..320 in parent space; partially below viewport bottom (300).
    expect(isLogRowVisible({
      rowTop: 180, rowHeight: 40, columnOriginY: 100, ...VIEWPORT, mode: 'overlap',
    })).toBe(true)
  })

  it('hides rows entirely above the viewport', () => {
    expect(isLogRowVisible({
      rowTop: -50, rowHeight: 20, columnOriginY: 100, ...VIEWPORT, mode: 'overlap',
    })).toBe(false)
  })

  it('hides rows entirely below the viewport', () => {
    expect(isLogRowVisible({
      rowTop: 250, rowHeight: 20, columnOriginY: 100, ...VIEWPORT, mode: 'overlap',
    })).toBe(false)
  })

  it('hides rows exactly flush outside the viewport edges', () => {
    expect(isLogRowVisible({
      rowTop: -40, rowHeight: 40, columnOriginY: 100, ...VIEWPORT, mode: 'overlap',
    })).toBe(false)
    expect(isLogRowVisible({
      rowTop: 200, rowHeight: 40, columnOriginY: 100, ...VIEWPORT, mode: 'overlap',
    })).toBe(false)
  })
})

describe('isLogRowVisible (fully-contained mode)', () => {
  const opts = { mode: 'contained' as const }

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

  it('hides rows fully outside the viewport', () => {
    expect(isLogRowVisible({
      rowTop: -50, rowHeight: 20, columnOriginY: 100, ...VIEWPORT, ...opts,
    })).toBe(false)
    expect(isLogRowVisible({
      rowTop: 250, rowHeight: 20, columnOriginY: 100, ...VIEWPORT, ...opts,
    })).toBe(false)
  })
})

class FakeRow {
  visible: boolean | null = null

  constructor(
    private readonly data: Record<string, number | undefined>,
    readonly y: number,
    readonly height: number,
  ) {}

  getData(key: string): number | undefined {
    return this.data[key]
  }

  setVisible(visible: boolean): void {
    this.visible = visible
  }
}

describe('cullRowsToViewport', () => {
  it('applies contained visibility to every cullable row', () => {
    const inside = new FakeRow({ rowTop: 20, rowHeight: 30 }, 999, 999)
    const partial = new FakeRow({ rowTop: -20, rowHeight: 40 }, 999, 999)
    const outside = new FakeRow({ rowTop: 250, rowHeight: 20 }, 999, 999)

    cullRowsToViewport({
      rowsContainer: { list: [inside, partial, outside, { label: 'not a row' }] },
      columnOriginY: 100,
      ...VIEWPORT,
      mode: 'contained',
    })

    expect(inside.visible).toBe(true)
    expect(partial.visible).toBe(false)
    expect(outside.visible).toBe(false)
  })

  it('falls back to row y and height when row metadata is absent', () => {
    const inside = new FakeRow({}, 20, 30)
    const partial = new FakeRow({}, -20, 40)

    cullRowsToViewport({
      rowsContainer: { list: [inside, partial] },
      columnOriginY: 100,
      ...VIEWPORT,
      mode: 'overlap',
    })

    expect(inside.visible).toBe(true)
    expect(partial.visible).toBe(true)
  })
})
