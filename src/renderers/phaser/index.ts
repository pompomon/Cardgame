import Phaser from 'phaser'
import { resolvePlayLandDrop, resolveTargetedPlayLandAction } from '../../app/action-resolution'
import type { ControllerApi } from '../../app/controller'
import type { AppViewModel, GameUiState, Mode } from '../../app/types'
import type { AppRenderer } from '../types'
import { buildLayout, orientationFromViewport, type OrientationMode, type SceneLayout } from './layout'

const BASE_WIDTH = 1280
const BASE_HEIGHT = 820
const DEFAULT_TARGET_OPTIONS = 5
const BUTTON_TEXT_HORIZONTAL_PADDING = 24
const SCROLL_WHEEL_MULTIPLIER = 0.8
const POPUP_SECTION_GAP = 10
const POPUP_BUTTON_GAP = 8
const SCROLL_INDICATOR_RIGHT_OFFSET = 10
const ORIENTATION_STORAGE_KEY = 'cardgame.phaser.orientation'
const MIN_READABLE_LOG_VIEWPORT_HEIGHT = 36
const BLOB_URL_REVOCATION_DELAY_MS = 1000
const LOBBY_SCENE_KEY = 'cardgame-lobby'
const CARDGAME_SCENE_KEY = 'cardgame-main'

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

interface CardStyle {
  fill: number
  stroke: number
  text: string
}

function readStoredOrientationMode(): OrientationMode | null {
  try {
    const stored = localStorage.getItem(ORIENTATION_STORAGE_KEY)
    if (stored === 'vertical' || stored === 'horizontal') {
      return stored
    }
  } catch {
    // Ignore storage access errors (for example private mode restrictions).
  }
  return null
}

