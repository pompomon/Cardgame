import Phaser from 'phaser'
import {
  groupCardTargetOptions,
  resolvePlayLandDrop,
  resolvePlayLandTargetSelectionMode,
  resolvePlainsReuseTargetSelectionMode,
  resolveTargetedPlayLandAction,
} from '../../app/action-resolution'
import { AI_LEVEL_OPTIONS } from '../../app/ai-levels'
import { ALL_CARD_ART, cardArtKey } from '../../app/card-art'
import { ANIMATION_SPEED_OPTIONS, durationMsForSpeed } from '../../app/animation-settings'
import { CARD_VISUAL_STYLE_OPTIONS, DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import { bucketIconSize, cardVisualPaletteFor, landPixelRects } from '../../app/card-visuals'
import type { ControllerApi } from '../../app/controller'
import { getInstallUiState, promptInstall } from '../../app/install-support'
import type { AppViewModel, GameUiState, Mode } from '../../app/types'
import { isBasicLand, type BasicLand, type GameAction, type LogEvent } from '../../game/types'
import type { AppRenderer } from '../types'
import { shouldRenderInSceneReplayLog } from './in-scene-log-policy'
import { buildLayout, clamp, orientationFromViewport, type SceneLayout } from './layout'
import { formatLogEventText, formatLogEventTile } from './log-events'
import { computeLogScrollLayout } from './log-scroll'
import {
  clearEffectQueue,
  createEffectQueue,
  effectDescriptorForEvent,
  enqueueEffect,
  playAbilityEffect,
  pumpEffectQueue,
  type EffectAnchor,
  type EffectDescriptor,
  type EffectQueueState,
} from './effects'

const BASE_WIDTH = 1280
const BASE_HEIGHT = 820
const DEFAULT_TARGET_OPTIONS = 5
const BUTTON_TEXT_HORIZONTAL_PADDING = 24
const BUTTON_TEXT_HEIGHT_RATIO = 0.42
const BUTTON_TEXT_NARROW_WIDTH_THRESHOLD = 180
const BUTTON_TEXT_NARROW_WIDTH_SCALE = 0.92
const BUTTON_TEXT_MAX_LINES = 2
// Keep renderer-side clamping aligned with layout button typography limits.
const MIN_BUTTON_FONT_PX = 12
const MAX_BUTTON_FONT_PX = 20
const SCROLL_WHEEL_MULTIPLIER = 0.8
const SCROLL_INDICATOR_RIGHT_OFFSET = 10
const LOG_VIEWPORT_HORIZONTAL_PADDING = 10
const MIN_READABLE_LOG_VIEWPORT_HEIGHT = 36
// Cap how many log tiles we materialize per render. Long replays / imported
// recordings (or malicious JSON) can carry thousands of entries, and creating
// multiple Phaser GameObjects per entry on every render quickly becomes a
// freeze. When exceeded, we render only the most recent
// MAX_RENDERED_LOG_TILES entries with a leading "older entries omitted" row
// so the rest of the panel still functions.
const MAX_RENDERED_LOG_TILES = 200
const BLOB_URL_REVOCATION_DELAY_MS = 1000
const LOBBY_SCENE_KEY = 'cardgame-lobby'
const CARDGAME_SCENE_KEY = 'cardgame-main'
const INFO_PANEL_VERTICAL_PADDING = 12
const INFO_PANEL_LINE_HEIGHT_MULTIPLIER = 1.25
const MIN_LOBBY_ROW_HEIGHT = 16
const DEFAULT_BATTLEFIELD_HEADER_BAND = 22
const POPUP_CLOSE_BUTTON_WIDTH_RATIO = 0.5
const POPUP_CLOSE_BUTTON_MIN_WIDTH = 160
const POPUP_CANCEL_BUTTON_WIDTH_RATIO = 0.62
const POPUP_CANCEL_BUTTON_MIN_WIDTH = 180
const POPUP_TOGGLE_BUTTON_WIDTH_RATIO = 0.72
const POPUP_TOGGLE_BUTTON_MIN_WIDTH = 200
const CARD_CHOICE_ICON_MIN_SIZE = 16
const CARD_CHOICE_ICON_WIDTH_RATIO = 0.2
const CARD_CHOICE_ICON_HEIGHT_RATIO = 0.8
const CARD_FACE_ICON_MIN_SIZE = 22

// Color palette mirrors DOM PR #13 (.battlefield-active / .battlefield-non-active /
// .player-active / .player-non-active / .log) so both renderers feel consistent.
const COLOR_BATTLEFIELD_ACTIVE_FILL = 0x1c3a2c
const COLOR_BATTLEFIELD_ACTIVE_STROKE = 0x2f6a4a
const COLOR_BATTLEFIELD_NON_ACTIVE_FILL = 0x3a1c1c
const COLOR_BATTLEFIELD_NON_ACTIVE_STROKE = 0x6a2f2f
const COLOR_PLAYER_ACTIVE_FILL = 0x14304a
const COLOR_PLAYER_NON_ACTIVE_FILL = 0x2a1233
const COLOR_PANEL_STROKE = 0x2a355f
const COLOR_LOG_PANEL_FILL = 0x0d162e
const COLOR_LOG_VIEWPORT_FILL = 0x091227
// Scene depth layering for the in-scene game view. The replay log must
// always paint below the header strip (so even if a regression breaks the
// log's clipping mask, the ☰ Menu button / Turn label / Winner banner stay
// readable on top). Player-info / battlefield rows sit between the two so
// any minor overshoot from the log is hidden by the next container instead
// of stacking visibly on top of it.
const Z_LOG = 0
const Z_BOARD = 5
const Z_HEADER = 10

const UI_THEME = {
  buttonFill: 0x1c2f63,
  buttonStroke: 0x365092,
  panelFill: 0x0f1a3b,
  panelStroke: 0x365092,
  viewportFill: COLOR_LOG_VIEWPORT_FILL,
  backdropFill: 0x000000,
  scrimFill: 0x000000,
  primaryText: '#e5ecf5',
  secondaryText: '#9db0d9',
}

interface CardStyle {
  fill: number
  stroke: number
  text: string
}

type TargetPickerConfig = {
  title?: string
  allowCancel?: boolean
  onCancel?: () => void
}

type BattlefieldTargetOwner = 'active' | 'non-active'

type BattlefieldTargetEntry = {
  owner: BattlefieldTargetOwner
  effectTargetId: string
  cardName: string
  onSelect: () => void
}

type LobbySubmenu = 'root' | 'settings' | 'recording'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function colorHexToNumber(hex: string): number {
  const parsed = Number.parseInt(hex.replace('#', ''), 16)
  return Number.isFinite(parsed) ? parsed : 0xffffff
}

let cardArtLoadErrorReported = false

function preloadCardArt(scene: Phaser.Scene): void {
  for (const entry of ALL_CARD_ART) {
    if (scene.textures.exists(entry.key)) {
      continue
    }
    scene.load.image(entry.key, entry.url)
  }
  // Phaser scenes can be stopped/started repeatedly (e.g. lobby ↔ game).
  // `scene.load.once` only detaches when the event actually fires, so on
  // successful loads the FILE_LOAD_ERROR handler would accumulate across
  // repeated preload cycles. Detach on COMPLETE as well, and skip
  // re-attaching when a handler is already pending on the loader.
  const loader = scene.load as Phaser.Loader.LoaderPlugin & {
    listenerCount?: (event: string | symbol) => number
  }
  const errorEvent = Phaser.Loader.Events.FILE_LOAD_ERROR
  if (typeof loader.listenerCount === 'function' && loader.listenerCount(errorEvent) > 0) {
    return
  }
  const onError = (file: { key?: string; src?: string }): void => {
    if (cardArtLoadErrorReported) {
      return
    }
    cardArtLoadErrorReported = true
    // eslint-disable-next-line no-console
    console.warn('[phaser] failed to load card art', file?.key ?? '<unknown>', file?.src ?? '')
  }
  scene.load.once(errorEvent, onError)
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.load.off(errorEvent, onError)
  })
}

function cardStyleForLand(name: string, visualStyle: AppViewModel['cardVisualStyle']): CardStyle {
  if (!isBasicLand(name)) {
    return { fill: 0x132652, stroke: 0x4f6caa, text: '#e5ecf5' }
  }
  const palette = cardVisualPaletteFor(name, visualStyle)
  return {
    fill: colorHexToNumber(palette.cardFill),
    stroke: colorHexToNumber(palette.cardStroke),
    text: palette.cardText,
  }
}

function recordingMetadataText(view: AppViewModel): string {
  const meta = view.recording.metadata
  if (!meta) {
    return 'No recording loaded.'
  }
  return `Seed ${meta.seed} • ${meta.mode} • AI ${meta.aiLevel} • ${meta.controllers[0]}/${meta.controllers[1]} • Completed ${meta.completed ? 'Yes' : 'No'}`
}

type InstallButtonState = {
  label: string
  onClick: () => void
  disabled?: boolean
}

function installButtonState(): InstallButtonState {
  const installState = getInstallUiState()
  if (installState.canPromptInstall) {
    return {
      label: 'Install App',
      onClick: () => { void promptInstall() },
    }
  }
  if (installState.showIosInstallHint) {
    return {
      label: 'iOS: Share → Add to Home Screen',
      onClick: () => {},
      disabled: true,
    }
  }
  if (installState.isStandalone) {
    return {
      label: 'Installed app mode active',
      onClick: () => {},
      disabled: true,
    }
  }
  return {
    label: 'Install unavailable in this browser',
    onClick: () => {},
    disabled: true,
  }
}

function buildButton(
  scene: Phaser.Scene,
  label: string,
  x: number,
  y: number,
  fontSize: string,
  width: number,
  height: number,
  onClick: () => void,
): Phaser.GameObjects.Container {
  const requestedPx = Number.parseFloat(fontSize)
  const derivedPx = clamp(height * BUTTON_TEXT_HEIGHT_RATIO, MIN_BUTTON_FONT_PX, MAX_BUTTON_FONT_PX)
  const widthScale = width < BUTTON_TEXT_NARROW_WIDTH_THRESHOLD ? BUTTON_TEXT_NARROW_WIDTH_SCALE : 1
  const resolvedPx = clamp(
    Math.min(Number.isFinite(requestedPx) ? requestedPx : derivedPx, derivedPx * 1.08) * widthScale,
    MIN_BUTTON_FONT_PX,
    MAX_BUTTON_FONT_PX,
  )
  const background = scene.add.rectangle(0, 0, width, height, UI_THEME.buttonFill).setStrokeStyle(1, UI_THEME.buttonStroke)
  const text = scene.add.text(0, 0, label, {
    color: UI_THEME.primaryText,
    fontSize: `${Math.round(resolvedPx)}px`,
    align: 'center',
    wordWrap: { width: Math.max(8, width - BUTTON_TEXT_HORIZONTAL_PADDING) },
    maxLines: BUTTON_TEXT_MAX_LINES,
  }).setOrigin(0.5)
  const button = scene.add.container(x, y, [background, text])
  button.setSize(width, height)
  button.setInteractive({ useHandCursor: true })
  button.on('pointerup', onClick)
  return button
}

class LobbyScene extends Phaser.Scene {
  private readonly rendererRef: PhaserRenderer
  private rootContainer: Phaser.GameObjects.Container | null = null
  private currentLayout: SceneLayout = buildLayout(BASE_WIDTH, BASE_HEIGHT, 'horizontal')
  private lastLayoutSignature = ''
  private activeSubmenu: LobbySubmenu = 'root'
  private aiLevelOptionsOpen = false

  constructor(rendererRef: PhaserRenderer) {
    super(LOBBY_SCENE_KEY)
    this.rendererRef = rendererRef
  }

  getActiveSubmenu(): LobbySubmenu {
    return this.activeSubmenu
  }

  isAiLevelOptionsOpen(): boolean {
    return this.aiLevelOptionsOpen
  }

  showRootMenu(): void {
    this.activeSubmenu = 'root'
    this.aiLevelOptionsOpen = false
    this.renderView(this.rendererRef.currentView)
  }

  showSettingsMenu(): void {
    this.activeSubmenu = 'settings'
    this.renderView(this.rendererRef.currentView)
  }

  showRecordingMenu(): void {
    this.activeSubmenu = 'recording'
    this.renderView(this.rendererRef.currentView)
  }

  toggleAiLevelOptions(): void {
    if (this.activeSubmenu !== 'settings') {
      return
    }
    this.aiLevelOptionsOpen = !this.aiLevelOptionsOpen
    this.renderView(this.rendererRef.currentView)
  }

  closeAiLevelOptions(): void {
    if (!this.aiLevelOptionsOpen) {
      return
    }
    this.aiLevelOptionsOpen = false
    this.renderView(this.rendererRef.currentView)
  }

  preload(): void {
    preloadCardArt(this)
  }

