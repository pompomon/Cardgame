// Pure layout math for the Phaser renderer. Kept Phaser-free so it can be
// unit-tested under Node without bootstrapping a browser environment.

export type OrientationMode = 'vertical' | 'horizontal'

export interface SceneLayout {
  width: number
  height: number
  orientation: OrientationMode
  isCompact: boolean
  isCollapsed: boolean
  margin: number
  titleFontSize: string
  subtitleFontSize: string
  bodyFontSize: string
  smallFontSize: string
  headerTop: number
  headerHeight: number
  actionButtonWidth: number
  actionButtonHeight: number
  actionButtonGap: number
  cardWidth: number
  cardHeight: number
  cardGap: number
  bodyTop: number
  bodyHeight: number
  logColumnLeft: number
  logColumnTop: number
  logColumnWidth: number
  logColumnHeight: number
  boardColumnLeft: number
  boardColumnWidth: number
  boardColumnTop: number
  boardColumnHeight: number
  nonActiveInfoY: number
  nonActiveInfoHeight: number
  nonActiveBattlefieldY: number
  nonActiveBattlefieldHeight: number
  activeBattlefieldY: number
  activeBattlefieldHeight: number
  activeInfoY: number
  activeInfoHeight: number
  handCardsY: number
  controlsStartY: number
  responseInfoY: number
  // Vertical band inside the active-info row available for response/end-turn
  // controls: starts below the 2-line player info text and ends above the
  // hand-cards strip. Renderers should use this height to size their controls
  // so they never overlap the player info or the hand strip on short
  // viewports.
  activeInfoControlsTop: number
  activeInfoControlsHeight: number
  // Number of player-info text lines that fit above the controls band on the
  // active-info row. 2 = full label + counts, 1 = label only, 0 = no text
  // (drop the active-info text on extremely tight viewports so controls fit).
  activeInfoTextLines: number
  statusBottomOffset: number
  popupMaxWidth: number
  popupButtonHeight: number
  menuPopupWidth: number
  menuPopupHeight: number
  menuPopupPadding: number
  menuSectionGap: number
  menuTitleHeight: number
  menuLogViewportHeight: number
}

export const COMPACT_DIMENSION_THRESHOLD = 700
export const RESPONSIVE_COLLAPSE_WIDTH = 720
export const POPUP_MIN_WIDTH = 180

export function clamp(value: number, minValue: number, maxValue: number): number {
  const lower = Math.min(minValue, maxValue)
  const upper = Math.max(minValue, maxValue)
  return Math.min(upper, Math.max(lower, value))
}

export function orientationFromViewport(width: number, height: number): OrientationMode {
  return width >= height ? 'horizontal' : 'vertical'
}

