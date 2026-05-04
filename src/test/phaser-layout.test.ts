import { describe, expect, it } from 'vitest'
import { buildLayout } from '../renderers/phaser/layout'

describe('phaser buildLayout', () => {
  it('caps the log column at ~25% of viewport width on wide screens', () => {
    const layout = buildLayout(1280, 820, 'horizontal')
    expect(layout.isCollapsed).toBe(false)
    // Log column width should be no larger than 25% of the viewport width
    // (matches DOM `.log { max-width: 25vw }` rule).
    expect(layout.logColumnWidth).toBeLessThanOrEqual(1280 * 0.25)
    // Board column starts to the right of the log column, leaving non-zero
    // remaining width for the battlefield rows.
    expect(layout.boardColumnLeft).toBeGreaterThan(layout.logColumnLeft + layout.logColumnWidth)
    expect(layout.boardColumnWidth).toBeGreaterThan(0)
  })

  it('places the active battlefield below the non-active battlefield (active anchored at bottom)', () => {
    const layout = buildLayout(1280, 820, 'horizontal')
    expect(layout.nonActiveInfoY).toBeLessThan(layout.nonActiveBattlefieldY)
    expect(layout.nonActiveBattlefieldY).toBeLessThan(layout.activeBattlefieldY)
    expect(layout.activeBattlefieldY).toBeLessThan(layout.activeInfoY)
  })

  it('collapses to a single column with the log on top below 720px width', () => {
    const layout = buildLayout(600, 900, 'vertical')
    expect(layout.isCollapsed).toBe(true)
    // Log and board share the same horizontal column when collapsed.
    expect(layout.logColumnLeft).toBe(layout.boardColumnLeft)
    expect(layout.logColumnWidth).toBe(layout.boardColumnWidth)
    // Log sits above the board.
    expect(layout.logColumnTop + layout.logColumnHeight).toBeLessThanOrEqual(layout.boardColumnTop)
  })

  it('keeps the split layout above the 720px collapse threshold', () => {
    const layout = buildLayout(720, 600, 'horizontal')
    expect(layout.isCollapsed).toBe(false)
  })
})