  create(): void {
    this.rootContainer = this.add.container(0, 0)
    // Phaser reuses the same LobbyScene instance across stop/start cycles, so
    // reset submenu UI state here to avoid carrying an old submenu forward
    // when returning from an in-progress match back to the lobby.
    this.activeSubmenu = 'root'
    this.aiLevelOptionsOpen = false
    this.updateLayout()

    // Save the resize listener so we can detach it on scene shutdown. Without
    // this, every lobby↔game scene transition would reuse the same scene
    // instance and rerun create(), accumulating duplicate listeners that fire
    // on later resizes.
    const onResize = (): void => {
      if (this.updateLayout()) {
        this.renderView(this.rendererRef.currentView)
      }
    }
    this.scale.on('resize', onResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize)
    })

    this.renderView(this.rendererRef.currentView)
  }

  private updateLayout(): boolean {
    const width = this.scale.gameSize.width ?? this.scale.width ?? BASE_WIDTH
    const height = this.scale.gameSize.height ?? this.scale.height ?? BASE_HEIGHT
    const orientation = orientationFromViewport(width, height)
    this.currentLayout = buildLayout(width, height, orientation)
    const signature = `${width}x${height}:${orientation}:${this.currentLayout.isCompact ? 'compact' : 'full'}`
    const changed = signature !== this.lastLayoutSignature
    this.lastLayoutSignature = signature
    return changed
  }

  renderView(_view: AppViewModel | null): void {
    this.updateLayout()
    if (!this.rootContainer) {
      return
    }
    this.rootContainer.removeAll(true)

    const left = this.currentLayout.margin
    const top = this.currentLayout.headerTop

    this.rootContainer.add(this.add.text(left, top, 'Basic Land Game (Phaser Renderer)', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.titleFontSize,
    }))
    this.rootContainer.add(this.add.text(left, top + this.currentLayout.actionButtonHeight + 6, 'Land-only 2-player game with local AI and optional P2P mode.', {
      color: '#9db0d9',
      fontSize: this.currentLayout.subtitleFontSize,
      wordWrap: { width: Math.max(40, this.currentLayout.width - left * 2) },
    }))

    const modes: Array<{ mode: Mode; label: string }> = [
      { mode: 'local-hvh', label: 'Local Human vs Human' },
      { mode: 'local-hvai', label: 'Local Human vs AI' },
      { mode: 'local-aivai', label: 'Local AI vs AI' },
      { mode: 'adventure-hvai', label: 'Adventure (Human vs AI)' },
      { mode: 'p2p-host', label: 'P2P Host' },
      { mode: 'p2p-join', label: 'P2P Join' },
    ]

    const view = this.rendererRef.currentView
    const hasLocalSave = view?.recording?.hasLocalSave ?? false
    const selectedAiLevel = view?.aiLevel ?? 'basic'
    const selectedAiLevelLabel = AI_LEVEL_OPTIONS.find((option) => option.value === selectedAiLevel)?.label ?? 'Basic'
    const selectedCardVisualStyle = view?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    const adventure = view?.adventure
    const nextOpponent = adventure?.opponentLineup?.[adventure.currentOpponentIndex]
    const adventureStatusText = this.add.text(
      left,
      top + this.currentLayout.actionButtonHeight + 6 + Math.max(this.currentLayout.actionButtonHeight, 28),
      `Adventure: ${adventure?.status ?? 'inactive'} • Round ${adventure?.currentRound ?? 0}/7 • Chances ${adventure?.remainingChances ?? 0} • High Score ${adventure?.highScore ?? 0}${nextOpponent ? ` • Next ${nextOpponent.label}` : ''}`,
      {
        color: '#9db0d9',
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: Math.max(40, this.currentLayout.width - left * 2) },
      },
    )
    this.rootContainer.add(adventureStatusText)

    type LobbyRow = { label: string; disabled?: boolean; onClick: () => void }
    const rows: LobbyRow[] = []
    const installEntry = installButtonState()
    const canResumeAdventure = !!adventure?.hasSavedRun && (adventure.status === 'paused' || adventure.status === 'active')
    if (this.activeSubmenu === 'root') {
      modes.forEach((entry) => {
        rows.push({
          label: entry.label,
          onClick: () => { this.rendererRef.controller?.startGame(entry.mode) },
        })
      })
      rows.push({ label: 'Settings', onClick: () => { this.showSettingsMenu() } })
      rows.push({ label: 'Recording', onClick: () => { this.showRecordingMenu() } })
      if (canResumeAdventure) {
        rows.push({ label: 'Resume Adventure', onClick: () => { this.rendererRef.controller?.resumeAdventure() } })
      }
      if (adventure?.hasSavedRun) {
        rows.push({ label: 'Reset Adventure Run', onClick: () => { this.rendererRef.controller?.abandonAdventure() } })
      }
      rows.push({
        label: installEntry.label,
        disabled: installEntry.disabled,
        onClick: installEntry.onClick,
      })
      rows.push({
        label: 'Switch to DOM renderer',
        onClick: () => { window.location.search = '?renderer=dom' },
      })
    } else if (this.activeSubmenu === 'settings') {
      rows.push({ label: 'Back', onClick: () => { this.showRootMenu() } })
      rows.push({
        label: `AI Difficulty: ${selectedAiLevelLabel}${this.aiLevelOptionsOpen ? ' ▲' : ' ▼'}`,
        onClick: () => { this.toggleAiLevelOptions() },
      })
      if (this.aiLevelOptionsOpen) {
        AI_LEVEL_OPTIONS.forEach((option) => {
          const selected = option.value === selectedAiLevel
          rows.push({
            label: selected ? `Set AI: ${option.label} ✓` : `Set AI: ${option.label}`,
            onClick: () => {
              this.rendererRef.controller?.setAiLevel(option.value)
              this.closeAiLevelOptions()
            },
          })
        })
      }
      CARD_VISUAL_STYLE_OPTIONS.forEach((option) => {
        const selected = option.value === selectedCardVisualStyle
        rows.push({
          label: selected ? `Card Style: ${option.label} ✓` : `Card Style: ${option.label}`,
          onClick: () => { this.rendererRef.controller?.setCardVisualStyle(option.value) },
        })
      })
      const selectedAnimationSpeed = view?.animationSpeed ?? 'normal'
      ANIMATION_SPEED_OPTIONS.forEach((option) => {
        const selected = option.value === selectedAnimationSpeed
        rows.push({
          label: selected ? `Animations: ${option.label} ✓` : `Animations: ${option.label}`,
          onClick: () => { this.rendererRef.controller?.setAnimationSpeed(option.value) },
        })
      })
    } else {
      rows.push({ label: 'Back', onClick: () => { this.showRootMenu() } })
      rows.push({
        label: 'Load Recording from Browser',
        disabled: !hasLocalSave,
        onClick: () => { this.rendererRef.controller?.loadRecordingFromLocalStorage() },
      })
      rows.push({
        label: 'Load Recording from File',
        onClick: () => { this.rendererRef.openRecordingFilePicker() },
      })
    }

    const buttonWidth = Math.min(this.currentLayout.width - left * 2, this.currentLayout.isCompact ? 330 : 360)
    const subtitleBottom = top + this.currentLayout.actionButtonHeight + 6
      + Math.max(this.currentLayout.actionButtonHeight, 28)
      + Math.max(0, adventureStatusText.height) + 8
    const lobbyBodyTop = subtitleBottom + 16
    const lobbyBodyBottom = this.currentLayout.height
      - this.currentLayout.statusBottomOffset - this.currentLayout.margin
    let rowsTop = lobbyBodyTop
    if (this.activeSubmenu !== 'root') {
      const submenuLabel = this.activeSubmenu === 'settings' ? 'Settings' : 'Recording'
      const heading = this.add.text(left, rowsTop, submenuLabel, {
        color: '#9db0d9',
        fontSize: this.currentLayout.bodyFontSize,
      })
      this.rootContainer.add(heading)
      rowsTop += Math.max(18, heading.height) + 8
    }
    const lobbyBodyHeight = Math.max(80, lobbyBodyBottom - rowsTop)
    const totalRows = rows.length
    const desiredButtonHeight = this.currentLayout.isCompact ? 38 : 44
    const desiredGap = this.currentLayout.isCompact ? 8 : 14
    const desiredRowHeight = desiredButtonHeight + desiredGap
    const rowScale = Math.min(1, lobbyBodyHeight / Math.max(1, totalRows * desiredRowHeight))
    const rowHeight = desiredRowHeight * rowScale
    if (rowHeight < MIN_LOBBY_ROW_HEIGHT) {
      this.rootContainer?.add(this.add.text(
        left,
        rowsTop,
        'Viewport too short to show lobby actions. Increase window height.',
        {
          color: '#9db0d9',
          fontSize: this.currentLayout.smallFontSize,
          wordWrap: { width: buttonWidth },
        },
      ))
      this.rendererRef.refreshA11yNavForCurrentView()
      return
    }
    const buttonHeight = Math.min(desiredButtonHeight, rowHeight)
    const modeStartY = rowsTop + buttonHeight / 2
    rows.forEach((entry, index) => {
      const button = buildButton(
        this,
        entry.label,
        left + buttonWidth / 2,
        modeStartY + index * rowHeight,
        this.currentLayout.actionButtonFontSize,
        buttonWidth,
        buttonHeight,
        entry.disabled ? () => {} : entry.onClick,
      )
      if (entry.disabled) {
        button.setAlpha(0.4)
        button.disableInteractive()
      }
      this.rootContainer?.add(button)
    })

    // Status footer (renders any controller status strings such as P2P signaling errors).
    const status = this.rendererRef.currentView?.status ?? ''
    if (status) {
      this.rootContainer.add(this.add.text(
        this.currentLayout.margin,
        this.currentLayout.height - this.currentLayout.statusBottomOffset,
        status,
        {
          color: '#9db0d9',
          fontSize: this.currentLayout.bodyFontSize,
          wordWrap: { width: Math.max(40, this.currentLayout.width - this.currentLayout.margin * 2) },
        },
      ))
    }
    this.rendererRef.refreshA11yNavForCurrentView()
  }
}

class CardgameScene extends Phaser.Scene {
  private readonly rendererRef: PhaserRenderer
  private rootContainer: Phaser.GameObjects.Container | null = null
  private statusText: Phaser.GameObjects.Text | null = null
  private battlefieldDropZone: Phaser.GameObjects.Zone | null = null
  private pendingTargetPicker: Phaser.GameObjects.Container | null = null
  private pendingTargetPickerA11yEntries: Array<{ key: string; label: string; onSelect: () => void }> = []
  private pendingPlayLandTargetSelection: {
    cardId: string
    options: Array<{ effectTargetId?: string; label: string }>
  } | null = null
  private battlefieldTargetEntries: BattlefieldTargetEntry[] = []
  private menuOverlay: Phaser.GameObjects.Container | null = null
  private menuOpen = false
  private menuContentScrollOffset: number | null = null
  private menuLogScrollOffset: number | null = null
  private menuLogPinnedToBottom = true
  private inSceneLogScrollOffset: number | null = null
  private inSceneLogPinnedToBottom = true
  // Tracks the seed of the game currently rendered in this scene. When
  // the seed changes (e.g. via rematch) we reset the log scroll state so
  // the next game opens with the in-scene log pinned to the newest entry
  // instead of preserving the stale offset from the previous match.
  private lastRenderedSeed: number | null = null
  private lastMenuSignature: string | null = null
  private currentLayout: SceneLayout = buildLayout(BASE_WIDTH, BASE_HEIGHT, 'horizontal')
  private lastLayoutSignature = ''
  // Visual ability-resolution effects pipeline. Each render diff appends new
  // ability events to the queue; the pump plays one at a time, capped by
  // MAX_QUEUED_EFFECTS to prevent backlog during AI-vs-AI sessions.
  private effectQueue: EffectQueueState = createEffectQueue()
  private lastAnimatedEventCount = 0

  private snapCardToOrigin(card: Phaser.GameObjects.Container): void {
    const ox = card.getData('originX')
    const oy = card.getData('originY')
    if (typeof ox === 'number' && typeof oy === 'number') {
      card.x = ox
      card.y = oy
    }
  }

  constructor(rendererRef: PhaserRenderer) {
    super(CARDGAME_SCENE_KEY)
    this.rendererRef = rendererRef
  }

  preload(): void {
    preloadCardArt(this)
  }

  create(): void {
    this.rootContainer = this.add.container(0, 0)
    // Reset per-match scroll state. The Phaser game keeps a single
    // CardgameScene instance and re-runs create() on each scene start, so any
    // log scroll offset from a previous game would otherwise persist and open
    // the next match scrolled away from the newest log entries.
    this.inSceneLogScrollOffset = null
    this.inSceneLogPinnedToBottom = true
    this.lastRenderedSeed = null
    this.updateLayout()
    this.statusText = this.add.text(this.currentLayout.margin, this.currentLayout.height - this.currentLayout.statusBottomOffset, '', {
      color: '#9db0d9',
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
        this.snapCardToOrigin(card)
        return
      }
      if (!dropped) {
        this.snapCardToOrigin(card)
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
        this.snapCardToOrigin(card)
        return
      }

      if (resolution.kind === 'single') {
        this.pendingPlayLandTargetSelection = null
        this.rendererRef.controller?.submitAction(resolution.action)
        return
      }

      this.snapCardToOrigin(card)
      const mode = resolvePlayLandTargetSelectionMode(game, cardId)
      if (mode === 'battlefield_highlight') {
        this.pendingPlayLandTargetSelection = {
          cardId,
          options: resolution.options,
        }
        this.renderView(this.rendererRef.currentView)
        this.setStatus('Choose a highlighted battlefield target.')
        return
      }
      const groupedOptions = groupCardTargetOptions(game, { kind: 'play_land', cardId }, resolution.options)
      this.pendingPlayLandTargetSelection = null
      this.showTargetPicker(
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
    })

    this.renderView(this.rendererRef.currentView)
  }

