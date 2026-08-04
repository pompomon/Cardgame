// Cardgame scene: Phaser scene lifecycle (preload/create/input wiring),
// layout tracking, status text, and the menu overlay, composed from the
// extracted gameplay/log/target-selection/effect subsystems. This is the
// thin orchestrator left after modularizing phaser/index.ts — see
// docs/agent/architecture.md for the module map.
import Phaser from 'phaser'
import {
  groupCardTargetOptions,
  resolvePlayLandDrop,
  resolvePlayLandTargetSelectionMode,
  resolveTargetedPlayLandAction,
} from '../../app/action-resolution'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import { BoardPresentationCoordinator } from '../../app/board-presentation'
import type { AppViewModel } from '../../app/types'
import type { LogEvent } from '../../game/types'
import { buildCardPreviewContext, createCardPreviewController, type CardPreviewController } from './card-preview-controller'
import { preloadCardArt } from './card-art-loader'
import { createThemedButton, renderStaticCard } from './card-factory'
import { EffectController } from './effect-controller'
import { GameplayPresenter } from './gameplay-presenter'
import { InSceneLogRenderer } from './in-scene-log'
import { buildLayout, orientationFromViewport, type SceneLayout } from './layout'
import { createMenuOverlay } from './menu-overlay'
import { TargetPickerController } from './target-picker'
import { BattlefieldTargetsController } from './battlefield-targets'
import { installButtonState, popupActionWidth, snapCardToOrigin } from './ui-utils'
import { UI_THEME } from './theme'
import { BASE_HEIGHT, BASE_WIDTH, CARDGAME_SCENE_KEY } from './scene-config'
import type { PhaserRendererHost } from './renderer-host'

export class CardgameScene extends Phaser.Scene {
  private readonly rendererRef: PhaserRendererHost
  private rootContainer: Phaser.GameObjects.Container | null = null
  private statusText: Phaser.GameObjects.Text | null = null
  private battlefieldDropZone: Phaser.GameObjects.Zone | null = null
  private menuOverlay: Phaser.GameObjects.Container | null = null
  private menuOpen = false
  private menuContentScrollOffset: number | null = null
  private menuLogScrollOffset: number | null = null
  private menuLogPinnedToBottom = true
  // Tracks the seed of the game currently rendered in this scene. When
  // the seed changes (e.g. via rematch) we reset the log scroll state so
  // the next game opens with the in-scene log pinned to the newest entry
  // instead of preserving the stale offset from the previous match.
  private lastRenderedSeed: number | null = null
  private lastMenuSignature: string | null = null
  private currentLayout: SceneLayout = buildLayout(BASE_WIDTH, BASE_HEIGHT, 'horizontal')
  private lastLayoutSignature = ''
  private cardPreview: CardPreviewController | null = null
  private readonly boardPresentation = new BoardPresentationCoordinator()

  private readonly effectController: EffectController
  private readonly battlefieldTargets: BattlefieldTargetsController
  private readonly targetPicker: TargetPickerController
  private readonly inSceneLog: InSceneLogRenderer
  private readonly gameplayPresenter: GameplayPresenter

