import Phaser from 'phaser'

import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import type { AppViewModel, GameUiState } from '../../app/types'
import type { LogEvent } from '../../game/types'
import { DEPTH_MENU_OVERLAY } from './depth'
import type { SceneLayout } from './layout'
import { cullRowsToViewport } from './log-row-visibility'
import { computeLogScrollLayout } from './log-scroll'
import { bindScrollableViewport } from './scrollable-viewport'

const SCROLL_INDICATOR_RIGHT_OFFSET = 10
const LOG_VIEWPORT_HORIZONTAL_PADDING = 10
const MIN_READABLE_LOG_VIEWPORT_HEIGHT = 36
const POPUP_CLOSE_BUTTON_WIDTH_RATIO = 0.5
const POPUP_CLOSE_BUTTON_MIN_WIDTH = 160

export interface MenuOverlayTheme {
  buttonStroke: number
  panelFill: number
  panelStroke: number
  viewportFill: number
  backdropFill: number
  scrimFill: number
  primaryText: string
  secondaryText: string
}

export type MenuOverlayInstallEntry = {
  label: string
  onClick: () => void
  disabled?: boolean
}

export interface MenuOverlayInput {
  scene: Phaser.Scene
  layout: SceneLayout
  view: AppViewModel
  game: GameUiState
  theme: MenuOverlayTheme
  installEntry: MenuOverlayInstallEntry
  menuContentScrollOffset: number | null
  menuLogScrollOffset: number | null
  menuLogPinnedToBottom: boolean
  createButton: (
    label: string,
    x: number,
    y: number,
    onClick: () => void,
    width?: number,
    height?: number,
    fontSize?: string,
  ) => Phaser.GameObjects.Container
  popupActionWidth: (maxWidth: number, ratio: number, minWidth: number) => number
  buildLogTilesContent: (
    events: readonly LogEvent[],
    width: number,
    visualStyle: AppViewModel['cardVisualStyle'],
    options: { activeActor: number; legacyLog: readonly string[] },
  ) => { container: Phaser.GameObjects.Container; contentHeight: number; tileCount: number }
  onDestroy: (overlay: Phaser.GameObjects.Container) => void
  closeMenuOverlay: () => void
  setMenuContentScrollOffset: (offset: number | null) => void
  setMenuLogScrollState: (offset: number, pinnedToBottom: boolean) => void
  actions: {
    pauseAdventure: () => void
    abandonAdventure: () => void
    backToLobby: () => void
    rematch: () => void
    handleDownloadRecording: () => void
    saveRecordingToLocalStorage: () => void
    loadRecordingFromLocalStorage: () => void
    openRecordingFilePicker: () => void
    startReplay: () => void
    pauseReplay: () => void
    stepReplay: (delta: number) => void
    jumpReplayToEnd: () => void
    exitReplay: () => void
  }
}

function recordingMetadataText(view: AppViewModel): string {
  const meta = view.recording.metadata
  if (!meta) {
    return 'No recording loaded.'
  }
  return `Seed ${meta.seed} • ${meta.mode} • AI ${meta.aiLevel} • ${meta.controllers[0]}/${meta.controllers[1]} • Completed ${meta.completed ? 'Yes' : 'No'}`
}

