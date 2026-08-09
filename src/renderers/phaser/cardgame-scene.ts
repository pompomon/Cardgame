// Cardgame scene: Phaser scene lifecycle (preload/create/input wiring),
// layout tracking, status text, and the menu overlay, composed from the
// extracted gameplay/log/target-selection/effect subsystems. This is the
// thin orchestrator left after modularizing phaser/index.ts — see
// docs/agent/architecture.md for the module map.
import Phaser from 'phaser'
import {
  groupCardTargetOptions,
  resolvePlayLandTargetSelectionMode,
  resolveTargetedPlayLandAction,
} from '../../app/action-resolution'
import { DEFAULT_ANIMATION_SPEED } from '../../app/animation-settings'
import { DEFAULT_BOARD_THEME } from '../../app/board-theme'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import { DEFAULT_RENDER_QUALITY_PREFERENCE } from '../../app/render-quality'
import { BoardPresentationCoordinator } from '../../app/board-presentation'
import { visualEffectForEvent } from '../../app/visual-effects'
import type { AppViewModel, GameUiState } from '../../app/types'
import { buildPhaserBoardAssetManifest, resolveLoadedBoardBackgroundTextureKey } from './asset-manifest'
import { BoardBackgroundView } from './board-background'
import { buildCardPreviewContext, createCardPreviewController, type CardPreviewController } from './card-preview-controller'
import { preloadCardArt } from './card-art-loader'
import { createThemedButton, renderStaticCard } from './card-factory'
import type { CardViewDragSource } from './card-view'
import { CardViewRegistry } from './card-view-registry'
import { DragController } from './drag-controller'
import { DropZoneView } from './drop-zone-view'
import { EffectController } from './effect-controller'
import { GameplayPresenter } from './gameplay-presenter'
import { buildLayout, orientationFromViewport, type SceneLayout } from './layout'
import { createMenuOverlay } from './menu-overlay'
import { TargetPickerController } from './target-picker'
import { BattlefieldTargetsController } from './battlefield-targets'
import { preloadPhaserBoardAssets, type BoardAssetLoadHandle } from './texture-loader'
import { installButtonState, popupActionWidth } from './ui-utils'
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
  // Tracks the seed of the game currently rendered in this scene.
  private lastRenderedSeed: number | null = null
  private lastMenuSignature: string | null = null
  private currentLayout: SceneLayout = buildLayout(BASE_WIDTH, BASE_HEIGHT, 'horizontal')
  private lastLayoutSignature = ''
  private cardPreview: CardPreviewController | null = null
  private cardViews: CardViewRegistry | null = null
  private dragController: DragController | null = null
  private dropZoneView: DropZoneView | null = null
  private boardBackground: BoardBackgroundView | null = null
  private boardAssetLoadHandle: BoardAssetLoadHandle | null = null
  private boardAssetManifestSignature: string | null = null
  private readonly boardPresentation = new BoardPresentationCoordinator()

  private readonly effectController: EffectController
  private readonly battlefieldTargets: BattlefieldTargetsController
  private readonly targetPicker: TargetPickerController
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
    this.gameplayPresenter = new GameplayPresenter({
      scene: this,
      getLayout: () => this.currentLayout,
      getRootContainer: () => this.rootContainer,
      submitAction: (action) => this.rendererRef.controller?.submitAction(action),
      createButton: (label, x, y, onClick, width, height, fontSize) => this.createButton(label, x, y, onClick, width, height, fontSize),
      effectController: this.effectController,
      battlefieldTargets: this.battlefieldTargets,
      targetPicker: this.targetPicker,
      setStatus: (message) => this.setStatus(message),
      setBattlefieldDropZone: (zone) => this.setBattlefieldDropZone(zone),
      openMenuOverlay: (view) => this.openMenuOverlay(view),
      syncCardViews: (cards, view) => {
        if (!this.cardViews || !this.rootContainer) {
          return
        }
        this.cardViews.sync(cards, {
          root: this.rootContainer,
          layout: this.currentLayout,
          visualStyle: view.cardVisualStyle,
          animationSpeed: view.animationSpeed,
        })
      },
    })
  }

  preload(): void {
    const view = this.rendererRef.currentView
      ?? this.rendererRef.controller?.getViewModel()
    const selectedStyle = view?.cardVisualStyle
      ?? DEFAULT_CARD_VISUAL_STYLE
    preloadCardArt(this, selectedStyle)
    this.boardAssetLoadHandle?.dispose()
    this.boardAssetLoadHandle = preloadPhaserBoardAssets(
      this,
      view?.boardTheme ?? DEFAULT_BOARD_THEME,
      view?.renderQualityPreference ?? DEFAULT_RENDER_QUALITY_PREFERENCE,
    )
    this.boardAssetManifestSignature = `${view?.boardTheme ?? DEFAULT_BOARD_THEME}:${view?.renderQualityPreference ?? DEFAULT_RENDER_QUALITY_PREFERENCE}`
  }

  create(): void {
    this.rootContainer = this.add.container(0, 0)
    this.boardBackground = new BoardBackgroundView({
      scene: this,
      getDocumentHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    })
    this.dropZoneView = new DropZoneView(this)
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
    this.dragController?.destroy()
    this.dragController = null
    this.cardViews?.destroy()
    this.cardViews = new CardViewRegistry({
      scene: this,
      bindPreview: (card, label, dimensions) => {
        this.cardPreview?.bind(card, label, dimensions)
      },
    })
    this.dragController = new DragController({
      scene: this,
      getCardViews: () => this.cardViews,
      getGame: () => this.rendererRef.currentView?.game ?? null,
      getDropZone: () => this.battlefieldDropZone,
      getAnimationSpeed: () => this.rendererRef.currentView?.animationSpeed ?? DEFAULT_ANIMATION_SPEED,
      isInteractionBlocked: () => this.menuOpen
        || this.battlefieldTargets.getPendingPlayLandTargetSelection() !== null,
      createProxy: (source) => this.createDragProxy(source),
      submitAction: (action) => this.rendererRef.controller?.submitAction(action),
      beginTargetSelection: (game, cardId, options) => {
        this.beginPlayLandTargetSelection(game, cardId, options)
      },
      setStatus: (message) => this.setStatus(message),
      onPointerMove: (x, y) => this.dropZoneView?.updatePointer(x, y),
      onDragStateChange: (cardId, phase) => this.dropZoneView?.setDragState(
        this.rendererRef.currentView?.game ?? null,
        cardId,
        phase,
      ),
    })
    this.boardPresentation.reset()
    this.lastRenderedSeed = null
    this.updateLayout()
    this.statusText = this.add.text(this.currentLayout.margin, this.currentLayout.height - this.currentLayout.statusBottomOffset, '', {
      color: UI_THEME.secondaryText,
      fontSize: this.currentLayout.bodyFontSize,
    })

    // Detach the resize listener on scene shutdown so a stop/start cycle (e.g.
    // when the user goes Back to Lobby and then starts a new match) does not
    // accumulate duplicate listeners on the reused scene instance.
    const onResize = (): void => {
      this.dragController?.cancel('resize')
      if (this.updateLayout()) {
        this.renderView(this.rendererRef.currentView)
      }
    }
    this.scale.on('resize', onResize)
    const onVisibilityChange = (): void => {
      this.dragController?.cancel('visibility')
      this.renderView(this.rendererRef.currentView)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      this.dragController?.destroy()
      this.dragController = null
      this.cardPreview?.destroy()
      this.cardPreview = null
      this.cardViews?.destroy()
      this.cardViews = null
      this.dropZoneView?.destroy()
      this.dropZoneView = null
      this.boardBackground?.destroy()
      this.boardBackground = null
      this.boardAssetLoadHandle?.dispose()
      this.boardAssetLoadHandle = null
      this.boardAssetManifestSignature = null
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

  private createDragProxy(source: CardViewDragSource): Phaser.GameObjects.Container {
    const face = renderStaticCard(
      this,
      this.currentLayout,
      0,
      0,
      source.name,
      { dimensions: { width: source.width, height: source.height } },
      this.rendererRef.currentView?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE,
    )
    face.setPosition(0, 0)
    return this.add.container(source.container.x, source.container.y, [face])
  }

  private beginPlayLandTargetSelection(
    game: GameUiState,
    cardId: string,
    options: Array<{ effectTargetId?: string; label: string }>,
  ): void {
    const mode = resolvePlayLandTargetSelectionMode(game, cardId)
    if (mode === 'battlefield_highlight') {
      this.battlefieldTargets.beginPlayLandTargetSelection(cardId, options)
      this.renderView(this.rendererRef.currentView)
      this.setStatus('Choose a highlighted battlefield target.')
      return
    }
    const groupedOptions = groupCardTargetOptions(game, { kind: 'play_land', cardId }, options)
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

  private syncBoardBackground(view: AppViewModel): void {
    const manifestSignature = `${view.boardTheme}:${view.renderQualityPreference}`
    if (manifestSignature !== this.boardAssetManifestSignature) {
      this.boardAssetLoadHandle?.dispose()
      this.boardAssetManifestSignature = manifestSignature
      this.boardAssetLoadHandle = preloadPhaserBoardAssets(
        this,
        view.boardTheme,
        view.renderQualityPreference,
        () => {
          if (this.boardAssetManifestSignature === manifestSignature) {
            this.renderView(this.rendererRef.currentView)
          }
        },
      )
      this.load.start()
    }
    const manifest = buildPhaserBoardAssetManifest(view.boardTheme, view.renderQualityPreference)
    const backgroundTextureKey = resolveLoadedBoardBackgroundTextureKey(
      manifest,
      (key) => this.textures.exists(key),
    )
    this.boardBackground?.sync({
      layout: this.currentLayout,
      theme: view.boardTheme,
      quality: view.renderQualityPreference,
      animationSpeed: view.animationSpeed,
      backgroundTextureKey,
      backgroundCandidateKeys: manifest.backgroundCandidates.map((candidate) => candidate.key),
    })
  }

  private clearRoot(preservedOverlay: Phaser.GameObjects.Container | null): void {
    const wasMenuOpen = this.menuOpen
    this.menuOverlay = null
    this.cardPreview?.clear()
    const cardLayer = this.cardViews?.layer ?? null
    if (this.rootContainer) {
      for (const child of this.rootContainer.getAll()) {
        if (child !== cardLayer && child !== preservedOverlay) {
          this.rootContainer.remove(child, true)
        }
      }
    }
    this.battlefieldTargets.clearTransientEntries()
    this.targetPicker.clearTransientPickerState()
    this.battlefieldDropZone = null
    this.menuOpen = wasMenuOpen
  }

  renderView(view: AppViewModel | null): void {
    this.updateLayout()
    const game = view?.game ?? null
    if (view && game) {
      const currentSeed = view.seed
      if (this.lastRenderedSeed !== null && this.lastRenderedSeed !== currentSeed) {
        this.dragController?.cancel('game-change')
        this.menuLogScrollOffset = null
        this.menuLogPinnedToBottom = true
        // Reset ability-effect bookkeeping so a fresh game doesn't replay
        // animations queued from a previous match.
        this.effectController.reset()
        this.cardViews?.reset()
        this.boardPresentation.reset(game.actor)
      }
      this.lastRenderedSeed = currentSeed
    } else {
      this.dragController?.cancel('game-change')
      this.lastRenderedSeed = null
      this.effectController.reset()
      this.cardViews?.reset()
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
    }
    this.clearRoot(preservedOverlay)
    if (!view || !this.rootContainer) {
      this.battlefieldTargets.reset()
      this.cardViews?.reset()
      preservedOverlay?.destroy(true)
      this.lastMenuSignature = null
      return
    }

    this.setStatus(view.status)
    this.syncBoardBackground(view)

    if (!view.game) {
      this.battlefieldTargets.reset()
      this.cardViews?.reset()
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
    const cards = this.gameplayPresenter.renderGame(view, presentedActor)
    const latestEvent = view.game.events.length > 0
      ? view.game.events[view.game.events.length - 1]
      : null
    this.dropZoneView?.sync({
      game: view.game,
      layout: this.currentLayout,
      cards,
      dragCardId: this.dragController?.activeCardId ?? null,
      dragPhase: this.dragController?.phase ?? 'idle',
      effect: latestEvent ? visualEffectForEvent(latestEvent, view.cardVisualStyle) : null,
    })
    this.dragController?.reconcile()
    this.effectController.processAbilityEffects(view, presentedActor)
    if (preservedOverlay) {
      this.menuOverlay = preservedOverlay
      this.rootContainer.bringToTop(preservedOverlay)
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

  private openMenuOverlay(view: AppViewModel): void {
    if (!this.rootContainer || this.menuOverlay) {
      return
    }
    const game = view.game
    if (!game) {
      return
    }

    this.cardPreview?.clear()
    this.dragController?.cancel('menu')
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