  constructor(rendererRef: PhaserRendererHost) {
    super(CARDGAME_SCENE_KEY)
    this.rendererRef = rendererRef

    this.effectController = new EffectController({
      scene: this,
      getLayout: () => this.currentLayout,
      getCurrentView: () => this.rendererRef.currentView,
      onQueueDrained: () => {
        if (this.boardPresentation.effectsDrained()) {
          this.renderView(this.rendererRef.currentView)
          this.rendererRef.refreshA11yNavForCurrentView()
        }
      },
    })
    this.battlefieldTargets = new BattlefieldTargetsController({
      isMenuOpen: () => this.menuOpen,
      submitAction: (action) => this.rendererRef.controller?.submitAction(action),
    })
    this.targetPicker = new TargetPickerController({
      scene: this,
      getLayout: () => this.currentLayout,
      getRootContainer: () => this.rootContainer,
      isMenuOpen: () => this.menuOpen,
      getVisualStyle: () => this.rendererRef.currentView?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE,
      clearCardPreview: () => this.cardPreview?.clear(),
      submitAction: (action) => this.rendererRef.controller?.submitAction(action),
      refreshA11yNav: () => this.rendererRef.refreshA11yNavForCurrentView(),
    })
    this.inSceneLog = new InSceneLogRenderer({
      scene: this,
      getLayout: () => this.currentLayout,
      getRootContainer: () => this.rootContainer,
      getVisualStyle: () => this.rendererRef.currentView?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE,
    })
    this.gameplayPresenter = new GameplayPresenter({
      scene: this,
      getLayout: () => this.currentLayout,
      getRootContainer: () => this.rootContainer,
      getVisualStyle: () => this.rendererRef.currentView?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE,
      submitAction: (action) => this.rendererRef.controller?.submitAction(action),
      createButton: (label, x, y, onClick, width, height, fontSize) => this.createButton(label, x, y, onClick, width, height, fontSize),
      getCardPreview: () => this.cardPreview,
      effectController: this.effectController,
      battlefieldTargets: this.battlefieldTargets,
      targetPicker: this.targetPicker,
      inSceneLog: this.inSceneLog,
      isMenuOpen: () => this.menuOpen,
      setStatus: (message) => this.setStatus(message),
      setBattlefieldDropZone: (zone) => this.setBattlefieldDropZone(zone),
      openMenuOverlay: (view) => this.openMenuOverlay(view),
    })
  }

  preload(): void {
    const selectedStyle = this.rendererRef.currentView?.cardVisualStyle
      ?? this.rendererRef.controller?.getViewModel().cardVisualStyle
      ?? DEFAULT_CARD_VISUAL_STYLE
    preloadCardArt(this, selectedStyle)
  }