export function buildLayout(width: number, height: number, orientation: OrientationMode): SceneLayout {
  const safeWidth = width > 0 ? width : 1
  const safeHeight = height > 0 ? height : 1
  const minDimension = Math.min(safeWidth, safeHeight)
  const isCompact = minDimension < COMPACT_DIMENSION_THRESHOLD
  const isCollapsed = safeWidth < RESPONSIVE_COLLAPSE_WIDTH
  const margin = Math.min(clamp(minDimension * 0.02, 10, 28), safeWidth / 2, safeHeight / 2)
  const contentWidth = Math.max(0, safeWidth - margin * 2)
  const bodyFontPx = clamp(minDimension * 0.018, 12, 18)
  const smallFontPx = clamp(bodyFontPx * 0.86, 10, 16)
  const subtitleFontPx = clamp(bodyFontPx * 1.08, 13, 22)
  const titleFontPx = clamp(bodyFontPx * 1.55, 18, 34)
  const titleFontSize = `${Math.round(titleFontPx)}px`
  const subtitleFontSize = `${Math.round(subtitleFontPx)}px`
  const bodyFontSize = `${Math.round(bodyFontPx)}px`
  const smallFontSize = `${Math.round(smallFontPx)}px`
  const actionButtonHeight = clamp(minDimension * 0.05, 32, 48)
  const actionButtonWidth = Math.min(
    contentWidth,
    clamp(
      safeWidth * (orientation === 'vertical' ? 0.36 : 0.24),
      150,
      orientation === 'vertical' ? 320 : 260,
    ),
  )
  const actionButtonGap = clamp(actionButtonHeight * 0.2, 6, 12)
  const cardWidth = clamp(safeWidth * (orientation === 'vertical' ? 0.13 : 0.09), 60, 120)
  const cardHeight = clamp(cardWidth * 1.35, 84, 162)
  const cardGap = clamp(cardWidth * 1.08, 66, 156)

  const headerTop = margin
  const headerHeight = actionButtonHeight + clamp(minDimension * 0.012, 6, 14)
  const bodyTop = headerTop + headerHeight + clamp(minDimension * 0.01, 6, 14)
  const statusBottomOffset = clamp(minDimension * 0.018, 14, 24)
  const bodyBottom = safeHeight - margin - statusBottomOffset - 8
  const bodyHeight = Math.max(160, bodyBottom - bodyTop)

  // Log column: capped at 25% viewport width, with a sensible minimum.
  const logColumnGap = 12
  const desiredLogWidth = clamp(safeWidth * 0.25 - logColumnGap, 180, Math.max(180, safeWidth * 0.4))
  const collapsedLogHeight = clamp(safeHeight * 0.2, 96, 200)

  let logColumnLeft: number
  let logColumnTop: number
  let logColumnWidth: number
  let logColumnHeight: number
  let boardColumnLeft: number
  let boardColumnWidth: number
  let boardColumnTop: number
  let boardColumnHeight: number

  if (isCollapsed) {
    // Single-column stacked layout: log on top, board below (mirrors DOM
    // `@media (max-width: 720px)` rule that flattens the grid to one column).
    logColumnLeft = margin
    logColumnTop = bodyTop
    logColumnWidth = Math.max(120, contentWidth)
    logColumnHeight = Math.min(collapsedLogHeight, Math.max(80, bodyHeight * 0.28))
    boardColumnLeft = margin
    boardColumnWidth = Math.max(160, contentWidth)
    boardColumnTop = logColumnTop + logColumnHeight + 8
    boardColumnHeight = Math.max(0, bodyBottom - boardColumnTop)
  } else {
    logColumnLeft = margin
    logColumnTop = bodyTop
    logColumnWidth = Math.max(160, Math.min(desiredLogWidth, contentWidth - 200))
    logColumnHeight = Math.max(120, bodyHeight)
    boardColumnLeft = margin + logColumnWidth + logColumnGap
    boardColumnWidth = Math.max(200, safeWidth - margin - boardColumnLeft)
    boardColumnTop = bodyTop
    boardColumnHeight = Math.max(160, bodyHeight)
  }

  // Stacked board rows: non-active info, non-active battlefield, active
  // battlefield, active info+hand (active anchored at bottom).
  const minBattlefieldHeight = Math.max(cardHeight + 28, 120)
  const minInfoHeight = Math.max(56, bodyFontPx * 4 + 16)
  const innerGap = 8
  const totalGapHeight = innerGap * 3
  const remainingHeight = Math.max(0, boardColumnHeight - totalGapHeight)
  // Allocate ~ 22% info / 28% battlefield / 28% battlefield / 22% info but
  // honor minimums so cards always fit. The active info row also reserves a
  // controls band (End Turn / response counters / Pass) above its hand strip;
  // include it in the raw size so the proportional scale below preserves
  // enough room for those buttons even on short viewports.
  const activeControlsBandReserve = 36
  const infoShare = 0.22
  const battlefieldShare = 0.28
  const nonActiveInfoHeightRaw = Math.max(minInfoHeight, remainingHeight * infoShare)
  const activeInfoHeightRaw = Math.max(
    minInfoHeight + cardHeight + 8 + activeControlsBandReserve,
    remainingHeight * infoShare + cardHeight + 8 + activeControlsBandReserve,
  )
  const battlefieldHeightRaw = Math.max(minBattlefieldHeight, remainingHeight * battlefieldShare)
  const totalRaw = nonActiveInfoHeightRaw + battlefieldHeightRaw + battlefieldHeightRaw + activeInfoHeightRaw
  const scale = totalRaw > 0 ? Math.min(1, remainingHeight / totalRaw) : 1
  // No post-scale floors: when totalRaw exceeds remainingHeight, scale shrinks
  // each row proportionally so the four rows always sum to remainingHeight.
  // Applying a Math.max(...) floor here would push the total back over the
  // available height and spill the active-player row outside the body area on
  // short viewports.
  const nonActiveInfoHeight = nonActiveInfoHeightRaw * scale
  const nonActiveBattlefieldHeight = battlefieldHeightRaw * scale
  const activeBattlefieldHeight = battlefieldHeightRaw * scale
  const activeInfoHeight = activeInfoHeightRaw * scale

  // Effective card dimensions: when the proportional `scale` above shrinks
  // battlefield or active-info rows below the desired cardHeight, cards drawn
  // at the original size would render outside their rows and overlap the
  // adjacent info panels. Derive a row-fitting cardHeight (preserving the
  // 1.35 aspect ratio) so cards always stay inside their assigned row.
  const cardRowFloor = 40
  const cardRowPadding = 12
  const cardWidthFloor = 28
  const cardGapFloor = 48
  const minRowForCards = Math.min(
    nonActiveBattlefieldHeight,
    activeBattlefieldHeight,
    activeInfoHeight,
  )
  const cardFitHeight = Math.max(cardRowFloor, minRowForCards - cardRowPadding)
  const effectiveCardHeight = Math.min(cardHeight, cardFitHeight)
  const effectiveCardWidth = effectiveCardHeight >= cardHeight
    ? cardWidth
    : Math.max(cardWidthFloor, effectiveCardHeight / 1.35)
  const effectiveCardGap = effectiveCardHeight >= cardHeight
    ? cardGap
    : Math.max(cardGapFloor, cardGap * (effectiveCardWidth / Math.max(1, cardWidth)))

  const nonActiveInfoY = boardColumnTop
  const nonActiveBattlefieldY = nonActiveInfoY + nonActiveInfoHeight + innerGap
  const activeBattlefieldY = nonActiveBattlefieldY + nonActiveBattlefieldHeight + innerGap
  const activeInfoY = activeBattlefieldY + activeBattlefieldHeight + innerGap
  // Hand cards centered toward the bottom of the active info row so the
  // active player's drag area lives at the bottom of the screen. Use the
  // effective card height so the hand strip always fits within the row.
  const handCardsY = activeInfoY + activeInfoHeight - effectiveCardHeight / 2 - 6
  // Player info text in renderPlayerInfoBlocks renders 2 lines starting at
  // activeInfoY + 6, so reserve that vertical band before placing the End Turn
  // button or the response prompt. Without this offset, the controls would
  // render directly on top of the active-player summary text.
  //
  // On short viewports (e.g. 1024x480) the active-info row gets shrunk by the
  // proportional `scale` above and the desired 2-line text band can consume
  // every pixel between activeInfoY and the hand strip, leaving the controls
  // band collapsed to 0. To keep End Turn / response controls usable, reserve
  // a minimum controls band and shrink the text band when necessary; the
  // text may render with only one fully-visible line in that case, but the
  // controls always have somewhere to land.
  const lineHeight = bodyFontPx * 1.25
  const handStripTop = handCardsY - effectiveCardHeight / 2 - 4
  const desiredTextBand = Math.ceil(lineHeight * 2)
  // Minimum click target for End Turn / response buttons. Prefer this over
  // a fully visible 2-line player-info text on tight viewports so the
  // controls remain usable. The text band shrinks to one line, then to zero,
  // before the controls band collapses.
  const minControlsBand = 28
  const desiredControlsBand = Math.max(minControlsBand, 32)
  const interBandGap = 4
  const availableAboveHand = Math.max(0, handStripTop - activeInfoY - 6)
  let textBand: number
  let controlsBand: number
  let textLines: number
  if (availableAboveHand >= desiredTextBand + desiredControlsBand + interBandGap) {
    // Full 2-line text + comfortable controls band.
    textBand = desiredTextBand
    controlsBand = availableAboveHand - desiredTextBand - interBandGap
    textLines = 2
  } else if (availableAboveHand >= desiredTextBand + minControlsBand + interBandGap) {
    // Full 2-line text, controls shrunk to the minimum click target plus extra.
    textBand = desiredTextBand
    controlsBand = availableAboveHand - desiredTextBand - interBandGap
    textLines = 2
  } else if (availableAboveHand >= Math.ceil(lineHeight) + minControlsBand + interBandGap) {
    // Reserve at least the min click target for controls; render single-line text.
    textBand = Math.ceil(lineHeight)
    controlsBand = availableAboveHand - textBand - interBandGap
    textLines = 1
  } else if (availableAboveHand >= minControlsBand) {
    // Extremely tight row: drop the player-info text entirely so controls
    // still fit. The active player's name/counts is duplicated by the
    // non-active panel and surfaced in the status footer, so dropping it
    // here is preferable to losing End Turn / response buttons.
    textBand = 0
    controlsBand = Math.min(availableAboveHand, desiredControlsBand)
    textLines = 0
  } else if (availableAboveHand >= interBandGap) {
    // Pathologically tight row: split equally so neither band fully vanishes.
    const half = Math.max(0, (availableAboveHand - interBandGap) / 2)
    textBand = half
    controlsBand = half
    textLines = half >= Math.ceil(lineHeight) ? 1 : 0
  } else {
    textBand = 0
    controlsBand = 0
    textLines = 0
  }
  const activeInfoTextBottom = activeInfoY + 6 + textBand
  const activeInfoControlsTop = activeInfoTextBottom + interBandGap
  const activeInfoControlsHeight = controlsBand
  const controlsStartY = activeInfoControlsTop + Math.min(actionButtonHeight, activeInfoControlsHeight) / 2
  const responseInfoY = activeInfoControlsTop

  const popupAvailableWidth = Math.max(0, safeWidth - margin * 2)
  const popupTargetWidth = Math.min(popupAvailableWidth, orientation === 'vertical' ? 520 : 760)
  const popupMaxWidth = Math.min(popupAvailableWidth, Math.max(POPUP_MIN_WIDTH, popupTargetWidth))
  const popupButtonHeight = clamp(actionButtonHeight * 1.05, 36, 48)
  const menuPopupPadding = isCompact ? 12 : 16
  const menuSectionGap = isCompact ? 8 : 10
  const menuTitleHeight = clamp(actionButtonHeight * 0.95, 30, 46)
  const menuPopupMaxWidth = Math.max(1, popupAvailableWidth)
  const menuPopupWidth = clamp(
    orientation === 'vertical' ? 560 : 760,
    Math.min(POPUP_MIN_WIDTH, menuPopupMaxWidth),
    menuPopupMaxWidth,
  )
  const menuPopupMaxHeight = Math.max(1, safeHeight - margin * 2)
  // The menu modal must always fit its fixed controls (Back/Rematch row,
  // orientation toggle, recorder heading + two recorder rows, start-replay or
  // replay-controls, close button). Compute a worst-case content height so the
  // popup is at least tall enough to keep every action reachable on short
  // phone-sized viewports — replay-log space comes from whatever is left over.
  const recorderHeadingHeight = 22
  const fixedButtonRows = 6 // back/rematch + orientation + 2 recorder rows + start-replay/end-section + close
  const replayControlsRows = 2 // worst case when replay is active
  const requiredMenuContentHeight =
    menuPopupPadding * 2
    + menuTitleHeight
    + recorderHeadingHeight * 2
    + popupButtonHeight * (fixedButtonRows + replayControlsRows)
    + menuSectionGap * 6
    + 24 // breathing room
  const menuPopupHeight = clamp(
    safeHeight * (orientation === 'vertical' ? 0.84 : 0.82),
    Math.min(requiredMenuContentHeight, menuPopupMaxHeight),
    menuPopupMaxHeight,
  )
  const menuLogViewportHeight = Math.max(
    80,
    menuPopupHeight - (
      menuPopupPadding * 2
      + menuTitleHeight
      + menuSectionGap * 4
      + popupButtonHeight * 6
      + 60
    ),
  )

  return {
    width: safeWidth,
    height: safeHeight,
    orientation,
    isCompact,
    isCollapsed,
    margin,
    titleFontSize,
    subtitleFontSize,
    bodyFontSize,
    smallFontSize,
    headerTop,
    headerHeight,
    actionButtonWidth,
    actionButtonHeight,
    actionButtonGap,
    cardWidth: effectiveCardWidth,
    cardHeight: effectiveCardHeight,
    cardGap: effectiveCardGap,
    bodyTop,
    bodyHeight,
    logColumnLeft,
    logColumnTop,
    logColumnWidth,
    logColumnHeight,
    boardColumnLeft,
    boardColumnWidth,
    boardColumnTop,
    boardColumnHeight,
    nonActiveInfoY,
    nonActiveInfoHeight,
    nonActiveBattlefieldY,
    nonActiveBattlefieldHeight,
    activeBattlefieldY,
    activeBattlefieldHeight,
    activeInfoY,
    activeInfoHeight,
    handCardsY,
    controlsStartY,
    responseInfoY,
    activeInfoControlsTop,
    activeInfoControlsHeight,
    activeInfoTextLines: textLines,
    statusBottomOffset,
    popupMaxWidth,
    popupButtonHeight,
    menuPopupWidth,
    menuPopupHeight,
    menuPopupPadding,
    menuSectionGap,
    menuTitleHeight,
    menuLogViewportHeight,
  }
}