function persistOrientationMode(mode: OrientationMode): void {
  try {
    localStorage.setItem(ORIENTATION_STORAGE_KEY, mode)
  } catch {
    // Ignore storage access errors.
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function cardStyleForLand(name: string): CardStyle {
  const fallback: CardStyle = { fill: 0x132652, stroke: 0x4f6caa, text: '#e5ecf5' }
  switch (name) {
    case 'Forest':
      return { fill: 0x19482c, stroke: 0x53a772, text: '#d6f9df' }
    case 'Island':
      return { fill: 0x173a66, stroke: 0x5f94d0, text: '#deebff' }
    case 'Mountain':
      return { fill: 0x5c2b1a, stroke: 0xbf6f4c, text: '#ffdfd1' }
    case 'Plains':
      return { fill: 0x695d31, stroke: 0xc8b872, text: '#fff8dd' }
    case 'Swamp':
      return { fill: 0x362148, stroke: 0x8a62af, text: '#f3e4ff' }
    default:
      return fallback
  }
}

function recordingMetadataText(view: AppViewModel): string {
  const meta = view.recording.metadata
  if (!meta) {
    return 'No recording loaded.'
  }
  return `Seed ${meta.seed} • ${meta.mode} • ${meta.controllers[0]}/${meta.controllers[1]} • Completed ${meta.completed ? 'Yes' : 'No'}`
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
  const background = scene.add.rectangle(0, 0, width, height, 0x1c2f63).setStrokeStyle(1, 0x365092)
  const text = scene.add.text(0, 0, label, {
    color: '#e5ecf5',
    fontSize,
    align: 'center',
    wordWrap: { width: Math.max(8, width - BUTTON_TEXT_HORIZONTAL_PADDING) },
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

  constructor(rendererRef: PhaserRenderer) {
    super(LOBBY_SCENE_KEY)
    this.rendererRef = rendererRef
  }

  handleOrientationChange(): void {
    this.renderView(this.rendererRef.currentView)
  }

  create(): void {
    this.rootContainer = this.add.container(0, 0)
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
    const orientation = this.rendererRef.orientationMode
    this.currentLayout = buildLayout(width, height, orientation)
    const signature = `${width}x${height}:${orientation}:${this.currentLayout.isCompact ? 'compact' : 'full'}`
    const changed = signature !== this.lastLayoutSignature
    this.lastLayoutSignature = signature
    return changed
  }

  private orientationButtonLabel(): string {
    return this.rendererRef.orientationMode === 'vertical'
      ? 'Switch to landscape'
      : 'Switch to portrait'
  }

  renderView(_view: AppViewModel | null): void {
    this.updateLayout()
    if (!this.rootContainer) {
      return
    }
    this.rootContainer.removeAll(true)

    const left = this.currentLayout.margin
    const top = this.currentLayout.headerTop
    const headerRight = this.currentLayout.width - this.currentLayout.margin - this.currentLayout.actionButtonWidth / 2

    this.rootContainer.add(this.add.text(left, top, 'Basic Land Game (Phaser Renderer)', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.titleFontSize,
    }))
    this.rootContainer.add(this.add.text(left, top + this.currentLayout.actionButtonHeight + 6, 'Land-only 2-player game with local AI and optional P2P mode.', {
      color: '#9db0d9',
      fontSize: this.currentLayout.subtitleFontSize,
      wordWrap: { width: Math.max(40, this.currentLayout.width - left * 2) },
    }))
    this.rootContainer.add(buildButton(
      this,
      this.orientationButtonLabel(),
      headerRight,
      top + this.currentLayout.actionButtonHeight / 2,
      this.currentLayout.bodyFontSize,
      this.currentLayout.actionButtonWidth,
      this.currentLayout.actionButtonHeight,
      () => {
        this.rendererRef.toggleOrientationMode()
      },
    ))

    const modes: Array<{ mode: Mode; label: string }> = [
      { mode: 'local-hvh', label: 'Local Human vs Human' },
      { mode: 'local-hvai', label: 'Local Human vs AI' },
      { mode: 'local-aivai', label: 'Local AI vs AI' },
      { mode: 'p2p-host', label: 'P2P Host' },
      { mode: 'p2p-join', label: 'P2P Join' },
    ]

    const view = this.rendererRef.currentView
    const hasLocalSave = view?.recording?.hasLocalSave ?? false
    // Lobby recorder entry points so users can review or replay a saved match
    // without having to start a throwaway game first (mirrors the DOM lobby
    // and the previous Phaser overlay). The Browser entry is only enabled
    // when a saved recording actually exists.
    const recorderEntries: Array<{ key: string; label: string; disabled?: boolean; onClick: () => void }> = [
      {
        key: 'load-browser',
        label: 'Load Recording from Browser',
        disabled: !hasLocalSave,
        onClick: () => { this.rendererRef.controller?.loadRecordingFromLocalStorage() },
      },
      {
        key: 'load-file',
        label: 'Load Recording from File',
        onClick: () => { this.rendererRef.openRecordingFilePicker() },
      },
    ]

    const buttonWidth = Math.min(this.currentLayout.width - left * 2, this.currentLayout.isCompact ? 330 : 360)
    // Lobby buttons (5 modes + 2 recorder + 1 renderer-switch) need to fit
    // between the header/subtitle area and the status footer on every
    // viewport. Derive Y positions from the available body region
    // (compressing button height and gap if necessary) so options like P2P
    // Join, recorder loads, and the renderer switch stay on-screen even in
    // short landscape phone layouts.
    const subtitleBottom = top + this.currentLayout.actionButtonHeight + 6
      + Math.max(this.currentLayout.actionButtonHeight, 28)
    const lobbyBodyTop = subtitleBottom + 16
    const lobbyBodyBottom = this.currentLayout.height
      - this.currentLayout.statusBottomOffset - this.currentLayout.margin
    const lobbyBodyHeight = Math.max(80, lobbyBodyBottom - lobbyBodyTop)
    const totalRows = modes.length + recorderEntries.length + 1 // mode buttons + recorder buttons + renderer-switch
    const desiredButtonHeight = this.currentLayout.isCompact ? 38 : 44
    const desiredGap = this.currentLayout.isCompact ? 8 : 14
    const desiredRowHeight = desiredButtonHeight + desiredGap
    // Scale rows to fit into the available body height.
    const rowScale = Math.min(1, lobbyBodyHeight / Math.max(1, totalRows * desiredRowHeight))
    const rowHeight = desiredRowHeight * rowScale
    const buttonHeight = Math.max(24, desiredButtonHeight * rowScale)
    const modeStartY = lobbyBodyTop + buttonHeight / 2

    modes.forEach((entry, index) => {
      this.rootContainer?.add(buildButton(
        this,
        entry.label,
        left + buttonWidth / 2,
        modeStartY + index * rowHeight,
        this.currentLayout.bodyFontSize,
        buttonWidth,
        buttonHeight,
        () => {
          this.rendererRef.controller?.startGame(entry.mode)
        },
      ))
    })

    recorderEntries.forEach((entry, index) => {
      const button = buildButton(
        this,
        entry.label,
        left + buttonWidth / 2,
        modeStartY + (modes.length + index) * rowHeight,
        this.currentLayout.bodyFontSize,
        buttonWidth,
        buttonHeight,
        entry.disabled ? () => {} : entry.onClick,
      )
      if (entry.disabled) {
        button.setAlpha(0.4)
      }
      this.rootContainer?.add(button)
    })

    this.rootContainer.add(buildButton(
      this,
      'Switch to DOM renderer',
      left + buttonWidth / 2,
      modeStartY + (modes.length + recorderEntries.length) * rowHeight,
      this.currentLayout.bodyFontSize,
      buttonWidth,
      buttonHeight,
      () => {
        window.location.search = '?renderer=dom'
      },
    ))

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
  }
}

class CardgameScene extends Phaser.Scene {
  private readonly rendererRef: PhaserRenderer
  private rootContainer: Phaser.GameObjects.Container | null = null
  private statusText: Phaser.GameObjects.Text | null = null
  private battlefieldDropZone: Phaser.GameObjects.Zone | null = null
  private pendingTargetPicker: Phaser.GameObjects.Container | null = null
  private menuOverlay: Phaser.GameObjects.Container | null = null
  private menuOpen = false
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

  handleOrientationChange(): void {
    this.renderView(this.rendererRef.currentView)
  }

  private orientationButtonLabel(): string {
    return this.rendererRef.orientationMode === 'vertical'
      ? 'Switch to landscape'
      : 'Switch to portrait'
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

    this.input.on('drag', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, dragX: number, dragY: number) => {
      if (this.menuOpen) {
        return
      }
      const draggable = object as Phaser.GameObjects.Container
      draggable.x = dragX
      draggable.y = dragY
    })

    this.input.on('dragend', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, dropped: boolean) => {
      const card = object as Phaser.GameObjects.Container
      if (this.menuOpen) {
        this.snapCardToOrigin(card)
        return
      }
      if (!dropped) {
        this.snapCardToOrigin(card)
      }
    })

    this.input.on('drop', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, zone: Phaser.GameObjects.Zone) => {
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
        this.rendererRef.controller?.submitAction(resolution.action)
        return
      }

      this.snapCardToOrigin(card)
      this.showTargetPicker(game, cardId, resolution.options)
    })

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
    })

    this.renderView(this.rendererRef.currentView)
  }

  private updateLayout(): boolean {
    const width = this.scale.gameSize.width ?? this.scale.width ?? BASE_WIDTH
    const height = this.scale.gameSize.height ?? this.scale.height ?? BASE_HEIGHT
    const orientation = this.rendererRef.orientationMode
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
    this.battlefieldDropZone = null
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
      }
      this.lastRenderedSeed = currentSeed
    } else {
      this.lastRenderedSeed = null
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
      preservedOverlay?.destroy(true)
      this.lastMenuSignature = null
      return
    }

    this.setStatus(view.status)

    if (!view.game) {
      preservedOverlay?.destroy(true)
      this.closeMenuOverlay()
      this.lastMenuSignature = null
      return
    }

    this.renderGame(view)
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
    return `${this.lastLayoutSignature}|${lines.length}|${last}|replay:${view.replay.active}:${view.replay.step}/${view.replay.totalSteps}:${view.replay.isPlaying}|saved:${view.recording.hasLocalSave ? 1 : 0}`
  }

  private createButton(
    label: string,
    x: number,
    y: number,
    onClick: () => void,
    width = 240,
    height = 44,
  ): Phaser.GameObjects.Container {
    return buildButton(this, label, x, y, this.currentLayout.bodyFontSize, width, height, onClick)
  }

  private bindScrollableViewport(
    overlay: Phaser.GameObjects.Container,
    viewportBackground: Phaser.GameObjects.Rectangle,
    viewportBounds: { left: number; right: number; top: number; bottom: number },
    applyScroll: (deltaY: number) => void,
  ): void {
    const isPointerWithinViewport = (pointer: Phaser.Input.Pointer): boolean => {
      const localX = pointer.worldX - overlay.x
      const localY = pointer.worldY - overlay.y
      const withinX = localX >= viewportBounds.left && localX <= viewportBounds.right
      const withinY = localY >= viewportBounds.top && localY <= viewportBounds.bottom
      return withinX && withinY
    }

    const handleWheel = (
      pointer: Phaser.Input.Pointer,
      _gameObjects: Phaser.GameObjects.GameObject[],
      _deltaX: number,
      deltaY: number,
    ): void => {
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
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      dragPointerId = null
      this.input.off('wheel', handleWheel)
      viewportBackground.off('pointerdown', handleViewportPointerDown)
      this.input.off('pointermove', handlePointerMove)
      this.input.off('pointerup', handlePointerUp)
      this.input.off('pointerupoutside', handlePointerUp)
    })
  }

  private renderGame(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }

    const left = this.currentLayout.margin

    // Header: Menu button on the left, then turn/phase label. No Rematch in the
    // header — Rematch lives under the Menu (mirrors DOM PR #13 menu-section 1).
    const menuButtonWidth = Math.min(this.currentLayout.actionButtonWidth, 180)
    this.rootContainer?.add(this.createButton('☰ Menu', left + menuButtonWidth / 2, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight / 2, () => {
      this.openMenuOverlay(view)
    }, menuButtonWidth, this.currentLayout.actionButtonHeight))

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
    this.rootContainer?.add(this.add.text(headerTextX, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight / 2, headerLabel, {
      color: game.winnerText ? '#f7d56b' : '#e5ecf5',
      fontSize: this.currentLayout.titleFontSize,
      wordWrap: { width: headerTextWidth },
      maxLines: 1,
    }).setOrigin(0, 0.5))

    this.renderInSceneLog(game.log)
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
    const safeWidth = Math.max(20, width)
    const safeHeight = Math.max(20, height)
    const bg = this.add.rectangle(x + safeWidth / 2, y + safeHeight / 2, safeWidth, safeHeight, bgColor)
      .setStrokeStyle(1, COLOR_PANEL_STROKE)
    this.rootContainer?.add(bg)
    if (lines.length === 0) {
      return
    }
    const text = this.add.text(x + 10, y + 6, lines.join('\n'), {
      color: '#e5ecf5',
      fontSize: this.currentLayout.bodyFontSize,
      wordWrap: { width: Math.max(40, safeWidth - 20) },
    })
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
    this.renderInfoPanel(
      COLOR_PLAYER_NON_ACTIVE_FILL,
      this.currentLayout.boardColumnLeft,
      this.currentLayout.nonActiveInfoY,
      this.currentLayout.boardColumnWidth,
      this.currentLayout.nonActiveInfoHeight,
      nonActiveLines,
    )

    const activeLines = [
      `Player ${activeIndex + 1} (${view.controllers[activeIndex]}) — Active`,
      `Hand: ${activePlayer.handCount} • Deck: ${activePlayer.deckCount} • Graveyard: ${activePlayer.graveyardCount}`,
    ]
    // On tight viewports the layout limits how many lines of active-info text
    // fit above the controls band (End Turn / response buttons). Render only
    // that many lines so the text does not spill into the controls band or
    // the hand strip on short split layouts (e.g. 720x360 horizontal).
    const allowedActiveLines = Math.max(0, Math.min(activeLines.length, this.currentLayout.activeInfoTextLines))
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
    const battlefieldHeaderBand = 22
    const nonActiveCardY = this.currentLayout.nonActiveBattlefieldY
      + battlefieldHeaderBand
      + Math.max(0, this.currentLayout.nonActiveBattlefieldHeight - battlefieldHeaderBand) / 2
    for (let index = 0; index < nonActiveBattlefield.length; index += 1) {
      const card = nonActiveBattlefield[index]
      this.rootContainer?.add(this.renderStaticCard(this.xForCardInBoardColumn(index, nonActiveBattlefield.length), nonActiveCardY, card.name))
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
    const activeCardY = this.currentLayout.activeBattlefieldY
      + battlefieldHeaderBand
      + Math.max(0, this.currentLayout.activeBattlefieldHeight - battlefieldHeaderBand) / 2
    for (let index = 0; index < activeBattlefield.length; index += 1) {
      const card = activeBattlefield[index]
      this.rootContainer?.add(this.renderStaticCard(this.xForCardInBoardColumn(index, activeBattlefield.length), activeCardY, card.name))
    }
  }

  private renderInSceneLog(lines: string[]): void {
    const x = this.currentLayout.logColumnLeft
    const y = this.currentLayout.logColumnTop
    const width = this.currentLayout.logColumnWidth
    const height = this.currentLayout.logColumnHeight

    const panelBg = this.add.rectangle(
      x + width / 2,
      y + height / 2,
      width,
      height,
      COLOR_LOG_PANEL_FILL,
    ).setStrokeStyle(1, COLOR_PANEL_STROKE)
    this.rootContainer?.add(panelBg)

    const padding = 10
    const headingHeight = Math.max(20, this.currentLayout.actionButtonHeight * 0.6)
    const heading = this.add.text(x + padding, y + 6, 'Replay Log', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.subtitleFontSize,
    })
    this.rootContainer?.add(heading)

    const viewportTop = y + 6 + headingHeight
    const viewportHeight = Math.max(40, height - (6 + headingHeight) - padding)
    const viewportLeft = x + padding
    const viewportWidth = Math.max(40, width - padding * 2)

    const viewportBg = this.add.rectangle(
      viewportLeft + viewportWidth / 2,
      viewportTop + viewportHeight / 2,
      viewportWidth,
      viewportHeight,
      COLOR_LOG_VIEWPORT_FILL,
      0.6,
    ).setStrokeStyle(1, COLOR_PANEL_STROKE)
    viewportBg.setInteractive()
    this.rootContainer?.add(viewportBg)

    const logDisplayText = lines.length > 0 ? lines.join('\n') : 'No log entries yet.'
    const logWrapWidth = Math.max(40, viewportWidth - 12)
    const sceneState = this as typeof this & {
      inSceneLogContent?: Phaser.GameObjects.Container
      inSceneLogText?: Phaser.GameObjects.Text
      inSceneLogMaskGraphics?: Phaser.GameObjects.Graphics
      inSceneLogMask?: Phaser.Display.Masks.GeometryMask
      inSceneLogRenderedText?: string
      inSceneLogRenderedWrapWidth?: number
      inSceneLogRenderedFontSize?: string | number
    }

    let logContent = sceneState.inSceneLogContent
    if (!logContent || !logContent.active) {
      logContent = this.add.container(viewportLeft + 6, viewportTop + 6)
      sceneState.inSceneLogContent = logContent
    } else {
      logContent.setPosition(viewportLeft + 6, viewportTop + 6)
    }
    this.rootContainer?.add(logContent)

    let logText = sceneState.inSceneLogText
    if (!logText || !logText.active) {
      logText = this.add.text(0, 0, logDisplayText, {
        color: '#9db0d9',
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: logWrapWidth },
      }).setOrigin(0, 0)
      sceneState.inSceneLogText = logText
      sceneState.inSceneLogRenderedText = logDisplayText
      sceneState.inSceneLogRenderedWrapWidth = logWrapWidth
      sceneState.inSceneLogRenderedFontSize = this.currentLayout.smallFontSize
    } else {
      logText.setPosition(0, 0)
      if (sceneState.inSceneLogRenderedWrapWidth !== logWrapWidth) {
        logText.setWordWrapWidth(logWrapWidth, true)
        sceneState.inSceneLogRenderedWrapWidth = logWrapWidth
      }
      if (sceneState.inSceneLogRenderedFontSize !== this.currentLayout.smallFontSize) {
        logText.setFontSize(this.currentLayout.smallFontSize)
        sceneState.inSceneLogRenderedFontSize = this.currentLayout.smallFontSize
      }
      if (sceneState.inSceneLogRenderedText !== logDisplayText) {
        logText.setText(logDisplayText)
        sceneState.inSceneLogRenderedText = logDisplayText
      }
    }
    if (!logContent.list.includes(logText)) {
      logContent.add(logText)
    }

    let logMask = sceneState.inSceneLogMaskGraphics
    if (!logMask || !logMask.active) {
      logMask = this.add.graphics()
      logMask.setVisible(false)
      sceneState.inSceneLogMaskGraphics = logMask
      sceneState.inSceneLogMask = logMask.createGeometryMask()
    } else {
      logMask.clear()
    }
    logMask.fillStyle(0xffffff)
    logMask.fillRect(viewportLeft, viewportTop, viewportWidth, viewportHeight)
    this.rootContainer?.add(logMask)
    if (sceneState.inSceneLogMask) {
      logContent.setMask(sceneState.inSceneLogMask)
    }

    const maxScroll = Math.max(0, logText.height + 12 - viewportHeight)
    let scrollOffset: number
    if (this.inSceneLogScrollOffset === null || this.inSceneLogPinnedToBottom) {
      scrollOffset = maxScroll
    } else {
      scrollOffset = Phaser.Math.Clamp(this.inSceneLogScrollOffset, 0, maxScroll)
    }
    this.inSceneLogScrollOffset = scrollOffset
    this.inSceneLogPinnedToBottom = scrollOffset >= maxScroll
    logContent.y = viewportTop + 6 - scrollOffset

    if (maxScroll > 0) {
      const applyScroll = (deltaY: number): void => {
        scrollOffset = Phaser.Math.Clamp(scrollOffset + deltaY, 0, maxScroll)
        this.inSceneLogScrollOffset = scrollOffset
        this.inSceneLogPinnedToBottom = scrollOffset >= maxScroll
        logContent.y = viewportTop + 6 - scrollOffset
      }
      // The in-scene log lives directly on the root container (not on an
      // overlay container offset from origin), so we use a thin proxy whose
      // origin is (0,0) for bindScrollableViewport bounds math.
      const proxyOverlay = this.add.container(0, 0)
      this.rootContainer?.add(proxyOverlay)
      this.bindScrollableViewport(
        proxyOverlay,
        viewportBg,
        {
          left: viewportLeft,
          right: viewportLeft + viewportWidth,
          top: viewportTop,
          bottom: viewportTop + viewportHeight,
        },
        applyScroll,
      )
    }
  }

  private renderStaticCard(x: number, y: number, label: string): Phaser.GameObjects.Container {
    const style = cardStyleForLand(label)
    const rect = this.add.rectangle(0, 0, this.currentLayout.cardWidth, this.currentLayout.cardHeight, style.fill).setStrokeStyle(1, style.stroke)
    const text = this.add.text(0, 0, label, {
      color: style.text,
      fontSize: this.currentLayout.bodyFontSize,
      align: 'center',
      wordWrap: { width: this.currentLayout.cardWidth - 12 },
    }).setOrigin(0.5)
    return this.add.container(x, y, [rect, text])
  }

  private renderHandAndControls(game: GameUiState): void {
    const actor = game.actor
    const actorCards = game.players[actor].handCards
    const canDrag = game.canInput && game.phase === 'main'

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

    if (game.canInput && game.phase === 'respond') {
      const promptText = this.add.text(this.currentLayout.boardColumnLeft + 8, this.currentLayout.responseInfoY, `Opponent played ${game.pendingLandName ?? 'a land'}.`, {
        color: '#f0f4ff',
        fontSize: this.currentLayout.bodyFontSize,
      })
      this.rootContainer?.add(promptText)

      // Response controls (counter options + Pass) must fit between the prompt
      // line and the hand cards inside the active-info row's controls band
      // (`activeInfoControlsHeight` already excludes the player-info text and
      // the hand strip). On short viewports that band may be only ~40-60px
      // tall. Try a single-column stack first, but if it would shrink each
      // button below a usable click target (~28px tall), switch to a multi-
      // column grid that fits all buttons at the minimum usable height
      // without spilling into the hand strip.
      const promptHeight = Math.ceil(promptText.height + 4)
      const respondBandTop = this.currentLayout.responseInfoY + promptHeight
      const respondBandBottom = this.currentLayout.activeInfoControlsTop + this.currentLayout.activeInfoControlsHeight
      const respondBandHeight = Math.max(0, respondBandBottom - respondBandTop)
      const totalButtons = game.legal.counterOptions.length + (game.legal.canPassResponse ? 1 : 0)
      const desiredButtonHeight = this.currentLayout.popupButtonHeight
      const desiredGap = 8
      const minUsableButtonHeight = 28
      const availableWidth = Math.max(0, this.currentLayout.boardColumnWidth - 16)
      const preferredButtonWidth = this.currentLayout.isCompact ? 400 : 440
      // Compute the smallest column count whose stacked rows fit at >= the
      // minimum usable button height. The grid never exceeds totalButtons
      // columns. This keeps every response action click-reachable on the
      // short viewports the PR is targeting (e.g. 5 actions on 1024×480).
      let columns = 1
      let rows = totalButtons
      let respondGap = totalButtons > 1 ? Math.min(desiredGap, Math.max(0, respondBandHeight * 0.05)) : 0
      let heightForButtons = Math.max(0, respondBandHeight - Math.max(0, rows - 1) * respondGap)
      let respondButtonHeight = totalButtons > 0
        ? Math.min(desiredButtonHeight, heightForButtons / Math.max(1, rows))
        : desiredButtonHeight
      while (totalButtons > 0 && respondButtonHeight < minUsableButtonHeight && columns < totalButtons) {
        columns += 1
        rows = Math.ceil(totalButtons / columns)
        respondGap = rows > 1 ? Math.min(desiredGap, Math.max(0, respondBandHeight * 0.05)) : 0
        heightForButtons = Math.max(0, respondBandHeight - Math.max(0, rows - 1) * respondGap)
        respondButtonHeight = Math.min(desiredButtonHeight, heightForButtons / Math.max(1, rows))
      }
      // If even a maxed-out grid cannot reach the minimum height, accept the
      // largest possible button height so they remain at least visible.
      respondButtonHeight = Math.max(respondButtonHeight, Math.min(desiredButtonHeight, heightForButtons / Math.max(1, rows)))
      const columnGap = columns > 1 ? 8 : 0
      const cellWidth = columns > 0 ? (availableWidth - columnGap * (columns - 1)) / columns : availableWidth
      // Clamp button width so the assembled grid never exceeds availableWidth
      // (the board column). On collapsed phone viewports (e.g. 320px) with
      // many response actions the per-cell width can fall below the 28px
      // minimum click target. Forcing a 60px floor here would push the
      // rightmost buttons off-panel/off-screen, so we accept the small
      // cellWidth instead and let the column-search above place buttons
      // tightly inside the available width.
      const buttonWidth = Math.min(preferredButtonWidth, Math.max(0, cellWidth))
      const gridWidth = columns * buttonWidth + Math.max(0, columns - 1) * columnGap
      const controlsX = this.currentLayout.boardColumnLeft + this.currentLayout.boardColumnWidth / 2
      const gridLeft = controlsX - gridWidth / 2
      const startY = respondBandTop + respondButtonHeight / 2
      const positionFor = (index: number): { x: number; y: number } => {
        const row = Math.floor(index / columns)
        const column = index % columns
        return {
          x: gridLeft + buttonWidth / 2 + column * (buttonWidth + columnGap),
          y: startY + row * (respondButtonHeight + respondGap),
        }
      }

      game.legal.counterOptions.forEach((option, index) => {
        const { x, y } = positionFor(index)
        this.rootContainer?.add(this.createButton(option.label, x, y, () => {
          this.rendererRef.controller?.submitAction(option.action)
        }, buttonWidth, respondButtonHeight))
      })
      if (game.legal.canPassResponse) {
        const { x, y } = positionFor(game.legal.counterOptions.length)
        this.rootContainer?.add(this.createButton('Pass', x, y, () => {
          this.rendererRef.controller?.submitAction({ type: 'pass_response', actor: game.actor })
        }, buttonWidth, respondButtonHeight))
      }
      return
    }

    if (game.canInput && game.legal.canEndTurn && game.phase === 'main') {
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
    this.menuLogScrollOffset = null
    this.menuLogPinnedToBottom = true
    this.lastMenuSignature = null
    overlay?.destroy(true)
  }

  isMenuOverlayOpen(): boolean {
    return this.menuOpen
  }

  private openMenuOverlay(view: AppViewModel): void {
    if (!this.rootContainer || this.menuOverlay) {
      return
    }
    const game = view.game
    if (!game) {
      return
    }

    this.pendingTargetPicker?.destroy(true)
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
    const scrim = this.add.rectangle(0, 0, this.currentLayout.width, this.currentLayout.height, 0x000000, 0.62)
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

    const panel = this.add.rectangle(0, 0, popupWidth, popupHeight, 0x0f1a3b, 0.96).setStrokeStyle(2, 0x365092)
    panel.setInteractive()
    panel.on('pointerdown', swallowPointerEvent)
    panel.on('pointerup', swallowPointerEvent)
    panel.on('pointermove', swallowPointerEvent)
    overlay.add(panel)

    overlay.add(this.add.text(0, -popupHeight / 2 + popupPadding + this.currentLayout.menuTitleHeight / 2, 'Menu', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.subtitleFontSize,
    }).setOrigin(0.5))

    const fullButtonWidth = Math.max(1, popupWidth - popupPadding * 2)
    const halfButtonGap = POPUP_BUTTON_GAP
    const halfButtonWidth = Math.max(1, (fullButtonWidth - halfButtonGap) / 2)
    let cursorY = -popupHeight / 2 + popupPadding + this.currentLayout.menuTitleHeight + sectionGap

    // Section 1: Back to Lobby + Rematch (mirrors DOM PR #13 menu-section 1).
    const section1Y = cursorY + this.currentLayout.popupButtonHeight / 2
    overlay.add(this.createButton('Back to Lobby', -halfButtonWidth / 2 - halfButtonGap / 2, section1Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.controller?.backToLobby()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight))
    overlay.add(this.createButton('Rematch', halfButtonWidth / 2 + halfButtonGap / 2, section1Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.controller?.rematch()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight))
    cursorY += this.currentLayout.popupButtonHeight + sectionGap

    // Section 2: orientation toggle.
    const orientationY = cursorY + this.currentLayout.popupButtonHeight / 2
    overlay.add(this.createButton(this.orientationButtonLabel(), 0, orientationY, () => {
      this.closeMenuOverlay()
      this.rendererRef.toggleOrientationMode()
    }, fullButtonWidth, this.currentLayout.popupButtonHeight))
    cursorY += this.currentLayout.popupButtonHeight + sectionGap

    // Section 3: Recorder.
    const recorderHeading = this.add.text(-fullButtonWidth / 2, cursorY, `Recorder — ${recordingMetadataText(view)}`, {
      color: '#9db0d9',
      fontSize: this.currentLayout.smallFontSize,
      wordWrap: { width: fullButtonWidth },
    }).setOrigin(0, 0)
    overlay.add(recorderHeading)
    // Use the rendered text height (which reflects wrapping at narrow widths)
    // instead of a fixed 18px so the next row never overlaps a wrapped heading.
    cursorY += Math.max(18, recorderHeading.height) + 4

    const recorderRow1Y = cursorY + this.currentLayout.popupButtonHeight / 2
    overlay.add(this.createButton('Download Save', -halfButtonWidth / 2 - halfButtonGap / 2, recorderRow1Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.handleDownloadRecording()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight))
    overlay.add(this.createButton('Save to Browser', halfButtonWidth / 2 + halfButtonGap / 2, recorderRow1Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.controller?.saveRecordingToLocalStorage()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight))
    cursorY += this.currentLayout.popupButtonHeight + halfButtonGap

    const recorderRow2Y = cursorY + this.currentLayout.popupButtonHeight / 2
    overlay.add(this.createButton('Load from Browser', -halfButtonWidth / 2 - halfButtonGap / 2, recorderRow2Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.controller?.loadRecordingFromLocalStorage()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight))
    overlay.add(this.createButton('Load from File', halfButtonWidth / 2 + halfButtonGap / 2, recorderRow2Y, () => {
      this.closeMenuOverlay()
      this.rendererRef.openRecordingFilePicker()
    }, halfButtonWidth, this.currentLayout.popupButtonHeight))
    cursorY += this.currentLayout.popupButtonHeight + halfButtonGap

    if (!view.replay.active) {
      const startReplayY = cursorY + this.currentLayout.popupButtonHeight / 2
      overlay.add(this.createButton('Start Replay', 0, startReplayY, () => {
        this.closeMenuOverlay()
        this.rendererRef.controller?.startReplay()
      }, fullButtonWidth, this.currentLayout.popupButtonHeight))
      cursorY += this.currentLayout.popupButtonHeight + sectionGap
    } else {
      cursorY += sectionGap
    }

    // Section 4: Replay controls (only when replay is active).
    if (view.replay.active) {
      const replayHeading = this.add.text(-fullButtonWidth / 2, cursorY, `Replay Controls — Step ${view.replay.step}/${view.replay.totalSteps} • ${view.replay.isPlaying ? 'Playing' : 'Paused'}`, {
        color: '#9db0d9',
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: fullButtonWidth },
      }).setOrigin(0, 0)
      overlay.add(replayHeading)
      cursorY += Math.max(18, replayHeading.height) + 4

      const replayRow1Y = cursorY + this.currentLayout.popupButtonHeight / 2
      const replayButtonWidth = Math.max(1, (fullButtonWidth - halfButtonGap * 2) / 3)
      overlay.add(this.createButton(view.replay.isPlaying ? 'Pause' : 'Play', -replayButtonWidth - halfButtonGap, replayRow1Y, () => {
        if (view.replay.isPlaying) {
          this.rendererRef.controller?.pauseReplay()
        } else {
          this.rendererRef.controller?.startReplay()
        }
      }, replayButtonWidth, this.currentLayout.popupButtonHeight))
      overlay.add(this.createButton('Previous', 0, replayRow1Y, () => {
        this.rendererRef.controller?.stepReplay(-1)
      }, replayButtonWidth, this.currentLayout.popupButtonHeight))
      overlay.add(this.createButton('Next', replayButtonWidth + halfButtonGap, replayRow1Y, () => {
        this.rendererRef.controller?.stepReplay(1)
      }, replayButtonWidth, this.currentLayout.popupButtonHeight))
      cursorY += this.currentLayout.popupButtonHeight + halfButtonGap

      const replayRow2Y = cursorY + this.currentLayout.popupButtonHeight / 2
      overlay.add(this.createButton('Jump to End', -halfButtonWidth / 2 - halfButtonGap / 2, replayRow2Y, () => {
        this.rendererRef.controller?.jumpReplayToEnd()
      }, halfButtonWidth, this.currentLayout.popupButtonHeight))
      overlay.add(this.createButton('Exit Replay', halfButtonWidth / 2 + halfButtonGap / 2, replayRow2Y, () => {
        this.closeMenuOverlay()
        this.rendererRef.controller?.exitReplay()
      }, halfButtonWidth, this.currentLayout.popupButtonHeight))
      cursorY += this.currentLayout.popupButtonHeight + sectionGap
    }

    // Close button.
    const closeButtonY = cursorY + this.currentLayout.popupButtonHeight / 2
    overlay.add(this.createButton('Close', 0, closeButtonY, () => {
      this.closeMenuOverlay()
    }, Math.min(fullButtonWidth, 220), this.currentLayout.popupButtonHeight))
    const buttonStackBottomY = closeButtonY + this.currentLayout.popupButtonHeight / 2

    // Replay Log section: heading + masked scrollable viewport.
    const logTitleY = buttonStackBottomY + sectionGap + 14
    const logViewportTopWithHeading = logTitleY + 14 + sectionGap
    const logViewportWidth = fullButtonWidth
    const popupBottomEdge = popupHeight / 2 - popupPadding
    const maxViewportHeightWithHeading = Math.max(0, popupBottomEdge - logViewportTopWithHeading)
    // If the heading + viewport doesn't fit readably, drop the heading so the log section
    // still has somewhere to render. This preserves access to the replay log on short
    // viewports rather than removing it entirely.
    const showHeading = maxViewportHeightWithHeading >= MIN_READABLE_LOG_VIEWPORT_HEIGHT
    const logViewportTop = showHeading
      ? logViewportTopWithHeading
      : Math.max(buttonStackBottomY + sectionGap, popupBottomEdge - MIN_READABLE_LOG_VIEWPORT_HEIGHT)
    const maxViewportHeight = Math.max(0, popupBottomEdge - logViewportTop)
    if (maxViewportHeight > 0) {
      if (showHeading) {
        overlay.add(this.add.text(-fullButtonWidth / 2, logTitleY, 'Replay Log', {
          color: '#e5ecf5',
          fontSize: this.currentLayout.bodyFontSize,
        }).setOrigin(0, 0.5))
      }

      const logViewportHeight = Math.min(this.currentLayout.menuLogViewportHeight, maxViewportHeight)
      const logViewportY = logViewportTop + logViewportHeight / 2
      const logViewportBackground = this.add.rectangle(0, logViewportY, logViewportWidth, logViewportHeight, COLOR_LOG_VIEWPORT_FILL, 0.75)
        .setStrokeStyle(1, 0x365092)
      logViewportBackground.setInteractive()
      logViewportBackground.on('pointerdown', swallowPointerEvent)
      logViewportBackground.on('pointerup', swallowPointerEvent)
      logViewportBackground.on('pointermove', swallowPointerEvent)
      overlay.add(logViewportBackground)

      const logContent = this.add.container(-logViewportWidth / 2 + 10, logViewportTop + 8)
      overlay.add(logContent)
      const lines = game.log
      const logText = this.add.text(0, 0, lines.length > 0 ? lines.join('\n') : 'No log entries yet.', {
        color: '#9db0d9',
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: Math.max(40, logViewportWidth - 20) },
      }).setOrigin(0, 0)
      logContent.add(logText)

      const logMask = this.add.graphics()
      logMask.fillStyle(0xffffff)
      logMask.fillRect(-logViewportWidth / 2, logViewportTop, logViewportWidth, logViewportHeight)
      logMask.setVisible(false)
      overlay.add(logMask)
      logContent.setMask(logMask.createGeometryMask())

      const maxScroll = Math.max(0, logText.height + 16 - logViewportHeight)
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
      const applyScroll = (deltaY: number): void => {
        if (maxScroll <= 0) {
          return
        }
        scrollOffset = Phaser.Math.Clamp(scrollOffset + deltaY, 0, maxScroll)
        this.menuLogScrollOffset = scrollOffset
        this.menuLogPinnedToBottom = scrollOffset >= maxScroll
        logContent.y = logViewportTop + 8 - scrollOffset
      }

      if (maxScroll > 0) {
        this.bindScrollableViewport(
          overlay,
          logViewportBackground,
          {
            left: -logViewportWidth / 2,
            right: logViewportWidth / 2,
            top: logViewportTop,
            bottom: logViewportTop + logViewportHeight,
          },
          applyScroll,
        )

        overlay.add(this.add.text(logViewportWidth / 2 - SCROLL_INDICATOR_RIGHT_OFFSET, logViewportTop + logViewportHeight / 2, 'Scroll or drag', {
          color: '#9db0d9',
          fontSize: this.currentLayout.smallFontSize,
        }).setOrigin(1, 0.5))
      }
    }

    this.menuOverlay = overlay
    this.rootContainer.add(overlay)
    this.lastMenuSignature = this.computeMenuSignature(view)
  }

  private showTargetPicker(
    game: GameUiState,
    cardId: string,
    options: Array<{ effectTargetId?: string; label: string }>,
    showAllTargets = false,
  ): void {
    if (this.menuOpen) {
      return
    }
    this.pendingTargetPicker?.destroy(true)

    const optionCount = showAllTargets ? options.length : Math.min(DEFAULT_TARGET_OPTIONS, options.length)
    const hasHiddenOptions = options.length > DEFAULT_TARGET_OPTIONS
    const popupPadding = this.currentLayout.isCompact ? 16 : 20
    const popupWidth = Math.max(0, this.currentLayout.popupMaxWidth)
    const buttonWidth = Math.max(0, popupWidth - popupPadding * 2)
    const titleHeight = this.currentLayout.isCompact ? 44 : 56
    const optionGap = this.currentLayout.isCompact ? 8 : 10
    const cancelHeight = this.currentLayout.popupButtonHeight
    const showAllButtonHeight = hasHiddenOptions ? cancelHeight : 0
    const footerGap = hasHiddenOptions ? POPUP_BUTTON_GAP : 0
    const footerHeight = cancelHeight + footerGap + showAllButtonHeight
    const optionsHeightWanted = optionCount > 0
      ? optionCount * this.currentLayout.popupButtonHeight + Math.max(0, optionCount - 1) * optionGap
      : this.currentLayout.popupButtonHeight
    const desiredHeight = titleHeight + optionsHeightWanted + footerHeight + popupPadding * 2 + POPUP_SECTION_GAP * 2
    const maxHeight = this.currentLayout.height - this.currentLayout.margin * 2
    const popupHeight = Math.min(desiredHeight, maxHeight)

    const overlay = this.add.container(this.currentLayout.width / 2, this.currentLayout.height / 2)
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.pendingTargetPicker === overlay) {
        this.pendingTargetPicker = null
      }
    })
    const swallowPointerEvent = (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ): void => {
      event.stopPropagation()
    }

    const backdrop = this.add.rectangle(0, 0, popupWidth, popupHeight, 0x000000, 0.82).setStrokeStyle(2, 0x4f6caa)
    backdrop.setInteractive()
    backdrop.on('pointerdown', swallowPointerEvent)
    backdrop.on('pointerup', swallowPointerEvent)
    backdrop.on('pointermove', swallowPointerEvent)
    overlay.add(backdrop)
    overlay.add(this.add.text(0, -popupHeight / 2 + popupPadding + titleHeight / 2, 'Choose target', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.subtitleFontSize,
    }).setOrigin(0.5))

    const optionsTopY = -popupHeight / 2 + popupPadding + titleHeight
    const footerTopY = popupHeight / 2 - popupPadding - footerHeight
    const optionsAreaHeight = Math.max(48, footerTopY - optionsTopY - POPUP_SECTION_GAP)
    const optionsViewportY = optionsTopY + optionsAreaHeight / 2

    const optionsViewportBackground = this.add.rectangle(0, optionsViewportY, buttonWidth, optionsAreaHeight, 0x0f1a3b, 0.4)
      .setStrokeStyle(1, 0x365092)
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
      const buttonY = this.currentLayout.popupButtonHeight / 2 + index * (this.currentLayout.popupButtonHeight + optionGap)
      const button = this.createButton(option.label, 0, buttonY, () => {
        const action = resolveTargetedPlayLandAction(game, cardId, option.effectTargetId)
        if (action) {
          this.rendererRef.controller?.submitAction(action)
        }
        overlay.destroy(true)
      }, buttonWidth, this.currentLayout.popupButtonHeight)
      optionsList.add(button)
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
        overlay,
        optionsViewportBackground,
        {
          left: -buttonWidth / 2,
          right: buttonWidth / 2,
          top: optionsTopY,
          bottom: optionsTopY + optionsAreaHeight,
        },
        applyScroll,
      )

      overlay.add(this.add.text(buttonWidth / 2 - SCROLL_INDICATOR_RIGHT_OFFSET, optionsTopY + optionsAreaHeight / 2, 'Scroll or drag', {
        color: '#9db0d9',
        fontSize: this.currentLayout.smallFontSize,
      }).setOrigin(1, 0.5))
    }

    const cancelY = footerTopY + cancelHeight / 2
    const cancelButton = this.createButton('Cancel', 0, cancelY, () => {
      overlay.destroy(true)
    }, Math.min(buttonWidth, 260), cancelHeight)
    overlay.add(cancelButton)

    if (hasHiddenOptions) {
      const showAllY = cancelY + cancelHeight / 2 + POPUP_BUTTON_GAP + showAllButtonHeight / 2
      const showAllLabel = showAllTargets ? `Show first ${DEFAULT_TARGET_OPTIONS}` : `Show all (${options.length})`
      const showAllButton = this.createButton(showAllLabel, 0, showAllY, () => {
        overlay.destroy(true)
        this.showTargetPicker(game, cardId, options, !showAllTargets)
      }, Math.min(buttonWidth, 300), showAllButtonHeight)
      overlay.add(showAllButton)
    }

    this.pendingTargetPicker = overlay
    this.rootContainer?.add(overlay)
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
  private _orientationMode: OrientationMode = 'horizontal'

  get orientationMode(): OrientationMode {
    return this._orientationMode
  }

  toggleOrientationMode(): void {
    this._orientationMode = this._orientationMode === 'vertical' ? 'horizontal' : 'vertical'
    persistOrientationMode(this._orientationMode)
    this.cardgameScene?.handleOrientationChange()
    this.lobbyScene?.handleOrientationChange()
  }

  mount(container: HTMLElement, controller: ControllerApi): void {
    this.container = container
    this.controller = controller
    this._orientationMode = readStoredOrientationMode()
      ?? orientationFromViewport(window.innerWidth, window.innerHeight)
    container.classList.add('phaser-root')

    const canvasHost = document.createElement('div')
    canvasHost.className = 'phaser-host'
    container.innerHTML = ''
    container.appendChild(canvasHost)

    // Hidden file input for "Load from File" recorder action. The Menu modal
    // triggers it via openRecordingFilePicker(); no other DOM overlays remain
    // (recorder/P2P controls are now exclusively under the Menu).
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
    // Lobby, orientation toggle, mode buttons, etc.).
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
               <textarea data-p2p-field="offer" placeholder="Offer" readonly>${safeOffer}</textarea>
               <textarea data-p2p-field="host-answer" placeholder="Paste remote answer">${safeHostAnswerDraft}</textarea>
               <button data-p2p-action="accept-answer">Accept Answer</button>
               <button data-p2p-action="start-p2p-game">Start Game</button>`
            : `<textarea data-p2p-field="join-offer" placeholder="Paste host offer">${safeJoinOfferDraft}</textarea>
               <button data-p2p-action="create-answer">Create Answer</button>
               <textarea data-p2p-field="answer" placeholder="Answer" readonly>${safeAnswer}</textarea>`
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
    const orientationLabel = this.orientationMode === 'vertical' ? 'Switch to landscape' : 'Switch to portrait'
    entries.push({ key: 'orientation', label: orientationLabel, onClick: () => this.toggleOrientationMode() })

    if (lobbyActive) {
      const modes: Array<{ mode: Mode; label: string }> = [
        { mode: 'local-hvh', label: 'Local Human vs Human' },
        { mode: 'local-hvai', label: 'Local Human vs AI' },
        { mode: 'local-aivai', label: 'Local AI vs AI' },
        { mode: 'p2p-host', label: 'P2P Host' },
        { mode: 'p2p-join', label: 'P2P Join' },
      ]
      for (const entry of modes) {
        entries.push({ key: `start:${entry.mode}`, label: `Start ${entry.label}`, onClick: () => controller.startGame(entry.mode) })
      }
      // Mirror the lobby's recorder entry points for keyboard / screen-reader
      // users so they can load a saved match without first starting a
      // throwaway game (matches the new visible lobby buttons).
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
      entries.push({ key: 'switch-renderer', label: 'Switch to DOM renderer', onClick: () => { window.location.search = '?renderer=dom' } })
    } else {
      entries.push({ key: 'back-to-lobby', label: 'Back to Lobby', onClick: () => controller.backToLobby() })
      entries.push({ key: 'rematch', label: 'Rematch', onClick: () => controller.rematch() })
      // Mirror the Phaser menu's recorder actions: close the menu overlay
      // before invoking the controller so the resulting status message (e.g.
      // "No saved recording found" or "Failed to read recording file") shows
      // up in the scene's status footer instead of being hidden behind the
      // open modal. Without these closes, keyboard / screen-reader users who
      // trigger Save/Load via the a11y nav while the menu is open get no
      // visible feedback at all.
      const closeSceneMenu = (): void => { this.cardgameScene?.closeMenuOverlay() }
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
      const menuModalOpen = this.cardgameScene?.isMenuOverlayOpen() ?? false
      if (game && game.canInput && !menuModalOpen) {
        if (game.phase === 'main') {
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
          if (game.legal.canEndTurn) {
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
