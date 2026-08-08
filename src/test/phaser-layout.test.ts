import { describe, expect, it } from 'vitest'
import {
  buildLayout,
  MENU_LOG_REMAINDER_RESERVE,
  MENU_LOG_VIEWPORT_MIN_HEIGHT,
} from '../renderers/phaser/layout'

describe('phaser buildLayout', () => {
  const px = (value: string): number => Number.parseFloat(value)

  it('restores the original layout after a phone rotates to landscape and back', () => {
    const portrait = buildLayout(673, 842, 'vertical')
    const landscape = buildLayout(842, 673, 'horizontal')
    const restored = buildLayout(673, 842, 'vertical')

    expect(portrait.isCollapsed).toBe(true)
    expect(landscape.isCollapsed).toBe(false)
    expect(restored).toEqual(portrait)
    expect(landscape.boardColumnLeft).toBe(landscape.safeAreaLeft + landscape.margin)
  })

  it('uses the full safe-area content width for the board in both orientations', () => {
    for (const layout of [
      buildLayout(1280, 820, 'horizontal'),
      buildLayout(600, 900, 'vertical'),
    ]) {
      expect(layout.boardColumnLeft).toBe(layout.safeAreaLeft + layout.margin)
      expect(layout.boardColumnWidth).toBe(layout.safeAreaWidth - layout.margin * 2)
      expect(layout.boardColumnLeft + layout.boardColumnWidth).toBeCloseTo(
        layout.safeAreaLeft + layout.safeAreaWidth - layout.margin,
      )
    }
  })

  it('places the active battlefield below the non-active battlefield (active anchored at bottom)', () => {
    const layout = buildLayout(1280, 820, 'horizontal')
    expect(layout.nonActiveInfoY).toBeLessThan(layout.nonActiveBattlefieldY)
    expect(layout.nonActiveBattlefieldY).toBeLessThan(layout.activeBattlefieldY)
    expect(layout.activeBattlefieldY).toBeLessThan(layout.activeInfoY)
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
    // Aspect ratio (cardHeight ≈ 1.35 * cardWidth) is preserved within a small
    // tolerance; the floor on cardWidth ensures cards are still visible.
    expect(layout.cardWidth).toBeGreaterThan(0)
    expect(layout.cardHeight / layout.cardWidth).toBeGreaterThan(1.2)
  })

  it('makes the menu popup tall enough to fit all worst-case control rows (replay + recorder)', () => {
    // The previous test only covered a 5-row baseline. The replay-active menu
    // additionally renders a "Replay Controls" heading and two extra control
    // rows (Play/Pause + Prev/Next + Jump to End / Exit Replay), and the
    // recorder section adds its own heading. The popup must be tall enough to
    // hold all of those plus the fixed buttons on phone-sized viewports.
    const viewportHeight = 640
    const layout = buildLayout(360, viewportHeight, 'vertical')
    // Worst case: 5 fixed button rows + 2 replay-control rows + recorder
    // heading + replay heading + section gaps + padding + title.
    const headingHeight = 22
    const worstCaseContent =
      layout.menuPopupPadding * 2
      + layout.menuTitleHeight
      + headingHeight * 2
      + layout.popupButtonHeight * (5 + 2)
      + layout.menuSectionGap * 6
    expect(layout.menuPopupHeight).toBeGreaterThanOrEqual(Math.min(worstCaseContent, viewportHeight - layout.margin * 2))
  })

  it('adds extra menu height reserve for wrapped recorder/replay heading text on narrow portrait', () => {
    const viewportHeight = 740
    const layout = buildLayout(320, viewportHeight, 'vertical')
    const headingHeight = 22
    const wrappedHeadingLineHeight = Math.round(Math.min(18, Math.max(12, layout.popupButtonHeight * 0.42)))
    const wrappedHeadingOverflowReserve = wrappedHeadingLineHeight * 3 + layout.menuSectionGap
    const worstCaseWrappedContent =
      layout.menuPopupPadding * 2
      + layout.menuTitleHeight
      + headingHeight * 2
      + layout.popupButtonHeight * (5 + 2)
      + layout.menuSectionGap * 6
      + wrappedHeadingOverflowReserve
      + 24
    expect(layout.menuPopupHeight).toBeGreaterThanOrEqual(Math.min(worstCaseWrappedContent, viewportHeight - layout.margin * 2))
  })

  it('reserves landscape side lanes for active-info controls and the hand', () => {
    const layout = buildLayout(1024, 480, 'horizontal')
    expect(layout.activeInfoControlsTop).toBe(layout.activeInfoY + 6)
    const activeInfoBottom = layout.activeInfoY + layout.activeInfoHeight
    expect(layout.activeInfoControlsTop + layout.activeInfoControlsHeight).toBeLessThanOrEqual(activeInfoBottom + 0.5)
    expect(layout.handColumnLeft).toBeGreaterThan(layout.boardColumnLeft)
    expect(layout.handColumnLeft + layout.handColumnWidth).toBeLessThan(
      layout.boardColumnLeft + layout.boardColumnWidth,
    )
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
    expect(layout.handColumnWidth).toBeGreaterThan(0)
  })

  it('does not insert an extra inter-band gap when portrait active-info text is dropped to 0 lines', () => {
    // On very short split layouts textLines can be 0. In that case controls
    // should start directly at activeInfoY + 6, without an extra 4px gap that
    // steals space from the controls band and can push it into the hand strip.
    let layout = buildLayout(600, 500, 'vertical')
    if (layout.activeInfoTextLines !== 0) {
      layout = buildLayout(600, 400, 'vertical')
    }
    expect(layout.activeInfoTextLines).toBe(0)
    expect(layout.activeInfoControlsTop).toBeCloseTo(layout.activeInfoY + 6, 4)
  })

  it('keeps cards within row bounds on very short split layouts', () => {
    const layout = buildLayout(720, 300, 'horizontal')
    const cardRowPadding = 12
    expect(layout.cardHeight).toBeLessThanOrEqual(layout.nonActiveBattlefieldHeight - cardRowPadding + 0.5)
    expect(layout.cardHeight).toBeLessThanOrEqual(layout.activeBattlefieldHeight - cardRowPadding + 0.5)
  })

  it('keeps the board inside the viewport on very short heights', () => {
    const viewportHeight = 220
    const layout = buildLayout(720, viewportHeight, 'horizontal')
    const contentBottom = viewportHeight - layout.margin - layout.statusBottomOffset - 8
    expect(layout.boardColumnTop + layout.boardColumnHeight).toBeLessThanOrEqual(contentBottom + 0.5)
  })

  it('enforces larger touch-target button heights on collapsed mobile portrait', () => {
    const layout = buildLayout(390, 844, 'vertical')
    expect(layout.isCollapsed).toBe(true)
    expect(layout.actionButtonHeight).toBeGreaterThanOrEqual(44)
    expect(layout.popupButtonHeight).toBeGreaterThanOrEqual(44)
  })

  it('fills the landscape hand row height while preserving side lanes for information and controls', () => {
    const layout = buildLayout(932, 430, 'horizontal')
    expect(layout.handCardHeight).toBeCloseTo(layout.activeInfoHeight - 12, 4)
    expect(layout.handCardHeight / layout.handCardWidth).toBeCloseTo(1.35, 4)
    expect(layout.handCardsY - layout.handCardHeight / 2).toBeGreaterThanOrEqual(layout.activeInfoY)
    expect(layout.handCardsY + layout.handCardHeight / 2).toBeLessThanOrEqual(
      layout.activeInfoY + layout.activeInfoHeight,
    )
    expect(layout.handColumnLeft).toBeGreaterThan(layout.boardColumnLeft)
    expect(layout.handColumnLeft + layout.handColumnWidth).toBeLessThan(
      layout.boardColumnLeft + layout.boardColumnWidth,
    )
    expect(layout.activeInfoControlsHeight).toBeGreaterThanOrEqual(28)
  })

  it('retains standard card dimensions for the portrait hand', () => {
    const layout = buildLayout(390, 844, 'vertical')
    expect(layout.handCardWidth).toBe(layout.cardWidth)
    expect(layout.handCardHeight).toBe(layout.cardHeight)
    expect(layout.handCardGap).toBe(layout.cardGap)
    expect(layout.handColumnLeft).toBe(layout.boardColumnLeft)
    expect(layout.handColumnWidth).toBe(layout.boardColumnWidth)
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

  it('keeps menu replay-log viewport bounded within the menu content viewport on narrow portrait', () => {
    const layout = buildLayout(320, 740, 'vertical')
    const contentViewportHeight =
      layout.menuPopupHeight
      - layout.menuPopupPadding * 2
      - layout.menuTitleHeight
      - layout.menuSectionGap
    expect(contentViewportHeight).toBeGreaterThan(0)
    expect(layout.menuLogViewportHeight).toBeLessThanOrEqual(contentViewportHeight)
  })

  it('uses full replay-log remainder when it exceeds the viewport minimum', () => {
    const layout = buildLayout(1280, 900, 'horizontal')
    const replayLogRemainder =
      layout.menuPopupHeight
      - (
        layout.menuPopupPadding * 2
        + layout.menuTitleHeight
        + layout.menuSectionGap * 4
        + layout.popupButtonHeight * 5
        + MENU_LOG_REMAINDER_RESERVE
      )
    expect(replayLogRemainder).toBeGreaterThan(MENU_LOG_VIEWPORT_MIN_HEIGHT)
    expect(layout.menuLogViewportHeight).toBe(replayLogRemainder)
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

  it('offsets the content region by top and bottom safe-area insets', () => {
    const layout = buildLayout(390, 844, 'vertical', {
      top: 44,
      bottom: 34,
      left: 0,
      right: 0,
    })
    expect(layout.safeAreaTop).toBe(44)
    expect(layout.safeAreaBottom).toBe(34)
    expect(layout.safeAreaHeight).toBe(844 - 44 - 34)
    // Header and body begin inside the safe area instead of hugging viewport y=0.
    expect(layout.headerTop).toBeGreaterThanOrEqual(layout.safeAreaTop)
    expect(layout.bodyTop).toBeGreaterThan(layout.headerTop)
    // Status baseline reserve includes the bottom inset budget.
    expect(layout.statusBottomOffset).toBeGreaterThanOrEqual(layout.safeAreaBottom)
  })

  it('keeps split columns inside left and right safe-area insets', () => {
    const layout = buildLayout(932, 430, 'horizontal', {
      left: 47,
      right: 47,
      top: 0,
      bottom: 21,
    })
    const safeRight = layout.width - layout.safeAreaRight
    expect(layout.safeAreaLeft).toBe(47)
    expect(layout.safeAreaRight).toBe(47)
    expect(layout.safeAreaWidth).toBe(932 - 47 - 47)
    expect(layout.boardColumnLeft).toBeGreaterThanOrEqual(layout.safeAreaLeft)
    expect(layout.boardColumnLeft + layout.boardColumnWidth).toBeLessThanOrEqual(safeRight + 0.5)
    expect(layout.handColumnLeft).toBeGreaterThanOrEqual(layout.boardColumnLeft)
    expect(layout.handColumnLeft + layout.handColumnWidth).toBeLessThanOrEqual(
      layout.boardColumnLeft + layout.boardColumnWidth,
    )
  })
})