export function createMenuOverlay(input: MenuOverlayInput): Phaser.GameObjects.Container {
  const {
    scene,
    layout,
    view,
    game,
    theme,
    installEntry,
    createButton,
    popupActionWidth,
    buildLogTilesContent,
    closeMenuOverlay,
    setMenuContentScrollOffset,
    setMenuLogScrollState,
    actions,
  } = input

  const overlay = scene.add.container(layout.width / 2, layout.height / 2)
  overlay.setDepth(DEPTH_MENU_OVERLAY)
  overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
    input.onDestroy(overlay)
  })

  const swallowPointerEvent = (
    _pointer: Phaser.Input.Pointer,
    _localX: number,
    _localY: number,
    event: Phaser.Types.Input.EventData,
  ): void => {
    event.stopPropagation()
  }

  const popupWidth = layout.menuPopupWidth
  const popupHeight = layout.menuPopupHeight
  const popupPadding = layout.menuPopupPadding
  const sectionGap = layout.menuSectionGap
  const panelLeft = (layout.width - popupWidth) / 2
  const panelRight = panelLeft + popupWidth
  const panelTop = (layout.height - popupHeight) / 2
  const panelBottom = panelTop + popupHeight
  const scrim = scene.add.rectangle(
    0,
    0,
    layout.width,
    layout.height,
    theme.scrimFill,
    layout.popupScrimAlpha,
  )
  scrim.setInteractive()
  scrim.on('pointerdown', swallowPointerEvent)
  scrim.on('pointerup', (
    pointer: Phaser.Input.Pointer,
    localX: number,
    localY: number,
    event: Phaser.Types.Input.EventData,
  ) => {
    swallowPointerEvent(pointer, localX, localY, event)
    const startedInsidePanel = pointer.downX >= panelLeft
      && pointer.downX <= panelRight
      && pointer.downY >= panelTop
      && pointer.downY <= panelBottom
    if (!startedInsidePanel) {
      closeMenuOverlay()
    }
  })
  scrim.on('pointermove', swallowPointerEvent)
  overlay.add(scrim)

  const panel = scene.add.rectangle(
    0,
    0,
    popupWidth,
    popupHeight,
    theme.panelFill,
    layout.popupPanelAlpha,
  ).setStrokeStyle(2, theme.panelStroke)
  panel.setInteractive()
  panel.on('pointerdown', swallowPointerEvent)
  panel.on('pointerup', swallowPointerEvent)
  panel.on('pointermove', swallowPointerEvent)
  overlay.add(panel)

  overlay.add(scene.add.text(0, -popupHeight / 2 + popupPadding + layout.menuTitleHeight / 2, 'Menu', {
    color: theme.primaryText,
    fontSize: layout.popupTitleFontSize,
  }).setOrigin(0.5))

  const fullButtonWidth = Math.max(1, popupWidth - popupPadding * 2)
  const halfButtonGap = layout.popupButtonGap
  const halfButtonWidth = Math.max(1, (fullButtonWidth - halfButtonGap) / 2)
  const contentViewportTop = -popupHeight / 2 + popupPadding + layout.menuTitleHeight + sectionGap
  const contentViewportBottom = popupHeight / 2 - popupPadding
  const contentViewportHeight = Math.max(1, contentViewportBottom - contentViewportTop)
  const contentViewportBackground = scene.add.rectangle(
    0,
    contentViewportTop + contentViewportHeight / 2,
    fullButtonWidth,
    contentViewportHeight,
    theme.backdropFill,
    0,
  )
  contentViewportBackground.setInteractive()
  overlay.add(contentViewportBackground)
  const contentViewport = scene.add.container(0, contentViewportTop)
  const content = scene.add.container(0, 0)
  contentViewport.add(content)
  overlay.add(contentViewport)

  const contentMask = scene.add.graphics()
  contentMask.fillStyle(0xffffff)
  contentMask.fillRect(
    -fullButtonWidth / 2,
    contentViewportTop,
    fullButtonWidth,
    contentViewportHeight,
  )
  contentMask.setVisible(false)
  overlay.add(contentMask)
  contentViewport.setMask(contentMask.createGeometryMask())
  let cursorY = 0

  const adventureMode = view.mode === 'adventure-hvai'
  // Section 1: Lobby/rematch or adventure controls.
  const section1Y = cursorY + layout.popupButtonHeight / 2
  content.add(createButton(adventureMode ? 'Pause Adventure' : 'Back to Lobby', -halfButtonWidth / 2 - halfButtonGap / 2, section1Y, () => {
    closeMenuOverlay()
    if (adventureMode) {
      actions.pauseAdventure()
      return
    }
    actions.backToLobby()
  }, halfButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
  content.add(createButton(adventureMode ? 'Reset Adventure' : 'Rematch', halfButtonWidth / 2 + halfButtonGap / 2, section1Y, () => {
    closeMenuOverlay()
    if (adventureMode) {
      actions.abandonAdventure()
      return
    }
    actions.rematch()
  }, halfButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
  cursorY += layout.popupButtonHeight + sectionGap

  // Section 2: Install.
  const installY = cursorY + layout.popupButtonHeight / 2
  const installButton = createButton(
    installEntry.label,
    0,
    installY,
    installEntry.disabled
      ? () => {}
      : () => {
          closeMenuOverlay()
          installEntry.onClick()
        },
    fullButtonWidth,
    layout.popupButtonHeight,
    layout.popupButtonFontSize,
  )
  if (installEntry.disabled) {
    installButton.setAlpha(0.4)
    installButton.disableInteractive()
  }
  content.add(installButton)
  cursorY += layout.popupButtonHeight + sectionGap

  // Section 4: Recorder.
  const recorderHeading = scene.add.text(-fullButtonWidth / 2, cursorY, `Recorder — ${recordingMetadataText(view)}`, {
    color: theme.secondaryText,
    fontSize: layout.smallFontSize,
    wordWrap: { width: fullButtonWidth },
  }).setOrigin(0, 0)
  content.add(recorderHeading)
  // Use the rendered text height (which reflects wrapping at narrow widths)
  // instead of a fixed 18px so the next row never overlaps a wrapped heading.
  cursorY += Math.max(18, recorderHeading.height) + 4

  const recorderRow1Y = cursorY + layout.popupButtonHeight / 2
  content.add(createButton('Download Save', -halfButtonWidth / 2 - halfButtonGap / 2, recorderRow1Y, () => {
    closeMenuOverlay()
    actions.handleDownloadRecording()
  }, halfButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
  content.add(createButton('Save to Browser', halfButtonWidth / 2 + halfButtonGap / 2, recorderRow1Y, () => {
    closeMenuOverlay()
    actions.saveRecordingToLocalStorage()
  }, halfButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
  cursorY += layout.popupButtonHeight + halfButtonGap

  const recorderRow2Y = cursorY + layout.popupButtonHeight / 2
  content.add(createButton('Load from Browser', -halfButtonWidth / 2 - halfButtonGap / 2, recorderRow2Y, () => {
    closeMenuOverlay()
    actions.loadRecordingFromLocalStorage()
  }, halfButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
  content.add(createButton('Load from File', halfButtonWidth / 2 + halfButtonGap / 2, recorderRow2Y, () => {
    closeMenuOverlay()
    actions.openRecordingFilePicker()
  }, halfButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
  cursorY += layout.popupButtonHeight + halfButtonGap

  if (!view.replay.active) {
    const startReplayY = cursorY + layout.popupButtonHeight / 2
    content.add(createButton('Start Replay', 0, startReplayY, () => {
      closeMenuOverlay()
      actions.startReplay()
    }, fullButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
    cursorY += layout.popupButtonHeight + sectionGap
  } else {
    cursorY += sectionGap
  }

  // Section 5: Replay controls (only when replay is active).
  if (view.replay.active) {
    const replayHeading = scene.add.text(-fullButtonWidth / 2, cursorY, `Replay Controls — Step ${view.replay.step}/${view.replay.totalSteps} • ${view.replay.isPlaying ? 'Playing' : 'Paused'}`, {
      color: theme.secondaryText,
      fontSize: layout.smallFontSize,
      wordWrap: { width: fullButtonWidth },
    }).setOrigin(0, 0)
    content.add(replayHeading)
    cursorY += Math.max(18, replayHeading.height) + 4

    const replayRow1Y = cursorY + layout.popupButtonHeight / 2
    const replayButtonWidth = Math.max(1, (fullButtonWidth - halfButtonGap * 2) / 3)
    content.add(createButton(view.replay.isPlaying ? 'Pause' : 'Play', -replayButtonWidth - halfButtonGap, replayRow1Y, () => {
      if (view.replay.isPlaying) {
        actions.pauseReplay()
      } else {
        actions.startReplay()
      }
    }, replayButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
    content.add(createButton('Previous', 0, replayRow1Y, () => {
      actions.stepReplay(-1)
    }, replayButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
    content.add(createButton('Next', replayButtonWidth + halfButtonGap, replayRow1Y, () => {
      actions.stepReplay(1)
    }, replayButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
    cursorY += layout.popupButtonHeight + halfButtonGap

    const replayRow2Y = cursorY + layout.popupButtonHeight / 2
    content.add(createButton('Jump to End', -halfButtonWidth / 2 - halfButtonGap / 2, replayRow2Y, () => {
      actions.jumpReplayToEnd()
    }, halfButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
    content.add(createButton('Exit Replay', halfButtonWidth / 2 + halfButtonGap / 2, replayRow2Y, () => {
      closeMenuOverlay()
      actions.exitReplay()
    }, halfButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
    cursorY += layout.popupButtonHeight + sectionGap
  }

  // Close button.
  const closeButtonY = cursorY + layout.popupButtonHeight / 2
  const closeButtonWidth = popupActionWidth(
    fullButtonWidth,
    POPUP_CLOSE_BUTTON_WIDTH_RATIO,
    POPUP_CLOSE_BUTTON_MIN_WIDTH,
  )
  content.add(createButton('Close', 0, closeButtonY, () => {
    closeMenuOverlay()
  }, closeButtonWidth, layout.popupButtonHeight, layout.popupButtonFontSize))
  const buttonStackBottomY = closeButtonY + layout.popupButtonHeight / 2

  // Replay Log section: heading + masked scrollable viewport.
  const logTitleY = buttonStackBottomY + sectionGap + 14
  const logViewportTopWithHeading = logTitleY + 14 + sectionGap
  const logViewportWidth = fullButtonWidth
  const contentViewportVisibleHeight = contentViewportHeight
  const maxViewportHeightWithHeading = Math.max(0, contentViewportVisibleHeight - logViewportTopWithHeading)
  // If the heading + viewport doesn't fit readably, drop the heading so the log section
  // still has somewhere to render. This preserves access to the replay log on short
  // viewports rather than removing it entirely.
  const showHeading = maxViewportHeightWithHeading >= MIN_READABLE_LOG_VIEWPORT_HEIGHT
  const logViewportTop = showHeading
    ? logViewportTopWithHeading
    : Math.max(buttonStackBottomY + sectionGap, contentViewportVisibleHeight - MIN_READABLE_LOG_VIEWPORT_HEIGHT)
  const maxViewportHeight = Math.max(0, contentViewportVisibleHeight - logViewportTop)
  let contentBottomY = buttonStackBottomY
  let deferredMenuLogScrollSetup: (() => void) | null = null
  let innerLogViewportBackground: Phaser.GameObjects.Rectangle | null = null
  let isInnerLogViewportScrollable = false
  if (maxViewportHeight > 0) {
    if (showHeading) {
      content.add(scene.add.text(-fullButtonWidth / 2, logTitleY, 'Replay Log', {
        color: theme.primaryText,
        fontSize: layout.bodyFontSize,
      }).setOrigin(0, 0.5))
    }

    const logViewportHeight = Math.min(layout.menuLogViewportHeight, maxViewportHeight)
    const logViewportY = logViewportTop + logViewportHeight / 2
    const logViewportBackground = scene.add.rectangle(
      0,
      logViewportY,
      logViewportWidth,
      logViewportHeight,
      theme.viewportFill,
      layout.popupViewportAlpha,
    ).setStrokeStyle(1, theme.buttonStroke)
    content.add(logViewportBackground)
    innerLogViewportBackground = logViewportBackground

    const logContent = scene.add.container(-logViewportWidth / 2 + LOG_VIEWPORT_HORIZONTAL_PADDING, logViewportTop + 8)
    content.add(logContent)
    const visualStyle = view.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    const tileColumnWidth = Math.max(40, logViewportWidth - LOG_VIEWPORT_HORIZONTAL_PADDING * 2)
    const { container: tilesColumn, contentHeight: logContentHeight } = buildLogTilesContent(
      game.events,
      tileColumnWidth,
      visualStyle,
      { activeActor: game.actor, legacyLog: game.log },
    )
    logContent.add(tilesColumn)

    const logMask = scene.add.graphics()
    logMask.fillStyle(0xffffff)
    logMask.fillRect(-logViewportWidth / 2, logViewportTop, logViewportWidth, logViewportHeight)
    logMask.setVisible(false)
    content.add(logMask)
    logContent.setMask(logMask.createGeometryMask())

    const logContentTopY = logViewportTop + 8
    const logViewportBottom = logViewportTop + logViewportHeight
    // Use the shared scroll helper so the menu log clamps + pin-to-bottom
    // semantics stay in lock-step with the in-scene log (and remain
    // covered by the helper's unit tests). bottomPadding=16 matches the
    // legacy `+ 16` term — 8px top inset above the tile column plus 8px
    // breathing room below the last tile.
    const initialScroll = computeLogScrollLayout({
      contentTopY: logContentTopY,
      viewportTopY: logViewportTop,
      viewportBottomY: logViewportBottom,
      contentHeight: logContentHeight,
      bottomPadding: 16,
      requestedOffset: input.menuLogScrollOffset,
      pinnedToBottom: input.menuLogPinnedToBottom,
    })
    const maxScroll = initialScroll.maxScroll
    let scrollOffset = initialScroll.scrollOffset
    setMenuLogScrollState(scrollOffset, initialScroll.pinnedToBottom)
    logContent.y = initialScroll.contentY
    cullRowsToViewport({
      rowsContainer: tilesColumn,
      columnOriginY: logContent.y,
      viewportTopY: logViewportTop,
      viewportBottomY: logViewportBottom,
      mode: 'contained',
    })
    const applyScroll = (deltaY: number): void => {
      if (maxScroll <= 0) {
        return
      }
      const next = computeLogScrollLayout({
        contentTopY: logContentTopY,
        viewportTopY: logViewportTop,
        viewportBottomY: logViewportBottom,
        contentHeight: logContentHeight,
        bottomPadding: 16,
        requestedOffset: scrollOffset + deltaY,
        pinnedToBottom: false,
      })
      scrollOffset = next.scrollOffset
      setMenuLogScrollState(scrollOffset, next.pinnedToBottom)
      logContent.y = next.contentY
      cullRowsToViewport({
        rowsContainer: tilesColumn,
        columnOriginY: logContent.y,
        viewportTopY: logViewportTop,
        viewportBottomY: logViewportBottom,
        mode: 'contained',
      })
    }

    if (maxScroll > 0) {
      isInnerLogViewportScrollable = true
      logViewportBackground.setInteractive()
      logViewportBackground.on('pointerdown', swallowPointerEvent)
      logViewportBackground.on('pointerup', swallowPointerEvent)
      logViewportBackground.on('pointermove', swallowPointerEvent)
      deferredMenuLogScrollSetup = () => {
        bindScrollableViewport(
          scene,
          logViewportBackground,
          applyScroll,
        )
        content.add(scene.add.text(logViewportWidth / 2 - SCROLL_INDICATOR_RIGHT_OFFSET, logViewportTop + logViewportHeight / 2, 'Scroll or drag', {
          color: theme.secondaryText,
          fontSize: layout.smallFontSize,
        }).setOrigin(1, 0.5))
      }
    }
    contentBottomY = Math.max(contentBottomY, logViewportTop + logViewportHeight)
  }

  const contentMaxScroll = Math.max(0, contentBottomY - contentViewportHeight)
  if (contentMaxScroll > 0) {
    let contentScrollOffset = Phaser.Math.Clamp(input.menuContentScrollOffset ?? 0, 0, contentMaxScroll)
    content.y = -contentScrollOffset
    const applyContentScroll = (deltaY: number): void => {
      contentScrollOffset = Phaser.Math.Clamp(contentScrollOffset + deltaY, 0, contentMaxScroll)
      setMenuContentScrollOffset(contentScrollOffset)
      content.y = -contentScrollOffset
    }
    const shouldHandleOuterContentScroll = (pointer: Phaser.Input.Pointer): boolean => {
      if (!innerLogViewportBackground || !isInnerLogViewportScrollable) {
        return true
      }
      const logBounds = innerLogViewportBackground.getBounds()
      return !Phaser.Geom.Rectangle.Contains(logBounds, pointer.worldX, pointer.worldY)
    }
    bindScrollableViewport(
      scene,
      contentViewportBackground,
      applyContentScroll,
      shouldHandleOuterContentScroll,
      shouldHandleOuterContentScroll,
    )
  } else {
    setMenuContentScrollOffset(null)
  }

  // Always bind the replay-log viewport as well so it remains scrollable
  // when the outer menu content also needs scrolling on shorter layouts.
  deferredMenuLogScrollSetup?.()

  return overlay
}
