// Modal target-picker popup: renders a scrollable list of target buttons
// (Swamp discard / Plains reuse / grouped play-land targeting) with Cancel
// and "Show all" footer actions. Extracted from target-selection.ts so the
// popup-rendering concern is separate from the pure battlefield-target
// state in battlefield-targets.ts.
//
// Overflow handling: Phaser 4's GeometryMask only clips under the Canvas
// renderer (it silently no-ops under WebGL — see
// docs/agent/phaser-renderer.md "Clipping: masks vs culling"). We keep the
// geometry mask for the Canvas backend and additionally cull every option
// button whose position falls outside the options viewport via the same
// `cullRowsToViewport` helper the Replay Log uses, so scrolled-out option
// buttons never paint over the title/footer on WebGL.
import Phaser from 'phaser'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import type { AppViewModel } from '../../app/types'
import type { GameAction } from '../../game/types'
import { createCardChoiceButton, createThemedButton } from './card-factory'
import { DEPTH_TARGET_PICKER_OVERLAY } from './depth'
import type { SceneLayout } from './layout'
import { cullRowsToViewport } from './log-row-visibility'
import { bindScrollableViewport } from './scrollable-viewport'
import { UI_THEME } from './theme'
import { DEFAULT_TARGET_OPTIONS, POPUP_CANCEL_BUTTON_MIN_WIDTH, POPUP_CANCEL_BUTTON_WIDTH_RATIO, POPUP_TOGGLE_BUTTON_MIN_WIDTH, POPUP_TOGGLE_BUTTON_WIDTH_RATIO, SCROLL_INDICATOR_RIGHT_OFFSET } from './scene-config'
import { popupActionWidth } from './ui-utils'

export type TargetPickerConfig = {
  title?: string
  allowCancel?: boolean
  onCancel?: () => void
}

export type A11yEntry = { key: string; label: string; onSelect: () => void }

export interface TargetPickerContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
  isMenuOpen: () => boolean
  getVisualStyle: () => AppViewModel['cardVisualStyle']
  clearCardPreview: () => void
  submitAction: (action: GameAction) => void
  refreshA11yNav: () => void
  onOpenChange?: (open: boolean) => void
}

export class TargetPickerController {
  private readonly ctx: TargetPickerContext
  private pendingTargetPicker: Phaser.GameObjects.Container | null = null
  private pendingTargetPickerA11yEntries: A11yEntry[] = []

  constructor(ctx: TargetPickerContext) {
    this.ctx = ctx
  }

  isTargetPickerOpen(): boolean {
    return this.pendingTargetPicker !== null
  }

  closeTargetPickerOverlay(): void {
    this.pendingTargetPickerA11yEntries = []
    this.pendingTargetPicker?.destroy(true)
  }

  // Called from CardgameScene.clearRoot(): the popup itself (a child of the
  // root container) has already been destroyed by `removeAll(true)`, so this
  // just drops the now-dangling reference/a11y entries.
  clearTransientPickerState(): void {
    const wasOpen = this.pendingTargetPicker !== null
    this.pendingTargetPicker = null
    this.pendingTargetPickerA11yEntries = []
    if (wasOpen) {
      this.ctx.onOpenChange?.(false)
    }
  }

  getTargetPickerA11yEntries(): A11yEntry[] {
    return this.pendingTargetPickerA11yEntries
  }

