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

  it('keeps cards fitting inside their battlefield/active rows on short viewports', () => {
    // Same short viewport as the row-sum test. The proportional `scale` would
    // otherwise shrink battlefield rows below the desired cardHeight, causing
    // cards to render past the row into adjacent info panels. The layout must
    // expose effective cardHeight/cardWidth that fit within the row strip.
    const layout = buildLayout(1024, 480, 'horizontal')
    const cardRowPadding = 12
    expect(layout.cardHeight).toBeLessThanOrEqual(layout.nonActiveBattlefieldHeight - cardRowPadding + 0.5)
    expect(layout.cardHeight).toBeLessThanOrEqual(layout.activeBattlefieldHeight - cardRowPadding + 0.5)
    // Hand cards must also fit in the active info row with their bottom anchor.
    expect(layout.cardHeight).toBeLessThanOrEqual(layout.activeInfoHeight - cardRowPadding + 0.5)
    // Aspect ratio (cardHeight ≈ 1.35 * cardWidth) is preserved within a small
    // tolerance; the floor on cardWidth ensures cards are still visible.
    expect(layout.cardWidth).toBeGreaterThan(0)
    expect(layout.cardHeight / layout.cardWidth).toBeGreaterThan(1.2)
  })

  it('makes the menu popup tall enough to fit all worst-case control rows (replay + recorder)', () => {
    // The previous test only covered a 6-row baseline. The replay-active menu
    // additionally renders a "Replay Controls" heading and two extra control
    // rows (Play/Pause + Prev/Next + Jump to End / Exit Replay), and the
    // recorder section adds its own heading. The popup must be tall enough to
    // hold all of those plus the fixed buttons on phone-sized viewports.
    const viewportHeight = 640
    const layout = buildLayout(360, viewportHeight, 'vertical')
    // Worst case: 6 fixed button rows + 2 replay-control rows + recorder
    // heading + replay heading + section gaps + padding + title.
    const headingHeight = 22
    const worstCaseContent =
      layout.menuPopupPadding * 2
      + layout.menuTitleHeight
      + headingHeight * 2
      + layout.popupButtonHeight * (6 + 2)
      + layout.menuSectionGap * 6
    expect(layout.menuPopupHeight).toBeGreaterThanOrEqual(Math.min(worstCaseContent, viewportHeight - layout.margin * 2))
  })
})