  create(): void {
    this.rootContainer = this.add.container(0, 0)
    this.cardPreview = createCardPreviewController({
      scene: this,
      getRoot: () => this.rootContainer,
      getLayout: () => this.currentLayout,
      getContext: () => buildCardPreviewContext(
        this.rendererRef.currentView?.game?.phase ?? null,
        this.battlefieldTargets.getPendingPlayLandTargetSelection() !== null,
        this.menuOpen,
      ),
      renderCard: (label) => renderStaticCard(this, this.currentLayout, 0, 0, label, { mode: 'preview' }, this.rendererRef.currentView?.cardVisualStyle),
    })
    this.inSceneLog.reset()
    this.boardPresentation.reset()
    this.lastRenderedSeed = null
    this.updateLayout()
    this.statusText = this.add.text(this.currentLayout.margin, this.currentLayout.height - this.currentLayout.statusBottomOffset, '', {
      color: UI_THEME.secondaryText,
      fontSize: this.currentLayout.bodyFontSize,
    })

    const onDrag = (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, dragX: number, dragY: number): void => {
      if (this.menuOpen) {
        return
      }
      const draggable = object as Phaser.GameObjects.Container
      draggable.x = dragX
      draggable.y = dragY
    }
    this.input.on('drag', onDrag)

    const onDragEnd = (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, dropped: boolean): void => {
      const card = object as Phaser.GameObjects.Container
      if (this.menuOpen) {
        snapCardToOrigin(card)
        return
      }
      if (!dropped) {
        snapCardToOrigin(card)
      }
    }
    this.input.on('dragend', onDragEnd)

    const onDrop = (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, zone: Phaser.GameObjects.Zone): void => {
      if (this.menuOpen) {
        return
      }
      const game = this.rendererRef.currentView?.game
      if (!game || zone !== this.battlefieldDropZone) {
        return
      }

      const card = object as Phaser.GameObjects.Container
      const cardId = card.getData('cardId')
      if (typeof cardId !== 'string') {
        return
      }

      const resolution = resolvePlayLandDrop(game, cardId)
      if (resolution.kind === 'invalid') {
        this.setStatus('Invalid drop. Choose a playable card.')
        snapCardToOrigin(card)
        return
      }

      if (resolution.kind === 'single') {
        this.battlefieldTargets.clearPendingPlayLandTargetSelection()
        this.rendererRef.controller?.submitAction(resolution.action)
        return
      }

      snapCardToOrigin(card)
      const mode = resolvePlayLandTargetSelectionMode(game, cardId)
      if (mode === 'battlefield_highlight') {
        this.battlefieldTargets.beginPlayLandTargetSelection(cardId, resolution.options)
        this.renderView(this.rendererRef.currentView)
        this.setStatus('Choose a highlighted battlefield target.')
        return
      }
      const groupedOptions = groupCardTargetOptions(game, { kind: 'play_land', cardId }, resolution.options)
      this.battlefieldTargets.clearPendingPlayLandTargetSelection()
      this.targetPicker.showTargetPicker(
        groupedOptions.map((option) => ({
          effectTargetId: option.effectTargetId,
          label: option.label,
          cardName: option.cardName,
        })),
        (targetId) => resolveTargetedPlayLandAction(game, cardId, targetId),
      )
    }
    this.input.on('drop', onDrop)

    // Detach the resize listener on scene shutdown so a stop/start cycle (e.g.
    // when the user goes Back to Lobby and then starts a new match) does not
    // accumulate duplicate listeners on the reused scene instance.
    const onResize = (): void => {
      if (this.updateLayout()) {
        this.renderView(this.rendererRef.currentView)
      }
    }
    this.scale.on('resize', onResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize)
      this.input.off('drag', onDrag)
      this.input.off('dragend', onDragEnd)
      this.input.off('drop', onDrop)
      this.cardPreview?.destroy()
      this.cardPreview = null
      this.effectController.reset()
      this.boardPresentation.reset()
    })

    this.renderView(this.rendererRef.currentView)
  }

  private setBattlefieldDropZone(zone: Phaser.GameObjects.Zone | null): void {
    zone?.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.battlefieldDropZone === zone) {
        this.battlefieldDropZone = null
      }
    })
    this.battlefieldDropZone = zone
  }

  private updateLayout(): boolean {
    const width = this.scale.gameSize.width ?? this.scale.width ?? BASE_WIDTH
    const height = this.scale.gameSize.height ?? this.scale.height ?? BASE_HEIGHT
    const orientation = orientationFromViewport(width, height)
    const insets = this.rendererRef.safeAreaInsetsForViewport(width, height)
    this.currentLayout = buildLayout(width, height, orientation, insets)
    const signature = `${width}x${height}:${orientation}:${this.currentLayout.isCompact ? 'compact' : 'full'}:${this.currentLayout.isCollapsed ? 'collapsed' : 'split'}`
    const changed = signature !== this.lastLayoutSignature
    this.lastLayoutSignature = signature
    return changed
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.setText(message)
      this.statusText.setPosition(this.currentLayout.safeAreaLeft + this.currentLayout.margin, this.currentLayout.height - this.currentLayout.statusBottomOffset)
      this.statusText.setFontSize(this.currentLayout.bodyFontSize)
    }
  }

  private clearRoot(): void {
    const wasMenuOpen = this.menuOpen
    this.menuOverlay = null
    this.cardPreview?.clear()
    this.rootContainer?.removeAll(true)
    this.battlefieldTargets.clearTransientEntries()
    this.targetPicker.clearTransientPickerState()
    this.battlefieldDropZone = null
    this.menuOpen = wasMenuOpen
  }

  renderView(view: AppViewModel | null): void {
    this.updateLayout()
    const game = view?.game ?? null
    // Reset the in-scene log scroll state when the seed changes, e.g. on
    // a rematch. Without this, the reused CardgameScene would inherit the
    // previous match's scroll offset and open the new game scrolled away
    // from the newest log entries.
    if (view && game) {
      const currentSeed = view.seed
      if (this.lastRenderedSeed !== null && this.lastRenderedSeed !== currentSeed) {
        this.inSceneLog.reset()
        // Reset ability-effect bookkeeping so a fresh game doesn't replay
        // animations queued from a previous match.
        this.effectController.reset()
        this.boardPresentation.reset(game.actor)
      }
      this.lastRenderedSeed = currentSeed
    } else {
      this.lastRenderedSeed = null
      this.effectController.reset()
      this.boardPresentation.reset()
    }
    const currentMenuSignature = this.menuOpen && view && game
      ? this.computeMenuSignature(view)
      : null
    let preservedOverlay: Phaser.GameObjects.Container | null = null
    if (
      currentMenuSignature !== null
      && currentMenuSignature === this.lastMenuSignature
      && this.menuOverlay
    ) {
      preservedOverlay = this.menuOverlay
      this.rootContainer?.remove(preservedOverlay, false)
    }
    this.clearRoot()
    if (!view || !this.rootContainer) {
      this.battlefieldTargets.reset()
      preservedOverlay?.destroy(true)
      this.lastMenuSignature = null
      return
    }

    this.setStatus(view.status)

    if (!view.game) {
      this.battlefieldTargets.reset()
      preservedOverlay?.destroy(true)
      this.closeMenuOverlay()
      this.lastMenuSignature = null
      return
    }

    this.battlefieldTargets.syncPendingPlayLandTargetSelection(view.game)
    this.battlefieldTargets.updateBattlefieldTargetEntries(view.game)
    const effectsBusy = this.effectController.isBusyOrWillEnqueue(view)
    const presentedActor = this.boardPresentation.resolve(
      view.game.actor,
      effectsBusy,
      view.animationSpeed !== 'off',
    )
    this.gameplayPresenter.renderGame(view, presentedActor)
    this.effectController.processAbilityEffects(view, presentedActor)
    if (preservedOverlay) {
      this.menuOverlay = preservedOverlay
      this.rootContainer.add(preservedOverlay)
    } else if (this.menuOpen) {
      this.openMenuOverlay(view)
    }

    this.lastMenuSignature = this.menuOpen && this.menuOverlay
      ? this.computeMenuSignature(view)
      : null
  }

  presentedActor(fallback: number): number {
    return this.boardPresentation.currentActor(fallback)
  }

  private computeMenuSignature(view: AppViewModel): string {
    const lines = view.game?.log ?? []
    const last = lines.length > 0 ? lines[lines.length - 1] : ''
    const recordingMeta = view.recording.metadata
      ? `${view.recording.metadata.seed}:${view.recording.metadata.mode}:${view.recording.metadata.aiLevel}:${view.recording.metadata.completed ? 1 : 0}`
      : 'none'
    return `${this.lastLayoutSignature}|seed:${view.seed}|${lines.length}|${last}|recording:${recordingMeta}|replay:${view.replay.active}:${view.replay.step}/${view.replay.totalSteps}:${view.replay.isPlaying}|saved:${view.recording.hasLocalSave ? 1 : 0}`
  }

  private createButton(
    label: string,
    x: number,
    y: number,
    onClick: () => void,
    width = 240,
    height = 44,
    fontSize = this.currentLayout.actionButtonFontSize,
  ): Phaser.GameObjects.Container {
    return createThemedButton(this, label, x, y, fontSize, width, height, onClick)
  }

  closeMenuOverlay(): void {
    const overlay = this.menuOverlay
    this.menuOverlay = null
    this.menuOpen = false
    this.battlefieldTargets.reset()
    this.menuContentScrollOffset = null
    this.menuLogScrollOffset = null
    this.menuLogPinnedToBottom = true
    this.lastMenuSignature = null
    overlay?.destroy(true)
    this.rendererRef.refreshA11yNavForCurrentView()
  }

  isMenuOverlayOpen(): boolean {
    return this.menuOpen
  }

  isTargetPickerOpen(): boolean {
    return this.targetPicker.isTargetPickerOpen()
  }

  closeTargetPickerOverlay(): void {
    this.targetPicker.closeTargetPickerOverlay()
  }

  getTargetPickerA11yEntries(): Array<{ key: string; label: string; onSelect: () => void }> {
    return this.targetPicker.getTargetPickerA11yEntries()
  }

  getBattlefieldTargetA11yEntries(): Array<{ key: string; label: string; onSelect: () => void }> {
    return this.battlefieldTargets.getBattlefieldTargetA11yEntries()
  }

  private buildLogTilesContent(
    events: readonly LogEvent[],
    contentWidth: number,
    visualStyle: AppViewModel['cardVisualStyle'],
    options: { activeActor: number; legacyLog?: readonly string[] },
  ): { container: Phaser.GameObjects.Container; contentHeight: number; tileCount: number } {
    return this.inSceneLog.buildLogTilesContent(events, contentWidth, visualStyle, options)
  }

  private openMenuOverlay(view: AppViewModel): void {
    if (!this.rootContainer || this.menuOverlay) {
      return
    }
    const game = view.game
    if (!game) {
      return
    }

    this.cardPreview?.clear()
    this.targetPicker.closeTargetPickerOverlay()
    this.battlefieldTargets.reset()
    this.menuOpen = true
    this.statusText?.setVisible(false)

    const overlay = createMenuOverlay({
      scene: this,
      layout: this.currentLayout,
      view,
      game,
      theme: UI_THEME,
      installEntry: installButtonState(),
      menuContentScrollOffset: this.menuContentScrollOffset,
      menuLogScrollOffset: this.menuLogScrollOffset,
      menuLogPinnedToBottom: this.menuLogPinnedToBottom,
      createButton: (label, x, y, onClick, width, height, fontSize) => this.createButton(label, x, y, onClick, width, height, fontSize),
      popupActionWidth: (maxWidth, ratio, minWidth) => popupActionWidth(maxWidth, ratio, minWidth),
      buildLogTilesContent: (events, width, visualStyle, options) => this.buildLogTilesContent(events, width, visualStyle, options),
      onDestroy: (destroyedOverlay) => {
        this.statusText?.setVisible(true)
        if (this.menuOverlay === destroyedOverlay) {
          this.menuOverlay = null
          this.menuOpen = false
          this.lastMenuSignature = null
        }
        this.rendererRef.refreshA11yNavForCurrentView()
      },
      closeMenuOverlay: () => { this.closeMenuOverlay() },
      setMenuContentScrollOffset: (offset) => {
        this.menuContentScrollOffset = offset
      },
      setMenuLogScrollState: (offset, pinnedToBottom) => {
        this.menuLogScrollOffset = offset
        this.menuLogPinnedToBottom = pinnedToBottom
      },
      actions: {
        pauseAdventure: () => { this.rendererRef.controller?.pauseAdventure() },
        abandonAdventure: () => { this.rendererRef.controller?.abandonAdventure() },
        backToLobby: () => { this.rendererRef.controller?.backToLobby() },
        rematch: () => { this.rendererRef.controller?.rematch() },
        handleDownloadRecording: () => { this.rendererRef.handleDownloadRecording() },
        saveRecordingToLocalStorage: () => { this.rendererRef.controller?.saveRecordingToLocalStorage() },
        loadRecordingFromLocalStorage: () => { this.rendererRef.controller?.loadRecordingFromLocalStorage() },
        openRecordingFilePicker: () => { this.rendererRef.openRecordingFilePicker() },
        startReplay: () => { this.rendererRef.controller?.startReplay() },
        pauseReplay: () => { this.rendererRef.controller?.pauseReplay() },
        stepReplay: (delta) => { this.rendererRef.controller?.stepReplay(delta) },
        jumpReplayToEnd: () => { this.rendererRef.controller?.jumpReplayToEnd() },
        exitReplay: () => { this.rendererRef.controller?.exitReplay() },
      },
    })

    this.menuOverlay = overlay
    this.rootContainer.add(overlay)
    this.lastMenuSignature = this.computeMenuSignature(view)
    this.rendererRef.refreshA11yNavForCurrentView()
  }
}
