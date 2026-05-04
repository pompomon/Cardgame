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

  it('keeps the four board rows within the available board column on short viewports', () => {
    // Short viewport that forces totalRaw > remainingHeight so the proportional
    // scale kicks in. After scaling, the four rows + their three inner gaps
    // must still sum to <= boardColumnHeight (no spill of the active row
    // outside the body area).
    const layout = buildLayout(1024, 480, 'horizontal')
    const innerGap = 8
    const totalRowsAndGaps =
      layout.nonActiveInfoHeight
      + layout.nonActiveBattlefieldHeight
      + layout.activeBattlefieldHeight
      + layout.activeInfoHeight
      + innerGap * 3
    expect(totalRowsAndGaps).toBeLessThanOrEqual(layout.boardColumnHeight + 0.5)
  })

  it('makes the menu popup tall enough to fit its fixed control rows', () => {
    // On a short phone-sized viewport the menu popup used to bottom out at
    // 280px, which was less than the ~340px of fixed buttons (Back/Rematch +
    // orientation + recorder rows + Close), pushing the Close button below the
    // panel. The popup must now reserve enough height for its visible controls.
    const viewportHeight = 640
    const layout = buildLayout(360, viewportHeight, 'vertical')
    const minRequired =
      layout.menuPopupPadding * 2
      + layout.menuTitleHeight
      + layout.popupButtonHeight * 6
      + layout.menuSectionGap * 4
    expect(layout.menuPopupHeight).toBeGreaterThanOrEqual(Math.min(minRequired, viewportHeight - layout.margin * 2))
  })
})