  private updateLayout(): boolean {
    const width = this.scale.gameSize.width ?? this.scale.width ?? BASE_WIDTH
    const height = this.scale.gameSize.height ?? this.scale.height ?? BASE_HEIGHT
    const orientation = orientationFromViewport(width, height)
    this.currentLayout = buildLayout(width, height, orientation)
    const signature = `${width}x${height}:${orientation}:${this.currentLayout.isCompact ? 'compact' : 'full'}:${this.currentLayout.isCollapsed ? 'collapsed' : 'split'}`
    const changed = signature !== this.lastLayoutSignature
    this.lastLayoutSignature = signature
    return changed
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.setText(message)
      this.statusText.setPosition(this.currentLayout.margin, this.currentLayout.height - this.currentLayout.statusBottomOffset)
      this.statusText.setFontSize(this.currentLayout.bodyFontSize)
    }
  }

  private clearRoot(): void {
    const wasMenuOpen = this.menuOpen
    this.menuOverlay = null
    this.rootContainer?.removeAll(true)
    this.pendingTargetPicker = null
    this.pendingTargetPickerA11yEntries = []
    this.battlefieldDropZone = null
    this.battlefieldTargetEntries = []
    this.menuOpen = wasMenuOpen
  }

  private xForCardInBoardColumn(index: number, count: number): number {
    if (count <= 1) {
      return this.currentLayout.boardColumnLeft + this.currentLayout.boardColumnWidth / 2
    }

    const minX = this.currentLayout.boardColumnLeft + this.currentLayout.cardWidth / 2 + 4
    const maxX = this.currentLayout.boardColumnLeft + this.currentLayout.boardColumnWidth - this.currentLayout.cardWidth / 2 - 4
    if (maxX <= minX) {
      return (minX + maxX) / 2
    }
    const maxGap = (maxX - minX) / (count - 1)
    const gap = Math.min(this.currentLayout.cardGap, maxGap)
    const usedWidth = gap * (count - 1)
    const availableWidth = maxX - minX
    const startX = minX + (availableWidth - usedWidth) / 2 // Center the card spread inside the available column.
    return startX + index * gap
  }

  renderView(view: AppViewModel | null): void {
    this.updateLayout()
    const game = view?.game ?? null
    // Reset the in-scene log scroll state when the seed changes, e.g. on
    // a rematch. Without this, the reused CardgameScene would inherit the
    // previous match's scroll offset (`inSceneLogPinnedToBottom = false`)
    // and open the new game scrolled away from the newest log entries.
    if (view && game) {
      const currentSeed = view.seed
      if (this.lastRenderedSeed !== null && this.lastRenderedSeed !== currentSeed) {
        this.inSceneLogScrollOffset = null
        this.inSceneLogPinnedToBottom = true
        // Reset ability-effect bookkeeping so a fresh game doesn't replay
        // animations queued from a previous match.
        clearEffectQueue(this.effectQueue)
        this.lastAnimatedEventCount = 0
      }
      this.lastRenderedSeed = currentSeed
    } else {
      this.lastRenderedSeed = null
      clearEffectQueue(this.effectQueue)
      this.lastAnimatedEventCount = 0
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
      this.pendingPlayLandTargetSelection = null
      this.battlefieldTargetEntries = []
      preservedOverlay?.destroy(true)
      this.lastMenuSignature = null
      return
    }

    this.setStatus(view.status)

    if (!view.game) {
      this.pendingPlayLandTargetSelection = null
      this.battlefieldTargetEntries = []
      preservedOverlay?.destroy(true)
      this.closeMenuOverlay()
      this.lastMenuSignature = null
      return
    }

    this.syncPendingPlayLandTargetSelection(view.game)
    this.battlefieldTargetEntries = this.currentBattlefieldTargetEntries(view.game)
    this.renderGame(view)
    this.processAbilityEffects(view)
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
    return buildButton(this, label, x, y, fontSize, width, height, onClick)
  }

  private popupActionWidth(maxWidth: number, ratio: number, minWidth: number): number {
    return Math.min(maxWidth, Math.max(minWidth, maxWidth * ratio))
  }

  private createCardChoiceButton(
    label: string,
    cardName: string,
    x: number,
    y: number,
    onClick: () => void,
    width: number,
    height: number,
    fontSize = this.currentLayout.popupButtonFontSize,
  ): Phaser.GameObjects.Container {
    const visualStyle = this.rendererRef.currentView?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    const style = cardStyleForLand(cardName, visualStyle)
    const background = this.add.rectangle(0, 0, width, height, style.fill).setStrokeStyle(2, style.stroke)
    const text = this.add.text(0, 0, label, {
      color: style.text,
      fontSize,
      align: 'center',
      wordWrap: { width: Math.max(8, width - BUTTON_TEXT_HORIZONTAL_PADDING) },
      maxLines: BUTTON_TEXT_MAX_LINES,
    }).setOrigin(0.5)
    const button = this.add.container(x, y, [background, text])
    const iconSize = Math.max(
      CARD_CHOICE_ICON_MIN_SIZE,
      Math.floor(Math.min(width * CARD_CHOICE_ICON_WIDTH_RATIO, height * CARD_CHOICE_ICON_HEIGHT_RATIO)),
    )
    if (isBasicLand(cardName)) {
      this.addCardArtToContainer(
        cardName,
        visualStyle,
        -width / 2 + 12 + Math.floor(iconSize / 2),
        0,
        iconSize,
        button,
      )
    }
    button.setSize(width, height)
    button.setInteractive({ useHandCursor: true })
    button.on('pointerup', onClick)
    return button
  }

  private addPixelIconToContainer(
    land: BasicLand,
    visualStyle: AppViewModel['cardVisualStyle'],
    left: number,
    top: number,
    size: number,
    container: Phaser.GameObjects.Container,
  ): void {
    const palette = cardVisualPaletteFor(land, visualStyle)
    const primary = colorHexToNumber(palette.iconPrimary)
    const secondary = colorHexToNumber(palette.iconSecondary)
    const effectiveSize = bucketIconSize(size)
    const rects = landPixelRects(land, effectiveSize)
    const icon = this.add.graphics()
    icon.setPosition(left, top)
    for (const rect of rects) {
      icon.fillStyle(rect.tone === 'primary' ? primary : secondary)
      icon.fillRect(rect.x, rect.y, rect.size, rect.size)
    }
    container.add(icon)
  }

  // Renders the card art image centered at (centerX, centerY) inside `container`.
  // Falls back to the procedural pixel icon when the texture is not yet
  // available (e.g. during preload, missing asset, or in unit tests with no
  // loader).
  private addCardArtToContainer(
    land: BasicLand,
    visualStyle: AppViewModel['cardVisualStyle'],
    centerX: number,
    centerY: number,
    size: number,
    container: Phaser.GameObjects.Container,
  ): void {
    const key = cardArtKey(land, visualStyle)
    if (this.textures && this.textures.exists(key)) {
      const image = this.add.image(centerX, centerY, key)
      image.setDisplaySize(size, size)
      image.setOrigin(0.5, 0.5)
      container.add(image)
      return
    }
    // Fallback: keep the original pixel-rect icon path so cards remain
    // visible. Bucket the size to match what `addPixelIconToContainer` will
    // use internally so positioning stays centered (otherwise the icon can
    // be off-by-one when `bucketIconSize(size) !== size`).
    const effectiveSize = bucketIconSize(size)
    const left = centerX - Math.floor(effectiveSize / 2)
    const top = centerY - Math.floor(effectiveSize / 2)
    this.addPixelIconToContainer(land, visualStyle, left, top, effectiveSize, container)
  }

  private syncPendingPlayLandTargetSelection(game: GameUiState): void {
    const pending = this.pendingPlayLandTargetSelection
    if (!pending) {
      return
    }
    if (!game.canInput || game.phase !== 'main') {
      this.pendingPlayLandTargetSelection = null
      return
    }
    const legalOptions = game.legal.playLandByCard[pending.cardId]
    if (!legalOptions || legalOptions.length <= 1) {
      this.pendingPlayLandTargetSelection = null
      return
    }
    const legalTargetIds = new Set(legalOptions.map((option) => option.action.effectTargetId).filter((id): id is string => typeof id === 'string'))
    const stillValid = pending.options.filter((option) => option.effectTargetId && legalTargetIds.has(option.effectTargetId))
    if (stillValid.length === 0) {
      this.pendingPlayLandTargetSelection = null
      return
    }
    this.pendingPlayLandTargetSelection = {
      ...pending,
      options: stillValid,
    }
  }

  private currentBattlefieldTargetEntries(game: GameUiState): BattlefieldTargetEntry[] {
    const entries: BattlefieldTargetEntry[] = []
    if (!game.canInput || this.menuOpen) {
      return entries
    }

    if (game.phase === 'main' && this.pendingPlayLandTargetSelection) {
      const { cardId, options } = this.pendingPlayLandTargetSelection
      if (resolvePlayLandTargetSelectionMode(game, cardId) !== 'battlefield_highlight') {
        return entries
      }
      const actor = game.actor
      const enemy = actor === 0 ? 1 : 0
      const sourceCard = game.players[actor].handCards.find((card) => card.id === cardId)
      const owner: BattlefieldTargetOwner = sourceCard?.name === 'Mountain' ? 'non-active' : 'active'
      const lookupPlayer = owner === 'active' ? actor : enemy
      for (const option of options) {
        if (!option.effectTargetId) {
          continue
        }
        const action = resolveTargetedPlayLandAction(game, cardId, option.effectTargetId)
        if (!action) {
          continue
        }
        const targetName = game.players[lookupPlayer].battlefield.find((entry) => entry.instanceId === option.effectTargetId)?.name ?? 'Target'
        entries.push({
          owner,
          effectTargetId: option.effectTargetId,
          cardName: targetName,
          onSelect: () => {
            this.pendingPlayLandTargetSelection = null
            this.rendererRef.controller?.submitAction(action)
          },
        })
      }
      return entries
    }

    if (game.phase === 'plains_target' && resolvePlainsReuseTargetSelectionMode(game) === 'battlefield_highlight') {
      const owner: BattlefieldTargetOwner = game.pendingPlainsReuseName === 'Mountain' ? 'non-active' : 'active'
      const actor = game.actor
      const enemy = actor === 0 ? 1 : 0
      const lookupPlayer = owner === 'active' ? actor : enemy
      for (const option of game.legal.plainsReuseOptions) {
        const targetId = option.action.effectTargetId
        if (!targetId) {
          continue
        }
        const targetName = game.players[lookupPlayer].battlefield.find((entry) => entry.instanceId === targetId)?.name ?? 'Target'
        entries.push({
          owner,
          effectTargetId: targetId,
          cardName: targetName,
          onSelect: () => {
            this.rendererRef.controller?.submitAction(option.action)
          },
        })
      }
    }
    return entries
  }

  private findBattlefieldTargetEntry(owner: BattlefieldTargetOwner, effectTargetId: string): BattlefieldTargetEntry | null {
    return this.battlefieldTargetEntries.find((entry) => entry.owner === owner && entry.effectTargetId === effectTargetId) ?? null
  }

  private bindScrollableViewport(
    viewportBackground: Phaser.GameObjects.Rectangle,
    applyScroll: (deltaY: number) => void,
    shouldHandleWheel?: (pointer: Phaser.Input.Pointer) => boolean,
    shouldStartDrag?: (pointer: Phaser.Input.Pointer) => boolean,
  ): void {
    const isPointerWithinViewport = (pointer: Phaser.Input.Pointer): boolean => {
      const bounds = viewportBackground.getBounds()
      const withinX = pointer.worldX >= bounds.left && pointer.worldX <= bounds.right
      const withinY = pointer.worldY >= bounds.top && pointer.worldY <= bounds.bottom
      return withinX && withinY
    }

    const handleWheel = (
      pointer: Phaser.Input.Pointer,
      _gameObjects: Phaser.GameObjects.GameObject[],
      _deltaX: number,
      deltaY: number,
    ): void => {
      if (shouldHandleWheel && !shouldHandleWheel(pointer)) {
        return
      }
      if (isPointerWithinViewport(pointer)) {
        applyScroll(deltaY * SCROLL_WHEEL_MULTIPLIER)
      }
    }

    let dragPointerId: number | null = null
    let lastDragY = 0
    const handleViewportPointerDown = (pointer: Phaser.Input.Pointer): void => {
      if (!isPointerWithinViewport(pointer)) {
        return
      }
      if (shouldStartDrag && !shouldStartDrag(pointer)) {
        return
      }
      dragPointerId = pointer.id
      lastDragY = pointer.worldY
    }
    const handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
      if (dragPointerId !== pointer.id) {
        return
      }
      const deltaY = lastDragY - pointer.worldY
      applyScroll(deltaY)
      lastDragY = pointer.worldY
    }
    const handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
      if (dragPointerId === pointer.id) {
        dragPointerId = null
      }
    }

    this.input.on('wheel', handleWheel)
    viewportBackground.on('pointerdown', handleViewportPointerDown)
    this.input.on('pointermove', handlePointerMove)
    this.input.on('pointerup', handlePointerUp)
    this.input.on('pointerupoutside', handlePointerUp)
    viewportBackground.once(Phaser.GameObjects.Events.DESTROY, () => {
      dragPointerId = null
      this.input.off('wheel', handleWheel)
      viewportBackground.off('pointerdown', handleViewportPointerDown)
      this.input.off('pointermove', handlePointerMove)
      this.input.off('pointerup', handlePointerUp)
      this.input.off('pointerupoutside', handlePointerUp)
    })
  }

  private processAbilityEffects(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }
    const events = game.events
    if (this.lastAnimatedEventCount > events.length) {
      // Engine state went backwards (e.g. replay rewind). Reset and wait
      // for renderView to seed `lastAnimatedEventCount = events.length`.
      clearEffectQueue(this.effectQueue)
      this.lastAnimatedEventCount = events.length
      return
    }
    if (view.animationSpeed === 'off') {
      // Drop any pending visuals immediately and snap the marker forward so
      // toggling the setting on later doesn't replay backlog.
      clearEffectQueue(this.effectQueue)
      this.lastAnimatedEventCount = events.length
      return
    }
    const visualStyle = view.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    for (let index = this.lastAnimatedEventCount; index < events.length; index += 1) {
      const descriptor = effectDescriptorForEvent(events[index], visualStyle)
      if (descriptor) {
        enqueueEffect(this.effectQueue, descriptor)
      }
    }
    this.lastAnimatedEventCount = events.length

    // `pumpEffectQueue` re-invokes this options getter for every drain, so
    // a mid-queue animationSpeed/durationMs change takes effect on the very
    // next pending entry instead of riding out the queue with stale values
    // captured when the first effect started.
    pumpEffectQueue(this.effectQueue, () => {
      const latest = this.rendererRef.currentView ?? view
      const speed = latest.animationSpeed
      return {
        animationSpeed: speed,
        durationMs: durationMsForSpeed(speed),
        run: (descriptor, durationMs, done) => {
          const anchor = this.computeEffectAnchor(latest, descriptor)
          playAbilityEffect(this, anchor, descriptor, durationMs, done)
        },
      }
    })
  }

  private computeEffectAnchor(view: AppViewModel, descriptor: EffectDescriptor): EffectAnchor {
    // Anchor effects to the relevant battlefield row (active vs non-active)
    // so flourishes appear near the affected cards, not in dead screen
    // space. The descriptor `actor` is the actor that initiated the effect.
    const game = view.game
    const layout = this.currentLayout
    const activeIndex = game?.actor ?? 0
    const nonActiveIndex = activeIndex === 0 ? 1 : 0
    const targetsNonActive = descriptor.kind === 'mountain_destroy'
      || descriptor.kind === 'swamp_discard'
      || descriptor.kind === 'counter_resolved'
    const useNonActive = targetsNonActive
      ? descriptor.actor === activeIndex
      : descriptor.actor === nonActiveIndex
    const x = layout.boardColumnLeft + layout.boardColumnWidth / 2
    const rowHeight = useNonActive ? layout.nonActiveBattlefieldHeight : layout.activeBattlefieldHeight
    const y = useNonActive
      ? layout.nonActiveBattlefieldY + layout.nonActiveBattlefieldHeight / 2
      : layout.activeBattlefieldY + layout.activeBattlefieldHeight / 2
    const width = Math.max(80, Math.min(layout.boardColumnWidth - 24, layout.cardWidth * 2.4))
    const height = Math.max(60, Math.min(rowHeight - 12, layout.cardHeight + 16))
    return { x, y, width, height }
  }

  private renderGame(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }

    const left = this.currentLayout.margin

    // Header strip background: a solid rectangle behind the Menu button and
    // turn/phase label. Even if a future regression breaks the log mask, the
    // log paints at Z_LOG and this strip paints at Z_HEADER above it, so the
    // ☰ Menu button and the Winner banner stay readable on top.
    const headerStripHeight = Math.max(this.currentLayout.headerHeight, this.currentLayout.actionButtonHeight + 4)
    const headerStrip = this.add.rectangle(
      this.currentLayout.width / 2,
      this.currentLayout.headerTop + headerStripHeight / 2,
      this.currentLayout.width,
      headerStripHeight,
      0x0b1020,
      1,
    )
    headerStrip.setDepth(Z_HEADER - 1)
    this.rootContainer?.add(headerStrip)

    // Header: Menu button on the left, then turn/phase label. No Rematch in the
    // header — Rematch lives under the Menu (mirrors DOM PR #13 menu-section 1).
    const menuButtonWidth = Math.min(this.currentLayout.actionButtonWidth, 180)
    const menuButton = this.createButton('☰ Menu', left + menuButtonWidth / 2, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight / 2, () => {
      this.openMenuOverlay(view)
    }, menuButtonWidth, this.currentLayout.actionButtonHeight)
    menuButton.setDepth(Z_HEADER)
    this.rootContainer?.add(menuButton)

    const headerTextX = left + menuButtonWidth + 16
    const headerTextWidth = Math.max(40, this.currentLayout.width - this.currentLayout.margin - headerTextX)
    // Winner text used to render as a separate second header row, but the
    // layout only reserves a single-row header before bodyTop, so the banner
    // spilled on top of the board. Inline it into the header text instead so
    // everything stays within the reserved header strip.
    const headerLabel = game.winnerText
      ? `${game.winnerText} • Turn ${game.turn} • Phase: ${game.phase}`
      : `Turn ${game.turn} • Phase: ${game.phase}`
    // Cap the header text to a single line so the inlined winner banner can
    // never wrap onto a second row and spill into bodyTop / overlap the log
    // and board area on collapsed phone-sized layouts. Phaser truncates the
    // text at the line boundary when maxLines is set, which is preferable to
    // overflowing the reserved single-row header strip.
    const headerText = this.add.text(headerTextX, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight / 2, headerLabel, {
      color: game.winnerText ? '#f7d56b' : '#e5ecf5',
      fontSize: this.currentLayout.titleFontSize,
      wordWrap: { width: headerTextWidth },
      maxLines: 1,
    }).setOrigin(0, 0.5)
    headerText.setDepth(Z_HEADER)
    this.rootContainer?.add(headerText)

    if (shouldRenderInSceneReplayLog({ menuOpen: this.menuOpen })) {
      this.renderInSceneLog(game.events, game.log, game.actor)
    }
    this.renderBattlefields(game)
    this.renderPlayerInfoBlocks(view)
    this.renderHandAndControls(game)
  }

  private renderInfoPanel(
    bgColor: number,
    x: number,
    y: number,
    width: number,
    height: number,
    lines: string[],
  ): void {
    if (width <= 0 || height <= 0) {
      return
    }
    const safeWidth = width
    const safeHeight = height
    const bg = this.add.rectangle(x + safeWidth / 2, y + safeHeight / 2, safeWidth, safeHeight, bgColor)
      .setStrokeStyle(1, COLOR_PANEL_STROKE)
    bg.setDepth(Z_BOARD)
    this.rootContainer?.add(bg)
    if (lines.length === 0) {
      return
    }
    const text = this.add.text(x + 10, y + 6, lines.join('\n'), {
      color: '#e5ecf5',
      fontSize: this.currentLayout.bodyFontSize,
      wordWrap: { width: Math.max(40, safeWidth - 20) },
    })
    text.setDepth(Z_BOARD)
    this.rootContainer?.add(text)
  }

  private renderPlayerInfoBlocks(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }

    const activeIndex = game.actor
    const nonActiveIndex = activeIndex === 0 ? 1 : 0
    const activePlayer = game.players[activeIndex]
    const nonActivePlayer = game.players[nonActiveIndex]

    const nonActiveLines = [
      `Player ${nonActiveIndex + 1} (${view.controllers[nonActiveIndex]})`,
      `Hand: ${nonActivePlayer.handCount} • Deck: ${nonActivePlayer.deckCount} • Graveyard: ${nonActivePlayer.graveyardCount}`,
    ]
    const infoLineHeight = Math.ceil(parseFloat(this.currentLayout.bodyFontSize) * INFO_PANEL_LINE_HEIGHT_MULTIPLIER)
    const maxNonActiveLines = Math.max(0, Math.floor((this.currentLayout.nonActiveInfoHeight - INFO_PANEL_VERTICAL_PADDING) / Math.max(1, infoLineHeight)))
    const visibleNonActiveLines = nonActiveLines.slice(0, maxNonActiveLines)
    this.renderInfoPanel(
      COLOR_PLAYER_NON_ACTIVE_FILL,
      this.currentLayout.boardColumnLeft,
      this.currentLayout.nonActiveInfoY,
      this.currentLayout.boardColumnWidth,
      this.currentLayout.nonActiveInfoHeight,
      visibleNonActiveLines,
    )

    const activeLines = [
      `Player ${activeIndex + 1} (${view.controllers[activeIndex]}) — Active`,
      `Hand: ${activePlayer.handCount} • Deck: ${activePlayer.deckCount} • Graveyard: ${activePlayer.graveyardCount}`,
    ]
    // On tight viewports the layout limits how many lines of active-info text
    // fit above the controls band (End Turn / response buttons). Render only
    // that many lines so the text does not spill into the controls band or
    // the hand strip on short split layouts (e.g. 720x360 horizontal).
    // During response/plains-target phases we show a dedicated prompt above the
    // controls, so hide the active-info summary lines to avoid text overlap on
    // short split layouts.
    const allowedActiveLines = game.phase === 'respond' || game.phase === 'plains_target'
      ? 0
      : Math.max(0, Math.min(activeLines.length, this.currentLayout.activeInfoTextLines))
    const visibleActiveLines = allowedActiveLines === 0 ? [] : activeLines.slice(0, allowedActiveLines)
    this.renderInfoPanel(
      COLOR_PLAYER_ACTIVE_FILL,
      this.currentLayout.boardColumnLeft,
      this.currentLayout.activeInfoY,
      this.currentLayout.boardColumnWidth,
      this.currentLayout.activeInfoHeight,
      visibleActiveLines,
    )
  }

  private renderBattlefields(game: GameUiState): void {
    const activeIndex = game.actor
    const nonActiveIndex = activeIndex === 0 ? 1 : 0

    // Non-active battlefield (top, no drop zone, red tint).
    const nonActiveX = this.currentLayout.boardColumnLeft + this.currentLayout.boardColumnWidth / 2
    const nonActiveY = this.currentLayout.nonActiveBattlefieldY + this.currentLayout.nonActiveBattlefieldHeight / 2
    const nonActiveBg = this.add.rectangle(
      nonActiveX,
      nonActiveY,
      this.currentLayout.boardColumnWidth,
      this.currentLayout.nonActiveBattlefieldHeight,
      COLOR_BATTLEFIELD_NON_ACTIVE_FILL,
    ).setStrokeStyle(2, COLOR_BATTLEFIELD_NON_ACTIVE_STROKE)
    this.rootContainer?.add(nonActiveBg)
    this.rootContainer?.add(this.add.text(
      this.currentLayout.boardColumnLeft + 8,
      this.currentLayout.nonActiveBattlefieldY + 4,
      `Player ${nonActiveIndex + 1} Battlefield`,
      {
        color: '#f0d2d2',
        fontSize: this.currentLayout.smallFontSize,
      },
    ))

    const nonActiveBattlefield = game.players[nonActiveIndex].battlefield
    // Reserve a small header band at the top of the battlefield panel so the
    // "Player N Battlefield" label doesn't overlap the top edge of the cards
    // rendered inside the panel.
    const battlefieldHeaderBand = Math.min(
      DEFAULT_BATTLEFIELD_HEADER_BAND,
      Math.max(0, this.currentLayout.nonActiveBattlefieldHeight - this.currentLayout.cardHeight),
    )
    const nonActiveCardY = this.currentLayout.nonActiveBattlefieldY
      + battlefieldHeaderBand
      + Math.max(0, this.currentLayout.nonActiveBattlefieldHeight - battlefieldHeaderBand) / 2
    for (let index = 0; index < nonActiveBattlefield.length; index += 1) {
      const card = nonActiveBattlefield[index]
      const targetEntry = this.findBattlefieldTargetEntry('non-active', card.instanceId)
      this.rootContainer?.add(this.renderStaticCard(
        this.xForCardInBoardColumn(index, nonActiveBattlefield.length),
        nonActiveCardY,
        card.name,
        {
          highlight: targetEntry !== null,
          onClick: targetEntry?.onSelect,
        },
      ))
    }

    // Active battlefield (below non-active, drop zone enabled, green tint).
    const activeX = this.currentLayout.boardColumnLeft + this.currentLayout.boardColumnWidth / 2
    const activeY = this.currentLayout.activeBattlefieldY + this.currentLayout.activeBattlefieldHeight / 2
    const activeBg = this.add.rectangle(
      activeX,
      activeY,
      this.currentLayout.boardColumnWidth,
      this.currentLayout.activeBattlefieldHeight,
      COLOR_BATTLEFIELD_ACTIVE_FILL,
    ).setStrokeStyle(2, COLOR_BATTLEFIELD_ACTIVE_STROKE)
    this.rootContainer?.add(activeBg)
    this.rootContainer?.add(this.add.text(
      this.currentLayout.boardColumnLeft + 8,
      this.currentLayout.activeBattlefieldY + 4,
      `Player ${activeIndex + 1} Battlefield (drop card here)`,
      {
        color: '#d2f0d8',
        fontSize: this.currentLayout.smallFontSize,
      },
    ))

    const dropZone = this.add.zone(activeX, activeY, this.currentLayout.boardColumnWidth, this.currentLayout.activeBattlefieldHeight)
    dropZone.setRectangleDropZone(this.currentLayout.boardColumnWidth, this.currentLayout.activeBattlefieldHeight)
    dropZone.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.battlefieldDropZone === dropZone) {
        this.battlefieldDropZone = null
      }
    })
    this.battlefieldDropZone = dropZone
    this.rootContainer?.add(dropZone)

    const activeBattlefield = game.players[activeIndex].battlefield
    // Reserve the same header band as the non-active row so the active title
    // sits in its own padding instead of overlapping the rendered cards.
    const activeHeaderBand = Math.min(
      DEFAULT_BATTLEFIELD_HEADER_BAND,
      Math.max(0, this.currentLayout.activeBattlefieldHeight - this.currentLayout.cardHeight),
    )
    const activeCardY = this.currentLayout.activeBattlefieldY
      + activeHeaderBand
      + Math.max(0, this.currentLayout.activeBattlefieldHeight - activeHeaderBand) / 2
    for (let index = 0; index < activeBattlefield.length; index += 1) {
      const card = activeBattlefield[index]
      const targetEntry = this.findBattlefieldTargetEntry('active', card.instanceId)
      this.rootContainer?.add(this.renderStaticCard(
        this.xForCardInBoardColumn(index, activeBattlefield.length),
        activeCardY,
        card.name,
        {
          highlight: targetEntry !== null,
          onClick: targetEntry?.onSelect,
        },
      ))
    }
  }

  // Builds a vertical column of structured log "tiles" (actor pill + glyph or
  // land card art + label) inside a container positioned at (0, 0). Returns
  // the total content height in pixels so callers can drive scrolling.
  // When `events` is empty but `legacyLog` has content (e.g. a back-filled
  // legacy recording), each log string is rendered as a plain text tile so
  // the panel still shows the historical play log instead of an empty state.
  private buildLogTilesContent(
    events: readonly LogEvent[],
    contentWidth: number,
    visualStyle: AppViewModel['cardVisualStyle'],
    options: { activeActor: number; legacyLog?: readonly string[] },
  ): { container: Phaser.GameObjects.Container; contentHeight: number; tileCount: number } {
    const container = this.add.container(0, 0)
    const fontSize = parseFloat(this.currentLayout.smallFontSize) || 12
    const tileSpacing = 4
    const tilePadding = 4
    const iconSize = Math.max(14, Math.round(fontSize * 1.4))
    const pillWidth = Math.max(22, Math.round(fontSize * 2.2))
    const tileHeight = Math.max(iconSize + tilePadding * 2, Math.round(fontSize * 2))
    const activeActor = options.activeActor

    // Legacy fallback: when the structured event stream is missing (e.g.
    // back-filled to [] for a pre-LogEvent recording) but we still have raw
    // log strings, render each string as a plain text row so users don't see
    // an empty panel for content that does exist.
    if (events.length === 0 && options.legacyLog && options.legacyLog.length > 0) {
      let cursorY = 0
      const totalLines = options.legacyLog.length
      const visibleLines = totalLines > MAX_RENDERED_LOG_TILES
        ? options.legacyLog.slice(totalLines - MAX_RENDERED_LOG_TILES)
        : options.legacyLog
      if (totalLines > MAX_RENDERED_LOG_TILES) {
        const omittedCount = totalLines - visibleLines.length
        const note = this.add.text(0, cursorY + tilePadding, `… ${omittedCount} older entries omitted`, {
          color: '#9db0d9',
          fontSize: this.currentLayout.smallFontSize,
          wordWrap: { width: Math.max(20, contentWidth) },
        }).setOrigin(0, 0)
        const noteRowHeight = Math.max(tileHeight, note.height + tilePadding * 2)
        note.setData('rowTop', cursorY)
        note.setData('rowHeight', noteRowHeight)
        container.add(note)
        cursorY += noteRowHeight + tileSpacing
      }
      for (const line of visibleLines) {
        const labelText = this.add.text(0, 0, line, {
          color: '#9db0d9',
          fontSize: this.currentLayout.smallFontSize,
          wordWrap: { width: Math.max(20, contentWidth) },
          maxLines: 2,
        }).setOrigin(0, 0)
        labelText.y = cursorY + tilePadding
        const rowHeight = Math.max(tileHeight, labelText.height + tilePadding * 2)
        labelText.setData('rowTop', cursorY)
        labelText.setData('rowHeight', rowHeight)
        container.add(labelText)
        cursorY += rowHeight + tileSpacing
      }
      const contentHeight = Math.max(0, cursorY - tileSpacing)
      return { container, contentHeight, tileCount: visibleLines.length }
    }

    if (events.length === 0) {
      const empty = this.add.text(0, 0, 'No log entries yet.', {
        color: '#9db0d9',
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: Math.max(40, contentWidth) },
      }).setOrigin(0, 0)
      empty.setData('rowTop', 0)
      empty.setData('rowHeight', empty.height)
      container.add(empty)
      return { container, contentHeight: empty.height, tileCount: 0 }
    }

    let cursorY = 0
    // Cap the number of materialized tiles regardless of `events.length` so a
    // long replay or imported recording doesn't freeze the renderer with
    // thousands of GameObjects. Render the most recent slice and prepend a
    // single notice row indicating how many older entries were omitted.
    const totalEvents = events.length
    const visibleEvents = totalEvents > MAX_RENDERED_LOG_TILES
      ? events.slice(totalEvents - MAX_RENDERED_LOG_TILES)
      : events
    if (totalEvents > MAX_RENDERED_LOG_TILES) {
      const omittedCount = totalEvents - visibleEvents.length
      const note = this.add.text(0, cursorY + tilePadding, `… ${omittedCount} older entries omitted`, {
        color: '#9db0d9',
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: Math.max(20, contentWidth) },
      }).setOrigin(0, 0)
      const noteRowHeight = Math.max(tileHeight, note.height + tilePadding * 2)
      note.setData('rowTop', cursorY)
      note.setData('rowHeight', noteRowHeight)
      container.add(note)
      cursorY += noteRowHeight + tileSpacing
    }
    for (const event of visibleEvents) {
      const tile = formatLogEventTile(event)

      // Layout strategy: create the label first (it's the variable-height
      // element due to word-wrap), measure it, then derive `rowHeight` so
      // pill / icon / label can all be vertically centered against the same
      // axis. This avoids the previous overlap where a wrapped label could
      // extend above the row baseline and clip into the previous tile.
      let contentX = 0
      const hasPill = tile.actor !== null
      if (hasPill) {
        contentX += pillWidth + 6
      }
      contentX += iconSize + 6
      const labelWidth = Math.max(20, contentWidth - contentX)
      const labelText = this.add.text(0, 0, tile.label, {
        color: '#9db0d9',
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: labelWidth },
        maxLines: 2,
      }).setOrigin(0, 0)

      const rowHeight = Math.max(tileHeight, labelText.height + tilePadding * 2)
      const verticalCenter = rowHeight / 2
      const row = this.add.container(0, cursorY)

      if (hasPill && tile.actor !== null) {
        // Active vs non-active palette colors track the actor flagged as
        // currently acting, not a fixed P1/P2 mapping. This matches the
        // player info panels at COLOR_PLAYER_(NON_)ACTIVE_FILL usages.
        const isActive = tile.actor === activeActor
        const fill = isActive ? COLOR_PLAYER_ACTIVE_FILL : COLOR_PLAYER_NON_ACTIVE_FILL
        const pillBg = this.add.rectangle(0, verticalCenter, pillWidth, tileHeight - 2, fill, 0.85)
          .setStrokeStyle(1, COLOR_PANEL_STROKE)
          .setOrigin(0, 0.5)
        const pillText = this.add.text(pillWidth / 2, verticalCenter, `P${tile.actor + 1}`, {
          color: '#e5ecf5',
          fontSize: this.currentLayout.smallFontSize,
        }).setOrigin(0.5, 0.5)
        row.add(pillBg)
        row.add(pillText)
      }

      const iconX = (hasPill ? pillWidth + 6 : 0) + iconSize / 2
      if (tile.cardName !== null && isBasicLand(tile.cardName)) {
        this.addCardArtToContainer(tile.cardName, visualStyle, iconX, verticalCenter, iconSize, row)
      } else {
        const glyph = this.add.text(iconX, verticalCenter, tile.glyph, {
          color: '#9db0d9',
          fontSize: this.currentLayout.smallFontSize,
        }).setOrigin(0.5, 0.5)
        row.add(glyph)
      }

      labelText.x = contentX
      labelText.y = verticalCenter
      labelText.setOrigin(0, 0.5)
      row.add(labelText)

      row.setData('rowTop', cursorY)
      row.setData('rowHeight', rowHeight)
      container.add(row)
      cursorY += rowHeight + tileSpacing
    }
    const contentHeight = Math.max(0, cursorY - tileSpacing)
    return { container, contentHeight, tileCount: visibleEvents.length }
  }

  // Hide any tile row in `tilesColumn` whose world-Y rectangle falls outside
  // the viewport rect [viewportTopY, viewportBottomY]. Used to prevent log
  // tiles from rendering on top of the header strip (☰ Menu / Turn label /
  // Winner banner) or the player-info container below, even on WebGL where
  // GeometryMask is documented to be a no-op (Phaser 4 ships only
  // GeometryMask, which clips only in the Canvas renderer). Rows whose
  // bounding box partially overlaps the viewport stay visible — the
  // geometry mask still clips them correctly in Canvas, and a partial WebGL
  // overshoot is hidden by the Z_HEADER strip painted above the log.
  private cullLogRowsToViewport(
    tilesColumn: Phaser.GameObjects.Container,
    columnWorldOriginY: number,
    viewportTopY: number,
    viewportBottomY: number,
  ): void {
    for (const child of tilesColumn.list) {
      const obj = child as Phaser.GameObjects.GameObject & {
        getData: (key: string) => unknown
        setVisible: (visible: boolean) => unknown
        y?: number
        height?: number
      }
      if (typeof obj.setVisible !== 'function') {
        continue
      }
      const rowTop = (obj.getData('rowTop') as number | undefined) ?? (obj.y ?? 0)
      const rowHeight = (obj.getData('rowHeight') as number | undefined) ?? (obj.height ?? 0)
      const worldTop = columnWorldOriginY + rowTop
      const worldBottom = worldTop + rowHeight
      const visible = worldBottom > viewportTopY && worldTop < viewportBottomY
      obj.setVisible(visible)
    }
  }

  private renderInSceneLog(events: readonly LogEvent[], legacyLog: readonly string[], activeActor: number): void {
    const x = this.currentLayout.logColumnLeft
    const y = this.currentLayout.logColumnTop
    const width = this.currentLayout.logColumnWidth
    const height = this.currentLayout.logColumnHeight
    if (width <= 0 || height <= 0) {
      return
    }

    const panelBg = this.add.rectangle(
      x + width / 2,
      y + height / 2,
      width,
      height,
      COLOR_LOG_PANEL_FILL,
    ).setStrokeStyle(1, COLOR_PANEL_STROKE)
    panelBg.setDepth(Z_LOG)
    this.rootContainer?.add(panelBg)

    const padding = 10
    const headingTop = y + 6
    const heading = this.add.text(x + padding, headingTop, 'Replay Log', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.subtitleFontSize,
    })
    heading.setDepth(Z_LOG)
    this.rootContainer?.add(heading)

    // Hidden screen-reader / accessibility mirror: keep a flat text version of
    // the log so any tooling that scans Phaser text still sees the same
    // information that the DOM renderer's <ul>-based log shows. When the
    // structured stream is empty (legacy back-fill) fall back to the raw log
    // strings so a11y output never goes blank for content that does exist.
    // Apply the same cap as the visual tiles so a large/corrupted recording
    // can't allocate/format thousands of mirror lines and freeze the renderer.
    const a11yLines: string[] = []
    if (events.length > 0) {
      const totalEvents = events.length
      const visibleEvents = totalEvents > MAX_RENDERED_LOG_TILES
        ? events.slice(totalEvents - MAX_RENDERED_LOG_TILES)
        : events
      if (totalEvents > MAX_RENDERED_LOG_TILES) {
        a11yLines.push(`… ${totalEvents - visibleEvents.length} older entries omitted`)
      }
      for (const event of visibleEvents) {
        a11yLines.push(formatLogEventText(event))
      }
    } else if (legacyLog.length > 0) {
      const totalLines = legacyLog.length
      const visibleLines = totalLines > MAX_RENDERED_LOG_TILES
        ? legacyLog.slice(totalLines - MAX_RENDERED_LOG_TILES)
        : legacyLog
      if (totalLines > MAX_RENDERED_LOG_TILES) {
        a11yLines.push(`… ${totalLines - visibleLines.length} older entries omitted`)
      }
      for (const line of visibleLines) {
        a11yLines.push(line)
      }
    } else {
      a11yLines.push('No log entries yet.')
    }
    const a11yMirror = this.add.text(x + padding, headingTop, a11yLines.join('\n'), {
      color: '#000000',
      fontSize: this.currentLayout.smallFontSize,
    }).setVisible(false)
    a11yMirror.setData('log-a11y-mirror', true)
    this.rootContainer?.add(a11yMirror)

    const viewportTop = heading.y + heading.height + 6
    const viewportBottom = y + height - padding
    const viewportHeight = viewportBottom - viewportTop
    const viewportLeft = x + padding
    const viewportWidth = width - padding * 2
    if (viewportHeight <= 0 || viewportWidth <= 0) {
      panelBg.destroy()
      heading.destroy()
      a11yMirror.destroy()
      return
    }

    const viewportBg = this.add.rectangle(
      viewportLeft + viewportWidth / 2,
      viewportTop + viewportHeight / 2,
      viewportWidth,
      viewportHeight,
      COLOR_LOG_VIEWPORT_FILL,
      0.6,
    ).setStrokeStyle(1, COLOR_PANEL_STROKE)
    viewportBg.setInteractive()
    viewportBg.setDepth(Z_LOG)
    this.rootContainer?.add(viewportBg)

    const visualStyle = this.rendererRef.currentView?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    const tileColumnWidth = Math.max(40, viewportWidth - 12)
    const { container: tilesColumn, contentHeight } = this.buildLogTilesContent(events, tileColumnWidth, visualStyle, { activeActor, legacyLog })
    const contentTopY = viewportTop + 6
    const logContent = this.add.container(viewportLeft + 6, contentTopY, [tilesColumn])
    logContent.setDepth(Z_LOG)
    this.rootContainer?.add(logContent)

    // Bitmap masks were dropped in Phaser 4, and GeometryMask is documented to
    // only clip in the Canvas renderer (in WebGL it silently no-ops). We keep
    // the geometry mask for the Canvas backend and additionally cull every
    // tile row whose world Y falls outside the viewport rect, so log content
    // never paints over the header strip / player-info container even on
    // WebGL where the mask is a no-op. See `cullLogRowsToViewport` below.
    const logMask = this.add.graphics()
    logMask.setVisible(false)
    logMask.fillStyle(0xffffff)
    logMask.fillRect(viewportLeft, viewportTop, viewportWidth, viewportHeight)
    logContent.setMask(logMask.createGeometryMask())
    // Track the mask graphic on the content container so it is destroyed
    // when `clearRoot()` removes the content (Phaser only auto-destroys the
    // mask source when it's a child of the masked object's display list).
    logContent.setData('log-mask-graphic', logMask)
    logContent.once(Phaser.GameObjects.Events.DESTROY, () => {
      logMask.destroy()
    })

    const scroll = computeLogScrollLayout({
      contentTopY,
      viewportTopY: viewportTop,
      viewportBottomY: viewportBottom,
      contentHeight,
      bottomPadding: 12,
      requestedOffset: this.inSceneLogScrollOffset,
      pinnedToBottom: this.inSceneLogPinnedToBottom,
    })
    this.inSceneLogScrollOffset = scroll.scrollOffset
    this.inSceneLogPinnedToBottom = scroll.pinnedToBottom
    logContent.y = scroll.contentY
    this.cullLogRowsToViewport(tilesColumn, logContent.y, viewportTop, viewportBottom)

    if (scroll.maxScroll > 0) {
      let scrollOffset = scroll.scrollOffset
      const maxScroll = scroll.maxScroll
      const applyScroll = (deltaY: number): void => {
        scrollOffset = Phaser.Math.Clamp(scrollOffset + deltaY, 0, maxScroll)
        this.inSceneLogScrollOffset = scrollOffset
        this.inSceneLogPinnedToBottom = scrollOffset >= maxScroll
        logContent.y = contentTopY - scrollOffset
        this.cullLogRowsToViewport(tilesColumn, logContent.y, viewportTop, viewportBottom)
      }
      this.bindScrollableViewport(
        viewportBg,
        applyScroll,
      )
      // Scroll affordance: a small unobtrusive hint anchored to the top-right
      // of the viewport that signals older entries are reachable by scrolling.
      // The previous overflow visually misled users into thinking the log
      // was bleeding into the header — making scroll discoverable mitigates
      // that even when the mask is working as intended.
      const scrollHint = this.add.text(
        viewportLeft + viewportWidth - SCROLL_INDICATOR_RIGHT_OFFSET,
        viewportTop + 2,
        '▲ scroll',
        {
          color: '#9db0d9',
          fontSize: this.currentLayout.smallFontSize,
        },
      ).setOrigin(1, 0)
      scrollHint.setDepth(Z_LOG)
      this.rootContainer?.add(scrollHint)
    }
  }

  private renderStaticCard(
    x: number,
    y: number,
    label: string,
    config: {
      onClick?: () => void
      highlight?: boolean
    } = {},
  ): Phaser.GameObjects.Container {
    const visualStyle = this.rendererRef.currentView?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    const style = cardStyleForLand(label, visualStyle)
    const strokeWidth = config.highlight ? 3 : 1
    const strokeColor = config.highlight ? 0xffe680 : style.stroke
    const rect = this.add.rectangle(0, 0, this.currentLayout.cardWidth, this.currentLayout.cardHeight, style.fill).setStrokeStyle(strokeWidth, strokeColor)
    const card = this.add.container(x, y, [rect])
    if (isBasicLand(label)) {
      // Image card art occupies ~60% of the card face. Falls back to the
      // procedural pixel icon if the texture is not in cache (e.g. asset
      // failed to load).
      const artSize = Math.max(
        CARD_FACE_ICON_MIN_SIZE,
        Math.floor(Math.min(
          this.currentLayout.cardWidth * 0.66,
          this.currentLayout.cardHeight * 0.6,
        )),
      )
      this.addCardArtToContainer(label, visualStyle, 0, -8, artSize, card)
    }
    const text = this.add.text(0, 0, label, {
      color: style.text,
      fontSize: this.currentLayout.bodyFontSize,
      align: 'center',
      wordWrap: { width: this.currentLayout.cardWidth - 12 },
    }).setOrigin(0.5, 0)
    text.y = Math.max(8, this.currentLayout.cardHeight * 0.17)
    card.add(text)
    if (config.onClick) {
      card.setSize(this.currentLayout.cardWidth, this.currentLayout.cardHeight)
      card.setInteractive({ useHandCursor: true })
      card.on('pointerup', config.onClick)
    }
    return card
  }

  private renderHandAndControls(game: GameUiState): void {
    const actor = game.actor
    const actorCards = game.players[actor].handCards
    const canDrag = game.canInput && game.phase === 'main' && this.pendingPlayLandTargetSelection === null

    actorCards.forEach((card, index) => {
      const x = this.xForCardInBoardColumn(index, actorCards.length)
      const y = this.currentLayout.handCardsY
      const cardObject = this.renderStaticCard(x, y, card.name)
      cardObject.setData('cardId', card.id)
      cardObject.setData('originX', x)
      cardObject.setData('originY', y)
      if (canDrag && game.legal.playLandByCard[card.id]) {
        cardObject.setSize(this.currentLayout.cardWidth, this.currentLayout.cardHeight)
        cardObject.setInteractive({ draggable: true, useHandCursor: true })
        this.input.setDraggable(cardObject)
      }
      this.rootContainer?.add(cardObject)
    })

    if (game.canInput && game.phase === 'plains_target') {
      if (!this.pendingTargetPicker) {
        const options: Array<{ effectTargetId: string; label: string; action: GameAction }> = game.legal.plainsReuseOptions.map((option, index) => ({
          effectTargetId: option.action.effectTargetId ?? `plains-option-${index}`,
          label: option.label,
          action: option.action,
        }))
        if (options.length === 1) {
          const [onlyOption] = options
          this.showTargetPicker(
            [{ effectTargetId: onlyOption.effectTargetId, label: onlyOption.label }],
            () => onlyOption.action,
            false,
            {
              title: `Confirm target for reused ${game.pendingPlainsReuseName ?? 'land'}`,
              allowCancel: false,
            },
          )
          return
        }
        const mode = resolvePlainsReuseTargetSelectionMode(game)
        if (mode === 'popup_cards' && options.length > 0) {
          const grouped = groupCardTargetOptions(
            game,
            { kind: 'plains_reuse' },
            options.map((option) => ({ effectTargetId: option.effectTargetId, label: option.label })),
          )
          this.showTargetPicker(
            grouped.map((option) => ({
              effectTargetId: option.effectTargetId,
              label: option.label,
              cardName: option.cardName,
            })),
            (effectTargetId) => options.find((option) => option.effectTargetId === effectTargetId)?.action ?? null,
            false,
            {
              title: `Choose target for reused ${game.pendingPlainsReuseName ?? 'land'}`,
              allowCancel: false,
            },
          )
        } else if (mode === 'battlefield_highlight' && options.length > 0) {
          this.setStatus('Choose a highlighted battlefield target.')
        }
      }
      return
    }

    if (game.canInput && game.phase === 'respond') {
      if (!this.pendingTargetPicker) {
        const options: Array<{ effectTargetId: string; label: string; action: GameAction }> = game.legal.counterOptions.map((option, index) => ({
          effectTargetId: `respond-counter-${index}`,
          label: option.label,
          action: option.action,
        }))
        if (game.legal.canPassResponse) {
          options.push({
            effectTargetId: 'respond-pass',
            label: 'Pass',
            action: { type: 'pass_response', actor: game.actor },
          })
        }
        if (options.length > 0) {
          this.showTargetPicker(
            options.map((option) => ({ effectTargetId: option.effectTargetId, label: option.label })),
            (effectTargetId) => options.find((option) => option.effectTargetId === effectTargetId)?.action ?? null,
            false,
            {
              title: 'Choose response',
              allowCancel: false,
            },
          )
        }
      }
      return
    }

    if (game.canInput && game.legal.canEndTurn && game.phase === 'main' && this.battlefieldTargetEntries.length === 0) {
      const endTurnWidth = Math.min(this.currentLayout.actionButtonWidth, Math.max(120, this.currentLayout.boardColumnWidth - 16))
      const endTurnX = this.currentLayout.boardColumnLeft + this.currentLayout.boardColumnWidth - endTurnWidth / 2 - 4
      // Clamp End Turn button height so it never spills below the hand strip
      // on short viewports where activeInfoControlsHeight may be smaller than
      // the desired action button height.
      const endTurnHeight = Math.min(
        this.currentLayout.actionButtonHeight + 4,
        Math.max(20, this.currentLayout.activeInfoControlsHeight),
      )
      this.rootContainer?.add(this.createButton('End Turn', endTurnX, this.currentLayout.controlsStartY, () => {
        this.rendererRef.controller?.submitAction({ type: 'end_turn', actor: game.actor })
      }, endTurnWidth, endTurnHeight))
    }
  }

  closeMenuOverlay(): void {
    const overlay = this.menuOverlay
    this.menuOverlay = null
    this.menuOpen = false
    this.pendingPlayLandTargetSelection = null
    this.battlefieldTargetEntries = []
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
    return this.pendingTargetPicker !== null
  }

  closeTargetPickerOverlay(): void {
    this.pendingTargetPickerA11yEntries = []
    this.pendingPlayLandTargetSelection = null
    this.pendingTargetPicker?.destroy(true)
  }

  getTargetPickerA11yEntries(): Array<{ key: string; label: string; onSelect: () => void }> {
    return this.pendingTargetPickerA11yEntries
  }

  getBattlefieldTargetA11yEntries(): Array<{ key: string; label: string; onSelect: () => void }> {
    const totalByName = new Map<string, number>()
    for (const entry of this.battlefieldTargetEntries) {
      totalByName.set(entry.cardName, (totalByName.get(entry.cardName) ?? 0) + 1)
    }
    const seenByName = new Map<string, number>()
    return this.battlefieldTargetEntries.map((entry) => {
      const seen = (seenByName.get(entry.cardName) ?? 0) + 1
      seenByName.set(entry.cardName, seen)
      const total = totalByName.get(entry.cardName) ?? 1
      return {
        key: `battlefield-target:${entry.owner}:${entry.effectTargetId}`,
        label: total > 1 ? `Target ${entry.cardName} (${seen}/${total})` : `Target ${entry.cardName}`,
        onSelect: entry.onSelect,
      }
    })
  }

  private openMenuOverlay(view: AppViewModel): void {
    if (!this.rootContainer || this.menuOverlay) {
      return
    }
    const game = view.game
    if (!game) {
      return
    }
    const installEntry = installButtonState()

    this.pendingTargetPicker?.destroy(true)
    this.pendingPlayLandTargetSelection = null
    this.battlefieldTargetEntries = []
    this.menuOpen = true
    this.statusText?.setVisible(false)

    const overlay = this.add.container(this.currentLayout.width / 2, this.currentLayout.height / 2)
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.statusText?.setVisible(true)
      if (this.menuOverlay === overlay) {
        this.menuOverlay = null
        this.menuOpen = false
        this.lastMenuSignature = null
      }
      this.rendererRef.refreshA11yNavForCurrentView()
    })
    const swallowPointerEvent = (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ): void => {
      event.stopPropagation()
    }

    const popupWidth = this.currentLayout.menuPopupWidth
    const popupHeight = this.currentLayout.menuPopupHeight
    const popupPadding = this.currentLayout.menuPopupPadding
    const sectionGap = this.currentLayout.menuSectionGap
    const panelLeft = (this.currentLayout.width - popupWidth) / 2
    const panelRight = panelLeft + popupWidth
    const panelTop = (this.currentLayout.height - popupHeight) / 2
    const panelBottom = panelTop + popupHeight
    const scrim = this.add.rectangle(
      0,
      0,
      this.currentLayout.width,
      this.currentLayout.height,
      UI_THEME.scrimFill,
      this.currentLayout.popupScrimAlpha,
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
        this.closeMenuOverlay()
      }
    })
    scrim.on('pointermove', swallowPointerEvent)
    overlay.add(scrim)

    const panel = this.add.rectangle(
      0,
      0,
      popupWidth,
      popupHeight,
      UI_THEME.panelFill,
      this.currentLayout.popupPanelAlpha,
    ).setStrokeStyle(2, UI_THEME.panelStroke)
    panel.setInteractive()
    panel.on('pointerdown', swallowPointerEvent)
    panel.on('pointerup', swallowPointerEvent)
    panel.on('pointermove', swallowPointerEvent)
    overlay.add(panel)

    overlay.add(this.add.text(0, -popupHeight / 2 + popupPadding + this.currentLayout.menuTitleHeight / 2, 'Menu', {
      color: UI_THEME.primaryText,
      fontSize: this.currentLayout.popupTitleFontSize,
    }).setOrigin(0.5))

    const fullButtonWidth = Math.max(1, popupWidth - popupPadding * 2)
    const halfButtonGap = this.currentLayout.popupButtonGap
    const halfButtonWidth = Math.max(1, (fullButtonWidth - halfButtonGap) / 2)
    const contentViewportTop = -popupHeight / 2 + popupPadding + this.currentLayout.menuTitleHeight + sectionGap
    const contentViewportBottom = popupHeight / 2 - popupPadding
    const contentViewportHeight = Math.max(1, contentViewportBottom - contentViewportTop)
    const contentViewportBackground = this.add.rectangle(
      0,
      contentViewportTop + contentViewportHeight / 2,
      fullButtonWidth,
      contentViewportHeight,
      UI_THEME.backdropFill,
      0,
    )
    contentViewportBackground.setInteractive()
    overlay.add(contentViewportBackground)
    const contentViewport = this.add.container(0, contentViewportTop)
    const content = this.add.container(0, 0)
    contentViewport.add(content)
    overlay.add(contentViewport)

    const contentMask = this.add.graphics()
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

    const adventureMode = this.rendererRef.currentView?.mode === 'adventure-hvai'
    // Section 1: Lobby/rematch or adventure controls.
    const section1Y = cursorY + this.currentLayout.popupButtonHeight / 2
    content.add(this.createButton(adventureMode ? 'Pause Adventure' : 'Back to Lobby', -halfButtonWidth / 2 - halfButtonGap / 2, section1Y, () => {
      this.closeMenuOverlay()
      if (adventureMode) {
        this.rendererRef.controller?.pauseAdventure()
        return
      }
      this.rendererRef.controller?.backToLobby()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
    content.add(this.createButton(adventureMode ? 'Reset Adventure' : 'Rematch', halfButtonWidth / 2 + halfButtonGap / 2, section1Y, () => {
      this.closeMenuOverlay()
      if (adventureMode) {
        this.rendererRef.controller?.abandonAdventure()
        return
      }
      this.rendererRef.controller?.rematch()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
    cursorY += this.currentLayout.popupButtonHeight + sectionGap

    // Section 2: Install.
    const installY = cursorY + this.currentLayout.popupButtonHeight / 2
    const installButton = this.createButton(
      installEntry.label,
      0,
      installY,
      installEntry.disabled
        ? () => {}
        : () => {
            this.closeMenuOverlay()
            installEntry.onClick()
          },
      fullButtonWidth,
      this.currentLayout.popupButtonHeight,
      this.currentLayout.popupButtonFontSize,
    )
    if (installEntry.disabled) {
      installButton.setAlpha(0.4)
      installButton.disableInteractive()
    }
    content.add(installButton)
    cursorY += this.currentLayout.popupButtonHeight + sectionGap

    // Section 4: Recorder.
    const recorderHeading = this.add.text(-fullButtonWidth / 2, cursorY, `Recorder — ${recordingMetadataText(view)}`, {
      color: UI_THEME.secondaryText,
      fontSize: this.currentLayout.smallFontSize,
      wordWrap: { width: fullButtonWidth },
    }).setOrigin(0, 0)
    content.add(recorderHeading)
    // Use the rendered text height (which reflects wrapping at narrow widths)
    // instead of a fixed 18px so the next row never overlaps a wrapped heading.
    cursorY += Math.max(18, recorderHeading.height) + 4

    const recorderRow1Y = cursorY + this.currentLayout.popupButtonHeight / 2
    content.add(this.createButton('Download Save', -halfButtonWidth / 2 - halfButtonGap / 2, recorderRow1Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.handleDownloadRecording()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
    content.add(this.createButton('Save to Browser', halfButtonWidth / 2 + halfButtonGap / 2, recorderRow1Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.controller?.saveRecordingToLocalStorage()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
    cursorY += this.currentLayout.popupButtonHeight + halfButtonGap

    const recorderRow2Y = cursorY + this.currentLayout.popupButtonHeight / 2
    content.add(this.createButton('Load from Browser', -halfButtonWidth / 2 - halfButtonGap / 2, recorderRow2Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.controller?.loadRecordingFromLocalStorage()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
    content.add(this.createButton('Load from File', halfButtonWidth / 2 + halfButtonGap / 2, recorderRow2Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.openRecordingFilePicker()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
    cursorY += this.currentLayout.popupButtonHeight + halfButtonGap

    if (!view.replay.active) {
      const startReplayY = cursorY + this.currentLayout.popupButtonHeight / 2
      content.add(this.createButton('Start Replay', 0, startReplayY, () => {
        this.closeMenuOverlay()
        this.rendererRef.controller?.startReplay()
      }, fullButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
      cursorY += this.currentLayout.popupButtonHeight + sectionGap
    } else {
      cursorY += sectionGap
    }

    // Section 5: Replay controls (only when replay is active).
    if (view.replay.active) {
      const replayHeading = this.add.text(-fullButtonWidth / 2, cursorY, `Replay Controls — Step ${view.replay.step}/${view.replay.totalSteps} • ${view.replay.isPlaying ? 'Playing' : 'Paused'}`, {
        color: UI_THEME.secondaryText,
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: fullButtonWidth },
      }).setOrigin(0, 0)
      content.add(replayHeading)
      cursorY += Math.max(18, replayHeading.height) + 4

      const replayRow1Y = cursorY + this.currentLayout.popupButtonHeight / 2
      const replayButtonWidth = Math.max(1, (fullButtonWidth - halfButtonGap * 2) / 3)
      content.add(this.createButton(view.replay.isPlaying ? 'Pause' : 'Play', -replayButtonWidth - halfButtonGap, replayRow1Y, () => {
        if (view.replay.isPlaying) {
          this.rendererRef.controller?.pauseReplay()
        } else {
          this.rendererRef.controller?.startReplay()
        }
      }, replayButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
      content.add(this.createButton('Previous', 0, replayRow1Y, () => {
        this.rendererRef.controller?.stepReplay(-1)
      }, replayButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
      content.add(this.createButton('Next', replayButtonWidth + halfButtonGap, replayRow1Y, () => {
        this.rendererRef.controller?.stepReplay(1)
      }, replayButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
      cursorY += this.currentLayout.popupButtonHeight + halfButtonGap

      const replayRow2Y = cursorY + this.currentLayout.popupButtonHeight / 2
      content.add(this.createButton('Jump to End', -halfButtonWidth / 2 - halfButtonGap / 2, replayRow2Y, () => {
        this.rendererRef.controller?.jumpReplayToEnd()
      }, halfButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
      content.add(this.createButton('Exit Replay', halfButtonWidth / 2 + halfButtonGap / 2, replayRow2Y, () => {
        this.closeMenuOverlay()
        this.rendererRef.controller?.exitReplay()
      }, halfButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
      cursorY += this.currentLayout.popupButtonHeight + sectionGap
    }

    // Close button.
    const closeButtonY = cursorY + this.currentLayout.popupButtonHeight / 2
    const closeButtonWidth = this.popupActionWidth(
      fullButtonWidth,
      POPUP_CLOSE_BUTTON_WIDTH_RATIO,
      POPUP_CLOSE_BUTTON_MIN_WIDTH,
    )
    content.add(this.createButton('Close', 0, closeButtonY, () => {
      this.closeMenuOverlay()
    }, closeButtonWidth, this.currentLayout.popupButtonHeight, this.currentLayout.popupButtonFontSize))
    const buttonStackBottomY = closeButtonY + this.currentLayout.popupButtonHeight / 2

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
        content.add(this.add.text(-fullButtonWidth / 2, logTitleY, 'Replay Log', {
          color: UI_THEME.primaryText,
          fontSize: this.currentLayout.bodyFontSize,
        }).setOrigin(0, 0.5))
      }

      const logViewportHeight = Math.min(this.currentLayout.menuLogViewportHeight, maxViewportHeight)
      const logViewportY = logViewportTop + logViewportHeight / 2
      const logViewportBackground = this.add.rectangle(
        0,
        logViewportY,
        logViewportWidth,
        logViewportHeight,
        UI_THEME.viewportFill,
        this.currentLayout.popupViewportAlpha,
      ).setStrokeStyle(1, UI_THEME.buttonStroke)
      content.add(logViewportBackground)
      innerLogViewportBackground = logViewportBackground

      const logContent = this.add.container(-logViewportWidth / 2 + LOG_VIEWPORT_HORIZONTAL_PADDING, logViewportTop + 8)
      content.add(logContent)
      const events = game.events
      const visualStyle = this.rendererRef.currentView?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
      const tileColumnWidth = Math.max(40, logViewportWidth - LOG_VIEWPORT_HORIZONTAL_PADDING * 2)
      const { container: tilesColumn, contentHeight: logContentHeight } = this.buildLogTilesContent(
        events,
        tileColumnWidth,
        visualStyle,
        { activeActor: game.actor, legacyLog: game.log },
      )
      logContent.add(tilesColumn)

      const logMask = this.add.graphics()
      logMask.fillStyle(0xffffff)
      logMask.fillRect(-logViewportWidth / 2, logViewportTop, logViewportWidth, logViewportHeight)
      logMask.setVisible(false)
      content.add(logMask)
      logContent.setMask(logMask.createGeometryMask())

      const maxScroll = Math.max(0, logContentHeight + 16 - logViewportHeight)
      const logViewportBottom = logViewportTop + logViewportHeight
      // Preserve "stick to bottom" intent across rebuilds: if the user was previously
      // pinned to the newest entry, snap to the new max so fresh log lines remain visible
      // when AI/replay ticks rebuild the menu while it stays open.
      let scrollOffset: number
      if (this.menuLogScrollOffset === null || this.menuLogPinnedToBottom) {
        scrollOffset = maxScroll
      } else {
        scrollOffset = Phaser.Math.Clamp(this.menuLogScrollOffset, 0, maxScroll)
      }
      this.menuLogScrollOffset = scrollOffset
      this.menuLogPinnedToBottom = scrollOffset >= maxScroll
      logContent.y = logViewportTop + 8 - scrollOffset
      this.cullLogRowsToViewport(tilesColumn, logContent.y, logViewportTop, logViewportBottom)
      const applyScroll = (deltaY: number): void => {
        if (maxScroll <= 0) {
          return
        }
        scrollOffset = Phaser.Math.Clamp(scrollOffset + deltaY, 0, maxScroll)
        this.menuLogScrollOffset = scrollOffset
        this.menuLogPinnedToBottom = scrollOffset >= maxScroll
        logContent.y = logViewportTop + 8 - scrollOffset
        this.cullLogRowsToViewport(tilesColumn, logContent.y, logViewportTop, logViewportBottom)
      }

      if (maxScroll > 0) {
        isInnerLogViewportScrollable = true
        logViewportBackground.setInteractive()
        logViewportBackground.on('pointerdown', swallowPointerEvent)
        logViewportBackground.on('pointerup', swallowPointerEvent)
        logViewportBackground.on('pointermove', swallowPointerEvent)
        deferredMenuLogScrollSetup = () => {
          this.bindScrollableViewport(
            logViewportBackground,
            applyScroll,
          )
          content.add(this.add.text(logViewportWidth / 2 - SCROLL_INDICATOR_RIGHT_OFFSET, logViewportTop + logViewportHeight / 2, 'Scroll or drag', {
            color: UI_THEME.secondaryText,
            fontSize: this.currentLayout.smallFontSize,
          }).setOrigin(1, 0.5))
        }
      }
      contentBottomY = Math.max(contentBottomY, logViewportTop + logViewportHeight)
    }

    const contentMaxScroll = Math.max(0, contentBottomY - contentViewportHeight)
    if (contentMaxScroll > 0) {
      let contentScrollOffset = Phaser.Math.Clamp(this.menuContentScrollOffset ?? 0, 0, contentMaxScroll)
      content.y = -contentScrollOffset
      const applyContentScroll = (deltaY: number): void => {
        contentScrollOffset = Phaser.Math.Clamp(contentScrollOffset + deltaY, 0, contentMaxScroll)
        this.menuContentScrollOffset = contentScrollOffset
        content.y = -contentScrollOffset
      }
      const shouldHandleOuterContentScroll = (pointer: Phaser.Input.Pointer): boolean => {
        if (!innerLogViewportBackground || !isInnerLogViewportScrollable) {
          return true
        }
        const logBounds = innerLogViewportBackground.getBounds()
        return !Phaser.Geom.Rectangle.Contains(logBounds, pointer.worldX, pointer.worldY)
      }
      this.bindScrollableViewport(
        contentViewportBackground,
        applyContentScroll,
        shouldHandleOuterContentScroll,
        shouldHandleOuterContentScroll,
      )
    } else {
      this.menuContentScrollOffset = null
    }

    // Always bind the replay-log viewport as well so it remains scrollable
    // when the outer menu content also needs scrolling on shorter layouts.
    deferredMenuLogScrollSetup?.()

    this.menuOverlay = overlay
    this.rootContainer.add(overlay)
    this.lastMenuSignature = this.computeMenuSignature(view)
    this.rendererRef.refreshA11yNavForCurrentView()
  }

  private showTargetPicker(
    options: Array<{ effectTargetId?: string; label: string; cardName?: string }>,
    resolver: (effectTargetId?: string) => GameAction | null,
    showAllTargets = false,
    config: TargetPickerConfig = {},
  ): void {
    if (this.menuOpen) {
      return
    }
    this.pendingTargetPicker?.destroy(true)

    const optionCount = showAllTargets ? options.length : Math.min(DEFAULT_TARGET_OPTIONS, options.length)
    const hasHiddenOptions = options.length > DEFAULT_TARGET_OPTIONS
    const allowCancel = config.allowCancel ?? true
    const popupPadding = this.currentLayout.menuPopupPadding
    const popupWidth = Math.max(0, this.currentLayout.popupMaxWidth)
    const buttonWidth = Math.max(0, popupWidth - popupPadding * 2)
    const titleHeight = this.currentLayout.menuTitleHeight
    const sectionGap = this.currentLayout.menuSectionGap
    const optionGap = this.currentLayout.popupButtonGap
    const cancelHeight = this.currentLayout.popupButtonHeight
    const showAllButtonHeight = hasHiddenOptions ? cancelHeight : 0
    const footerGap = hasHiddenOptions && allowCancel ? this.currentLayout.popupButtonGap : 0
    const footerHeight = (allowCancel ? cancelHeight : 0) + footerGap + showAllButtonHeight
    const optionsHeightWanted = optionCount > 0
      ? optionCount * this.currentLayout.popupButtonHeight + Math.max(0, optionCount - 1) * optionGap
      : this.currentLayout.popupButtonHeight
    const desiredHeight = titleHeight + optionsHeightWanted + footerHeight + popupPadding * 2 + sectionGap * 2
    const maxHeight = this.currentLayout.height - this.currentLayout.margin * 2
    const popupHeight = Math.min(desiredHeight, maxHeight)

    const overlay = this.add.container(this.currentLayout.width / 2, this.currentLayout.height / 2)
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.pendingTargetPicker === overlay) {
        this.pendingTargetPicker = null
      }
      this.pendingTargetPickerA11yEntries = []
      this.rendererRef.refreshA11yNavForCurrentView()
    })
    const swallowPointerEvent = (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ): void => {
      event.stopPropagation()
    }

    const backdrop = this.add.rectangle(
      0,
      0,
      popupWidth,
      popupHeight,
      UI_THEME.backdropFill,
      this.currentLayout.popupBackdropAlpha,
    ).setStrokeStyle(2, UI_THEME.panelStroke)
    backdrop.setInteractive()
    backdrop.on('pointerdown', swallowPointerEvent)
    backdrop.on('pointerup', swallowPointerEvent)
    backdrop.on('pointermove', swallowPointerEvent)
    overlay.add(backdrop)
    overlay.add(this.add.text(0, -popupHeight / 2 + popupPadding + titleHeight / 2, config.title ?? 'Choose target', {
      color: UI_THEME.primaryText,
      fontSize: this.currentLayout.popupTitleFontSize,
    }).setOrigin(0.5))

    const optionsTopY = -popupHeight / 2 + popupPadding + titleHeight
    const footerTopY = popupHeight / 2 - popupPadding - footerHeight
    const optionsAreaHeight = Math.max(48, footerTopY - optionsTopY - sectionGap)
    const optionsViewportY = optionsTopY + optionsAreaHeight / 2

    const optionsViewportBackground = this.add.rectangle(
      0,
      optionsViewportY,
      buttonWidth,
      optionsAreaHeight,
      UI_THEME.panelFill,
      this.currentLayout.popupViewportAlpha,
    ).setStrokeStyle(1, UI_THEME.buttonStroke)
    optionsViewportBackground.setInteractive()
    optionsViewportBackground.on('pointerdown', swallowPointerEvent)
    optionsViewportBackground.on('pointerup', swallowPointerEvent)
    optionsViewportBackground.on('pointermove', swallowPointerEvent)
    overlay.add(optionsViewportBackground)

    const optionsViewport = this.add.container(0, optionsTopY)
    const optionsList = this.add.container(0, 0)
    optionsViewport.add(optionsList)
    overlay.add(optionsViewport)

    const maskShape = this.add.graphics()
    maskShape.fillStyle(0xffffff)
    maskShape.fillRect(-buttonWidth / 2, optionsTopY, buttonWidth, optionsAreaHeight)
    maskShape.setVisible(false)
    overlay.add(maskShape)
    optionsViewport.setMask(maskShape.createGeometryMask())

    options.slice(0, optionCount).forEach((option, index) => {
      const selectOption = (): void => {
        const action = resolver(option.effectTargetId)
        if (action) {
          this.rendererRef.controller?.submitAction(action)
        }
        overlay.destroy(true)
      }
      const buttonY = this.currentLayout.popupButtonHeight / 2 + index * (this.currentLayout.popupButtonHeight + optionGap)
      const button = option.cardName
        ? this.createCardChoiceButton(
          option.label,
          option.cardName,
          0,
          buttonY,
          selectOption,
          buttonWidth,
          this.currentLayout.popupButtonHeight,
          this.currentLayout.popupButtonFontSize,
        )
        : this.createButton(
          option.label,
          0,
          buttonY,
          selectOption,
          buttonWidth,
          this.currentLayout.popupButtonHeight,
          this.currentLayout.popupButtonFontSize,
        )
      optionsList.add(button)
      this.pendingTargetPickerA11yEntries.push({
        key: `target:${option.effectTargetId ?? `fallback-index-${index}`}`,
        label: option.label,
        onSelect: selectOption,
      })
    })

    const optionsContentHeight = optionCount > 0
      ? optionCount * this.currentLayout.popupButtonHeight + Math.max(0, optionCount - 1) * optionGap
      : 0
    const maxScroll = Math.max(0, optionsContentHeight - optionsAreaHeight)
    let scrollOffset = 0

    const applyScroll = (deltaY: number): void => {
      if (maxScroll <= 0) {
        return
      }
      scrollOffset = Phaser.Math.Clamp(scrollOffset + deltaY, 0, maxScroll)
      optionsList.y = -scrollOffset
    }

    if (maxScroll > 0) {
      this.bindScrollableViewport(
        optionsViewportBackground,
        applyScroll,
      )

      overlay.add(
        this.add.text(
          buttonWidth / 2 - SCROLL_INDICATOR_RIGHT_OFFSET,
          optionsTopY + optionsAreaHeight / 2,
          'Scroll or drag',
          {
            color: UI_THEME.secondaryText,
            fontSize: this.currentLayout.smallFontSize,
          },
        ).setOrigin(1, 0.5),
      )
    }

    const cancelY = footerTopY + cancelHeight / 2
    if (allowCancel) {
      const cancelWidth = this.popupActionWidth(
        buttonWidth,
        POPUP_CANCEL_BUTTON_WIDTH_RATIO,
        POPUP_CANCEL_BUTTON_MIN_WIDTH,
      )
      const cancelButton = this.createButton('Cancel', 0, cancelY, () => {
        config.onCancel?.()
        overlay.destroy(true)
      }, cancelWidth, cancelHeight, this.currentLayout.popupButtonFontSize)
      overlay.add(cancelButton)
    }

    if (hasHiddenOptions) {
      const showAllY = allowCancel
        ? cancelY + cancelHeight / 2 + this.currentLayout.popupButtonGap + showAllButtonHeight / 2
        : footerTopY + showAllButtonHeight / 2
      const showAllLabel = showAllTargets ? `Show first ${DEFAULT_TARGET_OPTIONS}` : `Show all (${options.length})`
      const toggleShowAll = (): void => {
        overlay.destroy(true)
        this.showTargetPicker(options, resolver, !showAllTargets, config)
      }
      const toggleWidth = this.popupActionWidth(
        buttonWidth,
        POPUP_TOGGLE_BUTTON_WIDTH_RATIO,
        POPUP_TOGGLE_BUTTON_MIN_WIDTH,
      )
      const showAllButton = this.createButton(
        showAllLabel,
        0,
        showAllY,
        toggleShowAll,
        toggleWidth,
        showAllButtonHeight,
        this.currentLayout.popupButtonFontSize,
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
    this.rootContainer?.add(overlay)
    this.rendererRef.refreshA11yNavForCurrentView()
  }
}

export class PhaserRenderer implements AppRenderer {
  private container: HTMLElement | null = null
  controller: ControllerApi | null = null
  private game: Phaser.Game | null = null
  private cardgameScene: CardgameScene | null = null
  private lobbyScene: LobbyScene | null = null
  private activeSceneKey: string | null = null
  private fileInput: HTMLInputElement | null = null
  private lobbyP2POverlay: HTMLDivElement | null = null
  private a11yNavOverlay: HTMLElement | null = null
  private a11yNavKeySignature: string | null = null
  private hostAnswerDraft = ''
  private joinOfferDraft = ''
  currentView: AppViewModel | null = null

  mount(container: HTMLElement, controller: ControllerApi): void {
    this.container = container
    this.controller = controller
    container.classList.add('phaser-root')

    const canvasHost = document.createElement('div')
    canvasHost.className = 'phaser-host'
    container.innerHTML = ''
    container.appendChild(canvasHost)

    // Hidden file input for "Load from File" recorder action. Phaser lobby and
    // menu entry points both trigger it via openRecordingFilePicker().
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'application/json,.json'
    fileInput.hidden = true
    fileInput.style.display = 'none'
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0]
      if (!file) {
        return
      }
      try {
        const text = await file.text()
        this.controller?.importRecordingJson(text)
      } catch {
        this.controller?.reportStatus('Failed to read recording file.')
      }
      fileInput.value = ''
    }
    container.appendChild(fileInput)
    this.fileInput = fileInput

    // Lobby-only HTML overlay for P2P manual signaling. Phaser scenes cannot
    // host native <textarea> elements for paste/copy of the offer/answer
    // payloads, so we render this section as plain HTML siblings of the canvas
    // and only show it while the lobby is active and a P2P mode is selected.
    // This mirrors the recommendation in the plan ("keep P2P signaling in
    // Lobby only") without resurrecting the persistent recorder/p2p overlays
    // that issue #11 asked to hide under the Menu.
    const lobbyP2POverlay = document.createElement('div')
    lobbyP2POverlay.className = 'phaser-lobby-p2p-overlay'
    lobbyP2POverlay.hidden = true
    container.appendChild(lobbyP2POverlay)
    this.lobbyP2POverlay = lobbyP2POverlay

    // Hidden, visually-offscreen accessibility navigation. The Phaser canvas
    // exposes its controls only through `pointerup`, which is unreachable for
    // keyboard and screen-reader users. We render an equivalent <nav> of
    // native <button> elements whose contents are kept in sync with the view
    // model so assistive tech has full coverage of every Phaser control that
    // used to be a native HTML button (Recorder, Replay, Rematch, Back to
    // Lobby, mode buttons, etc.).
    const a11yNav = document.createElement('nav')
    a11yNav.className = 'phaser-a11y-nav'
    a11yNav.setAttribute('aria-label', 'Cardgame controls')
    container.appendChild(a11yNav)
    this.a11yNavOverlay = a11yNav

    this.lobbyScene = new LobbyScene(this)
    this.cardgameScene = new CardgameScene(this)
    this.activeSceneKey = LOBBY_SCENE_KEY
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      width: canvasHost.clientWidth > 0 ? canvasHost.clientWidth : BASE_WIDTH,
      height: canvasHost.clientHeight > 0 ? canvasHost.clientHeight : BASE_HEIGHT,
      parent: canvasHost,
      backgroundColor: '#0b1020',
      transparent: false,
      scene: [this.lobbyScene, this.cardgameScene],
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      input: {
        activePointers: 3,
      },
    })
  }

  render(view: AppViewModel): void {
    this.currentView = view
    // For P2P modes, controller.startGame() creates state.game immediately so
    // both peers can prepare their boards, but the seed is only synchronized
    // once the host clicks Start Game (which sends the `start` packet) or the
    // joiner receives it. Until that handshake completes, stay in the lobby
    // so the user can run the offer/answer signaling flow; afterwards switch
    // to the match scene like a local game would.
    const isP2PMode = view.mode === 'p2p-host' || view.mode === 'p2p-join'
    const p2pReady = !isP2PMode || view.p2pStarted
    const targetSceneKey = view.game && p2pReady
      ? CARDGAME_SCENE_KEY
      : LOBBY_SCENE_KEY

    this.updateLobbyP2POverlay(view, targetSceneKey === LOBBY_SCENE_KEY)
    this.updateA11yNav(view, targetSceneKey === LOBBY_SCENE_KEY)

    if (this.activeSceneKey !== targetSceneKey && this.game) {
      const sceneManager = this.game.scene
      const previousKey = this.activeSceneKey
      this.activeSceneKey = targetSceneKey
      // Stop the previous scene before starting the next one. The new scene's
      // create() reads currentView from this renderer to render initial state.
      if (previousKey && sceneManager.getScene(previousKey)) {
        sceneManager.stop(previousKey)
      }
      sceneManager.start(targetSceneKey)
      return
    }

    if (targetSceneKey === CARDGAME_SCENE_KEY) {
      this.cardgameScene?.renderView(view)
    } else {
      this.lobbyScene?.renderView(view)
    }
  }

  refreshA11yNavForCurrentView(): void {
    if (!this.currentView) {
      return
    }
    this.updateA11yNav(this.currentView, this.activeSceneKey === LOBBY_SCENE_KEY)
  }

  private updateLobbyP2POverlay(view: AppViewModel, lobbyActive: boolean): void {
    const overlay = this.lobbyP2POverlay
    if (!overlay) {
      return
    }
    const isP2PMode = view.mode === 'p2p-host' || view.mode === 'p2p-join'
    const shouldShow = lobbyActive && isP2PMode && !view.replay.active
    if (!shouldShow) {
      overlay.hidden = true
      overlay.innerHTML = ''
      this.hostAnswerDraft = ''
      this.joinOfferDraft = ''
      return
    }
    overlay.hidden = false
    const host = view.mode === 'p2p-host'
    const safeStatus = escapeHtml(view.status)
    const safeOffer = escapeHtml(view.offer)
    const safeAnswer = escapeHtml(view.answer)
    const safeHostAnswerDraft = escapeHtml(this.hostAnswerDraft)
    const safeJoinOfferDraft = escapeHtml(this.joinOfferDraft)
    overlay.innerHTML = `
      <section class="phaser-lobby-p2p-panel">
        <h2>P2P Manual Signaling</h2>
        <p>${host ? 'Host: create offer, share it, then paste answer.' : 'Join: paste host offer, create answer, and share answer.'}</p>
        <div class="phaser-lobby-p2p-grid">
          ${host
            ? `<button data-p2p-action="create-offer">Create Offer</button>
               <label for="phaser-p2p-offer">Offer</label>
               <textarea id="phaser-p2p-offer" data-p2p-field="offer" aria-label="Offer" placeholder="Offer" readonly>${safeOffer}</textarea>
               <label for="phaser-p2p-host-answer">Remote Answer</label>
               <textarea id="phaser-p2p-host-answer" data-p2p-field="host-answer" aria-label="Paste remote answer" placeholder="Paste remote answer">${safeHostAnswerDraft}</textarea>
               <button data-p2p-action="accept-answer">Accept Answer</button>
               <button data-p2p-action="start-p2p-game">Start Game</button>`
            : `<label for="phaser-p2p-join-offer">Host Offer</label>
               <textarea id="phaser-p2p-join-offer" data-p2p-field="join-offer" aria-label="Paste host offer" placeholder="Paste host offer">${safeJoinOfferDraft}</textarea>
                <button data-p2p-action="create-answer">Create Answer</button>
                <label for="phaser-p2p-answer">Answer</label>
                <textarea id="phaser-p2p-answer" data-p2p-field="answer" aria-label="Answer" placeholder="Answer" readonly>${safeAnswer}</textarea>`
          }
          <button data-p2p-action="back-to-lobby">Cancel</button>
        </div>
        <p class="phaser-lobby-p2p-status">${safeStatus}</p>
      </section>
    `

    overlay.querySelector<HTMLTextAreaElement>('[data-p2p-field="host-answer"]')?.addEventListener('input', (event) => {
      this.hostAnswerDraft = (event.target as HTMLTextAreaElement).value
    })
    overlay.querySelector<HTMLTextAreaElement>('[data-p2p-field="join-offer"]')?.addEventListener('input', (event) => {
      this.joinOfferDraft = (event.target as HTMLTextAreaElement).value
    })
    overlay.querySelector<HTMLButtonElement>('[data-p2p-action="create-offer"]')?.addEventListener('click', () => {
      void this.controller?.createOffer()
    })
    overlay.querySelector<HTMLButtonElement>('[data-p2p-action="accept-answer"]')?.addEventListener('click', () => {
      void this.controller?.acceptAnswer(this.hostAnswerDraft)
    })
    overlay.querySelector<HTMLButtonElement>('[data-p2p-action="create-answer"]')?.addEventListener('click', () => {
      void this.controller?.createAnswer(this.joinOfferDraft)
    })
    overlay.querySelector<HTMLButtonElement>('[data-p2p-action="start-p2p-game"]')?.addEventListener('click', () => {
      this.controller?.startP2PGame()
    })
    overlay.querySelector<HTMLButtonElement>('[data-p2p-action="back-to-lobby"]')?.addEventListener('click', () => {
      this.hostAnswerDraft = ''
      this.joinOfferDraft = ''
      this.controller?.backToLobby()
    })
  }

  private updateA11yNav(view: AppViewModel, lobbyActive: boolean): void {
    const nav = this.a11yNavOverlay
    if (!nav) {
      return
    }
    const controller = this.controller
    if (!controller) {
      nav.innerHTML = ''
      this.a11yNavKeySignature = null
      return
    }

    type NavEntry = { key: string; label: string; onClick: () => void; disabled?: boolean }
    const entries: NavEntry[] = []
    const targetPickerOpen = !lobbyActive && (this.cardgameScene?.isTargetPickerOpen() ?? false)

    if (lobbyActive) {
      const modes: Array<{ mode: Mode; label: string }> = [
        { mode: 'local-hvh', label: 'Local Human vs Human' },
        { mode: 'local-hvai', label: 'Local Human vs AI' },
        { mode: 'local-aivai', label: 'Local AI vs AI' },
        { mode: 'adventure-hvai', label: 'Adventure (Human vs AI)' },
        { mode: 'p2p-host', label: 'P2P Host' },
        { mode: 'p2p-join', label: 'P2P Join' },
      ]
      const lobbyScene = this.lobbyScene
      const submenu = lobbyScene?.getActiveSubmenu() ?? 'root'
      const aiOptionsOpen = lobbyScene?.isAiLevelOptionsOpen() ?? false
      const selectedAiLevelLabel = AI_LEVEL_OPTIONS.find((option) => option.value === view.aiLevel)?.label ?? 'Basic'
      const canResumeAdventure = view.adventure.hasSavedRun && (view.adventure.status === 'paused' || view.adventure.status === 'active')
      if (submenu === 'root') {
        for (const entry of modes) {
          entries.push({ key: `start:${entry.mode}`, label: `Start ${entry.label}`, onClick: () => controller.startGame(entry.mode) })
        }
        entries.push({
          key: 'lobby-open-settings',
          label: 'Open Settings',
          onClick: () => lobbyScene?.showSettingsMenu(),
        })
        entries.push({
          key: 'lobby-open-recording',
          label: 'Open Recording',
          onClick: () => lobbyScene?.showRecordingMenu(),
        })
        if (canResumeAdventure) {
          entries.push({
            key: 'resume-adventure',
            label: 'Resume Adventure',
            onClick: () => controller.resumeAdventure(),
          })
        }
        if (view.adventure.hasSavedRun) {
          entries.push({
            key: 'reset-adventure',
            label: 'Reset Adventure Run',
            onClick: () => controller.abandonAdventure(),
          })
        }
        const installEntry = installButtonState()
        entries.push({
          key: 'lobby-install',
          label: installEntry.label,
          onClick: installEntry.onClick,
          disabled: installEntry.disabled,
        })
        entries.push({
          key: 'switch-renderer',
          label: 'Switch to DOM renderer',
          onClick: () => { window.location.search = '?renderer=dom' },
        })
      } else if (submenu === 'settings') {
        entries.push({
          key: 'settings-back',
          label: 'Back to Lobby',
          onClick: () => lobbyScene?.showRootMenu(),
        })
        entries.push({
          key: 'settings-ai-toggle',
          label: `${aiOptionsOpen ? 'Collapse' : 'Expand'} AI Difficulty Selector (current: ${selectedAiLevelLabel})`,
          onClick: () => lobbyScene?.toggleAiLevelOptions(),
        })
        if (aiOptionsOpen) {
          for (const option of AI_LEVEL_OPTIONS) {
            const selected = view.aiLevel === option.value ? ' (selected)' : ''
            entries.push({
              key: `settings-ai-level:${option.value}`,
              label: `Set AI level: ${option.label}${selected}`,
              onClick: () => {
                controller.setAiLevel(option.value)
                lobbyScene?.closeAiLevelOptions()
              },
            })
          }
        }
        for (const option of CARD_VISUAL_STYLE_OPTIONS) {
          const selected = view.cardVisualStyle === option.value ? ' (selected)' : ''
          entries.push({
            key: `settings-card-visual-style:${option.value}`,
            label: `Set card visual style: ${option.label}${selected}`,
            onClick: () => controller.setCardVisualStyle(option.value),
          })
        }
        for (const option of ANIMATION_SPEED_OPTIONS) {
          const selected = view.animationSpeed === option.value ? ' (selected)' : ''
          entries.push({
            key: `settings-animation-speed:${option.value}`,
            label: `Set animation speed: ${option.label}${selected}`,
            onClick: () => controller.setAnimationSpeed(option.value),
          })
        }
      } else {
        entries.push({
          key: 'recording-back',
          label: 'Back to Lobby',
          onClick: () => lobbyScene?.showRootMenu(),
        })
        entries.push({
          key: 'lobby-recorder-load-browser',
          label: 'Load Recording from Browser',
          onClick: () => controller.loadRecordingFromLocalStorage(),
          disabled: !view.recording.hasLocalSave,
        })
        entries.push({
          key: 'lobby-recorder-load-file',
          label: 'Load Recording from File',
          onClick: () => this.openRecordingFilePicker(),
        })
      }
    } else {
      const closeSceneMenu = (): void => { this.cardgameScene?.closeMenuOverlay() }
      if (targetPickerOpen) {
        const targetPickerEntries = this.cardgameScene?.getTargetPickerA11yEntries() ?? []
        for (const entry of targetPickerEntries) {
          entries.push({
            key: `target-picker:${entry.key}`,
            label: entry.label,
            onClick: entry.onSelect,
          })
        }
      } else {
        if (view.mode === 'adventure-hvai') {
          entries.push({ key: 'pause-adventure', label: 'Pause Adventure', onClick: () => {
            closeSceneMenu()
            controller.pauseAdventure()
          } })
          entries.push({ key: 'reset-adventure', label: 'Reset Adventure Run', onClick: () => {
            closeSceneMenu()
            controller.abandonAdventure()
          } })
        } else {
          entries.push({ key: 'back-to-lobby', label: 'Back to Lobby', onClick: () => {
            closeSceneMenu()
            controller.backToLobby()
          } })
          entries.push({ key: 'rematch', label: 'Rematch', onClick: () => {
            closeSceneMenu()
            controller.rematch()
          } })
        }
        // Mirror the Phaser menu's recorder actions: close the menu overlay
        // before invoking the controller so the resulting status message (e.g.
        // "No saved recording found" or "Failed to read recording file") shows
        // up in the scene's status footer instead of being hidden behind the
        // open modal. Without these closes, keyboard / screen-reader users who
        // trigger Save/Load via the a11y nav while the menu is open get no
        // visible feedback at all.
        const menuModalOpen = this.cardgameScene?.isMenuOverlayOpen() ?? false
        if (menuModalOpen) {
          entries.push({ key: 'menu-close', label: 'Close Menu', onClick: () => closeSceneMenu() })
        }
        entries.push({ key: 'recorder-download', label: 'Download Recording', onClick: () => {
          closeSceneMenu()
          this.handleDownloadRecording()
        } })
        entries.push({ key: 'recorder-save', label: 'Save Recording to Browser', onClick: () => {
          closeSceneMenu()
          controller.saveRecordingToLocalStorage()
        } })
        entries.push({
          key: 'recorder-load-browser',
          label: 'Load Recording from Browser',
          onClick: () => {
            closeSceneMenu()
            controller.loadRecordingFromLocalStorage()
          },
          disabled: !view.recording.hasLocalSave,
        })
        entries.push({ key: 'recorder-load-file', label: 'Load Recording from File', onClick: () => {
          closeSceneMenu()
          this.openRecordingFilePicker()
        } })
        const installEntry = installButtonState()
        entries.push({
          key: 'install',
          label: installEntry.label,
          onClick: () => {
            closeSceneMenu()
            installEntry.onClick()
          },
          disabled: installEntry.disabled,
        })
        if (view.replay.active) {
          entries.push({ key: 'replay-toggle', label: view.replay.isPlaying ? 'Pause Replay' : 'Play Replay', onClick: () => {
            if (view.replay.isPlaying) {
              controller.pauseReplay()
            } else {
              controller.startReplay()
            }
          } })
          entries.push({ key: 'replay-prev', label: 'Previous Replay Step', onClick: () => controller.stepReplay(-1) })
          entries.push({ key: 'replay-next', label: 'Next Replay Step', onClick: () => controller.stepReplay(1) })
          entries.push({ key: 'replay-jump-end', label: 'Jump Replay to End', onClick: () => controller.jumpReplayToEnd() })
          entries.push({ key: 'replay-exit', label: 'Exit Replay', onClick: () => controller.exitReplay() })
        } else {
          entries.push({
            key: 'replay-start',
            label: 'Start Replay',
            onClick: () => controller.startReplay(),
            disabled: !view.recording.metadata,
          })
        }

        // In-match gameplay actions: mirror the Phaser scene's interactive
        // controls (play land options, counter responses, Pass, End Turn) as
        // native <button> elements so keyboard and screen-reader users can take
        // turns without relying on pointer-only Phaser hit areas. Skip these
        // when the Phaser menu modal is open: pointer users cannot interact
        // with gameplay controls behind the modal, so exposing them through
        // the a11y nav would let keyboard / screen-reader users mutate game
        // state behind the overlay and break the modal semantics.
        const game = view.game
        if (game && game.canInput && !menuModalOpen) {
          if (game.phase === 'main') {
            const battlefieldTargets = this.cardgameScene?.getBattlefieldTargetA11yEntries() ?? []
            const hasBattlefieldTargets = battlefieldTargets.length > 0
            if (hasBattlefieldTargets) {
              for (const target of battlefieldTargets) {
                entries.push({
                  key: target.key,
                  label: target.label,
                  onClick: target.onSelect,
                })
              }
            } else {
              for (const card of game.players[game.actor].handCards) {
                const options = game.legal.playLandByCard[card.id]
                if (!options) {
                  continue
                }
                for (const option of options) {
                  entries.push({
                    key: `play:${card.id}:${option.label}`,
                    label: `Play ${card.name}: ${option.label}`,
                    onClick: () => controller.submitAction(option.action),
                  })
                }
              }
            }
            if (game.legal.canEndTurn && !hasBattlefieldTargets) {
              entries.push({
                key: 'end-turn',
                label: 'End Turn',
                onClick: () => controller.submitAction({ type: 'end_turn', actor: game.actor }),
              })
            }
          } else if (game.phase === 'respond') {
            game.legal.counterOptions.forEach((option, index) => {
              entries.push({
                key: `counter:${index}`,
                label: option.label,
                onClick: () => controller.submitAction(option.action),
              })
            })
            if (game.legal.canPassResponse) {
              entries.push({
                key: 'pass-response',
                label: 'Pass Response',
                onClick: () => controller.submitAction({ type: 'pass_response', actor: game.actor }),
              })
            }
          } else if (game.phase === 'plains_target') {
            const battlefieldTargets = this.cardgameScene?.getBattlefieldTargetA11yEntries() ?? []
            if (battlefieldTargets.length > 0) {
              for (const target of battlefieldTargets) {
                entries.push({
                  key: target.key,
                  label: target.label,
                  onClick: target.onSelect,
                })
              }
            } else {
              game.legal.plainsReuseOptions.forEach((option, index) => {
                entries.push({
                  key: `plains-reuse:${index}:${option.action.effectTargetId ?? 'default'}`,
                  label: option.label,
                  onClick: () => controller.submitAction(option.action),
                })
              })
            }
          }
        }
      }
    }

    // Diff against the previous render to preserve focus on auto-updating
    // states (e.g. replay playback). When the set of buttons (keyed by `key`)
    // is unchanged, update labels / disabled and rebind handlers in place
    // instead of clearing innerHTML, which would destroy focus.
    const signature = entries.map((entry) => entry.key).join('|')
    if (signature === this.a11yNavKeySignature && nav.children.length === entries.length) {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        const button = nav.children[index] as HTMLButtonElement
        if (button.textContent !== entry.label) {
          button.textContent = entry.label
        }
        const shouldDisable = entry.disabled === true
        if (button.disabled !== shouldDisable) {
          button.disabled = shouldDisable
        }
        const previousHandler = (button as HTMLButtonElement & { _a11yHandler?: () => void })._a11yHandler
        if (previousHandler) {
          button.removeEventListener('click', previousHandler)
        }
        button.addEventListener('click', entry.onClick)
        ;(button as HTMLButtonElement & { _a11yHandler?: () => void })._a11yHandler = entry.onClick
      }
      return
    }

    nav.innerHTML = ''
    for (const entry of entries) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = entry.label
      if (entry.disabled) {
        button.disabled = true
      }
      button.addEventListener('click', entry.onClick)
      ;(button as HTMLButtonElement & { _a11yHandler?: () => void })._a11yHandler = entry.onClick
      nav.appendChild(button)
    }
    this.a11yNavKeySignature = signature
  }

  unmount(): void {
    this.fileInput?.remove()
    this.fileInput = null
    this.lobbyP2POverlay?.remove()
    this.lobbyP2POverlay = null
    this.a11yNavOverlay?.remove()
    this.a11yNavOverlay = null
    this.hostAnswerDraft = ''
    this.joinOfferDraft = ''

    this.game?.destroy(true)
    this.game = null
    this.cardgameScene = null
    this.lobbyScene = null
    this.activeSceneKey = null

    if (this.container) {
      this.container.classList.remove('phaser-root')
      this.container.innerHTML = ''
    }
    this.container = null
    this.controller = null
    this.currentView = null
  }

  openRecordingFilePicker(): void {
    this.fileInput?.click()
  }

  handleDownloadRecording(): void {
    const payload = this.controller?.exportRecordingJson()
    if (!payload) {
      return
    }
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `cardgame-recording-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOCATION_DELAY_MS)
  }
}