  showTargetPicker(
    options: Array<{ effectTargetId?: string; label: string; a11yLabel?: string; cardName?: string }>,
    resolver: (effectTargetId?: string) => GameAction | null,
    showAllTargets = false,
    config: TargetPickerConfig = {},
  ): void {
    const { scene, getLayout, getRootContainer } = this.ctx
    this.ctx.clearCardPreview()
    if (this.ctx.isMenuOpen()) {
      return
    }
    this.pendingTargetPicker?.destroy(true)

    const layout = getLayout()
    const optionCount = showAllTargets ? options.length : Math.min(DEFAULT_TARGET_OPTIONS, options.length)
    const hasHiddenOptions = options.length > DEFAULT_TARGET_OPTIONS
    const allowCancel = config.allowCancel ?? true
    const popupPadding = layout.menuPopupPadding
    const popupWidth = Math.max(0, layout.popupMaxWidth)
    const buttonWidth = Math.max(0, popupWidth - popupPadding * 2)
    const titleHeight = layout.menuTitleHeight
    const sectionGap = layout.menuSectionGap
    const optionGap = layout.popupButtonGap
    const cancelHeight = layout.popupButtonHeight
    const showAllButtonHeight = hasHiddenOptions ? cancelHeight : 0
    const footerGap = hasHiddenOptions && allowCancel ? layout.popupButtonGap : 0
    const footerHeight = (allowCancel ? cancelHeight : 0) + footerGap + showAllButtonHeight
    const optionsHeightWanted = optionCount > 0
      ? optionCount * layout.popupButtonHeight + Math.max(0, optionCount - 1) * optionGap
      : layout.popupButtonHeight
    const desiredHeight = titleHeight + optionsHeightWanted + footerHeight + popupPadding * 2 + sectionGap * 2
    const maxHeight = layout.height - layout.margin * 2
    const popupHeight = Math.min(desiredHeight, maxHeight)

    const overlay = scene.add.container(layout.width / 2, layout.height / 2)
    overlay.setDepth(DEPTH_TARGET_PICKER_OVERLAY)
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.pendingTargetPicker === overlay) {
        this.pendingTargetPicker = null
        this.ctx.onOpenChange?.(false)
      }
      this.pendingTargetPickerA11yEntries = []
      this.ctx.refreshA11yNav()
    })
    const swallowPointerEvent = (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ): void => {
      event.stopPropagation()
    }

    const backdrop = scene.add.rectangle(
      0,
      0,
      popupWidth,
      popupHeight,
      UI_THEME.backdropFill,
      layout.popupBackdropAlpha,
    ).setStrokeStyle(2, UI_THEME.panelStroke)
    backdrop.setInteractive()
    backdrop.on('pointerdown', swallowPointerEvent)
    backdrop.on('pointerup', swallowPointerEvent)
    backdrop.on('pointermove', swallowPointerEvent)
    overlay.add(backdrop)
    overlay.add(scene.add.text(0, -popupHeight / 2 + popupPadding + titleHeight / 2, config.title ?? 'Choose target', {
      color: UI_THEME.primaryText,
      fontSize: layout.popupTitleFontSize,
    }).setOrigin(0.5))

    const optionsTopY = -popupHeight / 2 + popupPadding + titleHeight
    const footerTopY = popupHeight / 2 - popupPadding - footerHeight
    const optionsAreaHeight = Math.max(48, footerTopY - optionsTopY - sectionGap)
    const optionsViewportY = optionsTopY + optionsAreaHeight / 2

    const optionsViewportBackground = scene.add.rectangle(
      0,
      optionsViewportY,
      buttonWidth,
      optionsAreaHeight,
      UI_THEME.panelFill,
      layout.popupViewportAlpha,
    ).setStrokeStyle(1, UI_THEME.buttonStroke)
    optionsViewportBackground.setInteractive()
    optionsViewportBackground.on('pointerdown', swallowPointerEvent)
    optionsViewportBackground.on('pointerup', swallowPointerEvent)
    optionsViewportBackground.on('pointermove', swallowPointerEvent)
    overlay.add(optionsViewportBackground)

    const optionsViewport = scene.add.container(0, optionsTopY)
    const optionsList = scene.add.container(0, 0)
    optionsViewport.add(optionsList)
    overlay.add(optionsViewport)

    // Geometry mask: clips under the Canvas renderer. See module doc comment
    // for why this alone is not sufficient under WebGL.
    const maskShape = scene.add.graphics()
    maskShape.fillStyle(0xffffff)
    maskShape.fillRect(-buttonWidth / 2, optionsTopY, buttonWidth, optionsAreaHeight)
    maskShape.setVisible(false)
    overlay.add(maskShape)
    optionsViewport.setMask(maskShape.createGeometryMask())

    const visualStyle = this.ctx.getVisualStyle() ?? DEFAULT_CARD_VISUAL_STYLE
    options.slice(0, optionCount).forEach((option, index) => {
      const selectOption = (): void => {
        const action = resolver(option.effectTargetId)
        if (action) {
          this.ctx.submitAction(action)
        }
        overlay.destroy(true)
      }
      const buttonY = layout.popupButtonHeight / 2 + index * (layout.popupButtonHeight + optionGap)
      const button = option.cardName
        ? createCardChoiceButton(
          scene,
          option.label,
          option.cardName,
          0,
          buttonY,
          selectOption,
          buttonWidth,
          layout.popupButtonHeight,
          layout.popupButtonFontSize,
          visualStyle,
        )
        : createThemedButton(
          scene,
          option.label,
          0,
          buttonY,
          layout.popupButtonFontSize,
          buttonWidth,
          layout.popupButtonHeight,
          selectOption,
        )
      // Tag row bounds so cullRowsToViewport (below) can explicitly hide
      // buttons that scroll outside the options viewport, independent of
      // the (WebGL no-op) geometry mask above.
      button.setData('rowTop', buttonY - layout.popupButtonHeight / 2)
      button.setData('rowHeight', layout.popupButtonHeight)
      optionsList.add(button)
      this.pendingTargetPickerA11yEntries.push({
        key: `target:${option.effectTargetId ?? `fallback-index-${index}`}`,
        label: option.a11yLabel ?? option.label,
        onSelect: selectOption,
      })
    })

    const optionsContentHeight = optionCount > 0
      ? optionCount * layout.popupButtonHeight + Math.max(0, optionCount - 1) * optionGap
      : 0
    const maxScroll = Math.max(0, optionsContentHeight - optionsAreaHeight)
    let scrollOffset = 0

    // Explicit WebGL-safe bounding: cull any option button whose tagged
    // rowTop/rowHeight falls (even partially) outside the options viewport.
    // `columnOriginY` expresses optionsList's current vertical offset in the
    // same (overlay-local) coordinate space as `optionsTopY`/`optionsAreaHeight`
    // — optionsList sits inside optionsViewport (already offset by
    // `optionsTopY`) and is itself scrolled by `-scrollOffset`.
    const cullOptionsToViewport = (): void => {
      cullRowsToViewport({
        rowsContainer: optionsList,
        columnOriginY: optionsTopY - scrollOffset,
        viewportTopY: optionsTopY,
        viewportBottomY: optionsTopY + optionsAreaHeight,
        mode: 'contained',
      })
    }
    cullOptionsToViewport()

    const applyScroll = (deltaY: number): void => {
      if (maxScroll <= 0) {
        return
      }
      scrollOffset = Phaser.Math.Clamp(scrollOffset + deltaY, 0, maxScroll)
      optionsList.y = -scrollOffset
      cullOptionsToViewport()
    }

    if (maxScroll > 0) {
      bindScrollableViewport(
        scene,
        optionsViewportBackground,
        applyScroll,
      )

      overlay.add(
        scene.add.text(
          buttonWidth / 2 - SCROLL_INDICATOR_RIGHT_OFFSET,
          optionsTopY + optionsAreaHeight / 2,
          'Scroll or drag',
          {
            color: UI_THEME.secondaryText,
            fontSize: layout.smallFontSize,
          },
        ).setOrigin(1, 0.5),
      )
    }

    const cancelY = footerTopY + cancelHeight / 2
    if (allowCancel) {
      const cancelWidth = popupActionWidth(
        buttonWidth,
        POPUP_CANCEL_BUTTON_WIDTH_RATIO,
        POPUP_CANCEL_BUTTON_MIN_WIDTH,
      )
      const cancelButton = createThemedButton(scene, 'Cancel', 0, cancelY, layout.popupButtonFontSize, cancelWidth, cancelHeight, () => {
        config.onCancel?.()
        overlay.destroy(true)
      })
      overlay.add(cancelButton)
    }

    if (hasHiddenOptions) {
      const showAllY = allowCancel
        ? cancelY + cancelHeight / 2 + layout.popupButtonGap + showAllButtonHeight / 2
        : footerTopY + showAllButtonHeight / 2
      const showAllLabel = showAllTargets ? `Show first ${DEFAULT_TARGET_OPTIONS}` : `Show all (${options.length})`
      const toggleShowAll = (): void => {
        overlay.destroy(true)
        this.showTargetPicker(options, resolver, !showAllTargets, config)
      }
      const toggleWidth = popupActionWidth(
        buttonWidth,
        POPUP_TOGGLE_BUTTON_WIDTH_RATIO,
        POPUP_TOGGLE_BUTTON_MIN_WIDTH,
      )
      const showAllButton = createThemedButton(
        scene,
        showAllLabel,
        0,
        showAllY,
        layout.popupButtonFontSize,
        toggleWidth,
        showAllButtonHeight,
        toggleShowAll,
      )
      overlay.add(showAllButton)
      this.pendingTargetPickerA11yEntries.push({
        key: 'target:toggle-visible-options',
        label: showAllLabel,
        onSelect: toggleShowAll,
      })
    }

    if (allowCancel) {
      this.pendingTargetPickerA11yEntries.push({
        key: 'target:cancel',
        label: 'Cancel Target Selection',
        onSelect: () => {
          config.onCancel?.()
          overlay.destroy(true)
        },
      })
    }

    this.pendingTargetPicker = overlay
    getRootContainer()?.add(overlay)
    this.ctx.onOpenChange?.(true)
    this.ctx.refreshA11yNav()
  }
}
