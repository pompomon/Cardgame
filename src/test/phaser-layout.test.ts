import { describe, expect, it } from 'vitest'
import { buildLayout } from '../renderers/phaser/layout'

describe('phaser buildLayout', () => {
  const px = (value: string): number => Number.parseFloat(value)

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

  it('reserves the active-info controls band below the player-info text and above the hand strip', () => {
    // On a short landscape viewport the renderer must place End Turn / response
    // controls in a band that does not overlap the 2-line player info text at
    // the top of the active-info row, nor the hand strip anchored at its
    // bottom. The layout exposes activeInfoControlsTop / activeInfoControlsHeight
    // so renderers can size their controls to fit that band exactly.
    const layout = buildLayout(1024, 480, 'horizontal')
    expect(layout.activeInfoControlsTop).toBeGreaterThan(layout.activeInfoY + 6)
    const activeInfoBottom = layout.activeInfoY + layout.activeInfoHeight
    expect(layout.activeInfoControlsTop + layout.activeInfoControlsHeight).toBeLessThanOrEqual(activeInfoBottom + 0.5)
    // The band must not overlap the hand strip (cards centered at handCardsY,
    // top edge at handCardsY - cardHeight / 2).
    const handStripTop = layout.handCardsY - layout.cardHeight / 2
    expect(layout.activeInfoControlsTop + layout.activeInfoControlsHeight).toBeLessThanOrEqual(handStripTop + 0.5)
    // The band must be tall enough to host at least one usable control (End
    // Turn / counter / Pass button); a band of 0 means the renderer has no
    // visible space for those actions on the short viewport this test guards.
    expect(layout.activeInfoControlsHeight).toBeGreaterThanOrEqual(24)
  })

  it('keeps the active-info controls band usable on a 720x360 split landscape viewport', () => {
    // 720x360 stays just above the responsive collapse width, so the layout
    // splits log/board into two columns. Earlier iterations of this layout
    // produced an activeInfoControlsHeight of ~14px here, which collapsed
    // End Turn / response buttons below the min click target. The band must
    // be at least the 28px min-click-target high, even if that means the
    // active-info text band shrinks to one line (or zero on extreme rows).
    const layout = buildLayout(720, 360, 'horizontal')
    expect(layout.activeInfoControlsHeight).toBeGreaterThanOrEqual(28)
    expect(layout.activeInfoTextLines).toBeGreaterThanOrEqual(0)
    expect(layout.activeInfoTextLines).toBeLessThanOrEqual(2)
    const handStripTop = layout.handCardsY - layout.cardHeight / 2
    expect(layout.activeInfoControlsTop + layout.activeInfoControlsHeight).toBeLessThanOrEqual(handStripTop + 0.5)
  })

  it('does not insert an extra inter-band gap when active-info text is dropped to 0 lines', () => {
    // On very short split layouts textLines can be 0. In that case controls
    // should start directly at activeInfoY + 6, without an extra 4px gap that
    // steals space from the controls band and can push it into the hand strip.
    let layout = buildLayout(720, 340, 'horizontal')
    if (layout.activeInfoTextLines !== 0) {
      layout = buildLayout(720, 320, 'horizontal')
    }
    expect(layout.activeInfoTextLines).toBe(0)
    expect(layout.activeInfoControlsTop).toBeCloseTo(layout.activeInfoY + 6, 4)
  })

  it('keeps cards within row bounds on very short split layouts', () => {
    const layout = buildLayout(720, 300, 'horizontal')
    const cardRowPadding = 12
    expect(layout.cardHeight).toBeLessThanOrEqual(layout.nonActiveBattlefieldHeight - cardRowPadding + 0.5)
    expect(layout.cardHeight).toBeLessThanOrEqual(layout.activeBattlefieldHeight - cardRowPadding + 0.5)
    expect(layout.cardHeight).toBeLessThanOrEqual(layout.activeInfoHeight - cardRowPadding + 0.5)
  })

  it('keeps split log/board columns inside the viewport on very short heights', () => {
    const viewportHeight = 220
    const layout = buildLayout(720, viewportHeight, 'horizontal')
    const contentBottom = viewportHeight - layout.margin - layout.statusBottomOffset - 8
    expect(layout.logColumnTop + layout.logColumnHeight).toBeLessThanOrEqual(contentBottom + 0.5)
    expect(layout.boardColumnTop + layout.boardColumnHeight).toBeLessThanOrEqual(contentBottom + 0.5)
  })

  it('keeps the replay-log column fully below the header strip on mobile portrait', () => {
    const layout = buildLayout(360, 800, 'vertical')
    const headerBottom = layout.headerTop + layout.headerHeight
    expect(layout.logColumnTop).toBeGreaterThanOrEqual(layout.bodyTop)
    expect(layout.logColumnTop).toBeGreaterThanOrEqual(headerBottom)
  })

  it('uses opaque popup layers while keeping scrim dimming configurable', () => {
    const layout = buildLayout(1024, 480, 'horizontal')
    expect(layout.popupPanelAlpha).toBe(1)
    expect(layout.popupBackdropAlpha).toBe(1)
    expect(layout.popupViewportAlpha).toBe(1)
    expect(layout.popupScrimAlpha).toBeGreaterThan(0)
    expect(layout.popupScrimAlpha).toBeLessThan(1)
  })

  it('keeps menu content viewport inside popup bounds on short mobile heights', () => {
    const layout = buildLayout(360, 420, 'vertical')
    const contentViewportHeight =
      layout.menuPopupHeight
      - layout.menuPopupPadding * 2
      - layout.menuTitleHeight
      - layout.menuSectionGap
    expect(contentViewportHeight).toBeGreaterThan(0)
    expect(contentViewportHeight).toBeLessThanOrEqual(layout.menuPopupHeight)
  })

  it('does not budget a menu log viewport larger than available replay-log remainder', () => {
    const layout = buildLayout(360, 640, 'vertical')
    const replayLogRemainder =
      layout.menuPopupHeight
      - (
        layout.menuPopupPadding * 2
        + layout.menuTitleHeight
        + layout.menuSectionGap * 4
        + layout.popupButtonHeight * 6
        + 60
      )
    expect(layout.menuLogViewportHeight).toBeLessThanOrEqual(Math.max(80, replayLogRemainder))
  })

  it('derives button typography from button geometry across viewport sizes', () => {
    const compactLayout = buildLayout(360, 640, 'vertical')
    const wideLayout = buildLayout(1280, 820, 'horizontal')
    expect(px(compactLayout.actionButtonFontSize)).toBeGreaterThanOrEqual(12)
    expect(px(compactLayout.popupButtonFontSize)).toBeGreaterThanOrEqual(px(compactLayout.actionButtonFontSize))
    expect(px(wideLayout.actionButtonFontSize)).toBeGreaterThanOrEqual(px(compactLayout.actionButtonFontSize))
    expect(px(wideLayout.popupButtonFontSize)).toBeGreaterThanOrEqual(px(compactLayout.popupButtonFontSize))
    expect(px(wideLayout.popupTitleFontSize)).toBeGreaterThanOrEqual(px(compactLayout.popupTitleFontSize))
    expect(px(wideLayout.popupButtonFontSize)).toBeLessThanOrEqual(24)
  })
})
