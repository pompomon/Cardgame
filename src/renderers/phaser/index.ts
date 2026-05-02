import Phaser from 'phaser'
import { resolvePlayLandDrop, resolveTargetedPlayLandAction } from '../../app/action-resolution'
import type { ControllerApi } from '../../app/controller'
import type { AppViewModel, GameUiState, Mode } from '../../app/types'
import type { AppRenderer } from '../types'

const BASE_WIDTH = 1280
const BASE_HEIGHT = 820
const DEFAULT_TARGET_OPTIONS = 5
const BUTTON_TEXT_HORIZONTAL_PADDING = 24
const SCROLL_WHEEL_MULTIPLIER = 0.8
const POPUP_SECTION_GAP = 10
const POPUP_BUTTON_GAP = 8
const SCROLL_INDICATOR_RIGHT_OFFSET = 10
const ORIENTATION_STORAGE_KEY = 'cardgame.phaser.orientation'
const POPUP_MIN_WIDTH = 180
const COMPACT_DIMENSION_THRESHOLD = 700
const PORTRAIT_LOG_COLLAPSE_HEIGHT_THRESHOLD = 920
const PORTRAIT_LOG_COLLAPSE_DIMENSION_THRESHOLD = 760
const LANDSCAPE_LOG_COLLAPSE_HEIGHT_THRESHOLD = 660

type OrientationMode = 'vertical' | 'horizontal'

interface CardStyle {
  fill: number
  stroke: number
  text: string
}

interface SceneLayout {
  width: number
  height: number
  orientation: OrientationMode
  isCompact: boolean
  preferCollapsedLog: boolean
  margin: number
  titleFontSize: string
  subtitleFontSize: string
  bodyFontSize: string
  smallFontSize: string
  headerTop: number
  actionButtonWidth: number
  actionButtonHeight: number
  actionButtonGap: number
  cardWidth: number
  cardHeight: number
  cardGap: number
  summaryTopY: number
  summaryBlockGap: number
  battlefieldTopY: number
  battlefieldHeight: number
  battlefieldTopRowY: number
  battlefieldBottomRowY: number
  handActorY: number
  handCardsY: number
  controlsStartY: number
  responseInfoY: number
  logTopY: number
  logHeight: number
  logHeaderHeight: number
  statusBottomOffset: number
  popupMaxWidth: number
  popupButtonHeight: number
}

function clamp(value: number, minValue: number, maxValue: number): number {
  const lower = Math.min(minValue, maxValue)
  const upper = Math.max(minValue, maxValue)
  return Math.min(upper, Math.max(lower, value))
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

function orientationFromViewport(width: number, height: number): OrientationMode {
  return width >= height ? 'horizontal' : 'vertical'
}

function isLogCollapsePreferred(orientation: OrientationMode, height: number, minDimension: number): boolean {
  if (orientation === 'vertical') {
    return height < PORTRAIT_LOG_COLLAPSE_HEIGHT_THRESHOLD || minDimension < PORTRAIT_LOG_COLLAPSE_DIMENSION_THRESHOLD
  }
  return height < LANDSCAPE_LOG_COLLAPSE_HEIGHT_THRESHOLD
}

function buildLayout(width: number, height: number, orientation: OrientationMode): SceneLayout {
  const safeWidth = width > 0 ? width : 1
  const safeHeight = height > 0 ? height : 1
  const minDimension = Math.min(safeWidth, safeHeight)
  const isCompact = minDimension < COMPACT_DIMENSION_THRESHOLD
  const margin = clamp(minDimension * 0.02, 10, 28)
  const bodyFontPx = clamp(minDimension * 0.018, 12, 18)
  const smallFontPx = clamp(bodyFontPx * 0.86, 10, 16)
  const subtitleFontPx = clamp(bodyFontPx * 1.08, 13, 22)
  const titleFontPx = clamp(bodyFontPx * 1.55, 18, 34)
  const titleFontSize = `${Math.round(titleFontPx)}px`
  const subtitleFontSize = `${Math.round(subtitleFontPx)}px`
  const bodyFontSize = `${Math.round(bodyFontPx)}px`
  const smallFontSize = `${Math.round(smallFontPx)}px`
  const actionButtonHeight = clamp(minDimension * 0.05, 32, 48)
  const actionButtonWidth = clamp(
    safeWidth * (orientation === 'vertical' ? 0.36 : 0.24),
    150,
    orientation === 'vertical' ? 320 : 260,
  )
  const actionButtonGap = clamp(actionButtonHeight * 0.2, 6, 12)
  const cardWidth = clamp(safeWidth * (orientation === 'vertical' ? 0.15 : 0.11), 70, 132)
  const cardHeight = clamp(cardWidth * 1.35, 98, 182)
  const cardGap = clamp(cardWidth * 1.08, 76, 170)

  const headerTop = margin
  const leftHeaderTextHeight = titleFontPx + subtitleFontPx + margin
  const rightButtonsHeight = actionButtonHeight * 3 + actionButtonGap * 2
  const headerHeight = Math.max(leftHeaderTextHeight, rightButtonsHeight)
  const summaryTopY = headerTop + headerHeight + clamp(minDimension * 0.01, 8, 16)
  const summaryBlockGap = clamp(bodyFontPx * 4.4, 58, 92)
  const battlefieldTopY = summaryTopY + summaryBlockGap * 2 + clamp(minDimension * 0.012, 8, 18)
  const battlefieldHeight = clamp(safeHeight * (orientation === 'vertical' ? 0.22 : 0.28), cardHeight * 1.9, safeHeight * 0.36)
  const battlefieldTopRowY = battlefieldTopY + battlefieldHeight * 0.34
  const battlefieldBottomRowY = battlefieldTopY + battlefieldHeight * 0.74
  const handActorY = battlefieldTopY + battlefieldHeight + clamp(minDimension * 0.017, 12, 26)
  const handCardsY = handActorY + clamp(minDimension * 0.06, 42, 84)
  const controlsStartY = handActorY + clamp(minDimension * 0.032, 20, 42)
  const responseInfoY = controlsStartY
  const logTopY = handCardsY + cardHeight / 2 + clamp(minDimension * 0.013, 10, 24)
  const logHeaderHeight = clamp(actionButtonHeight * 0.95, 30, 44)
  const statusBottomOffset = clamp(minDimension * 0.018, 14, 24)
  const statusLineReservedHeight = smallFontPx + 12
  const logBottomPadding = margin + 24 + statusBottomOffset + statusLineReservedHeight
  const logAvailableHeight = safeHeight - logTopY - logBottomPadding
  const logHeight = Math.max(0, logAvailableHeight)
  const popupAvailableWidth = Math.max(0, safeWidth - margin * 2)
  const popupTargetWidth = Math.min(popupAvailableWidth, orientation === 'vertical' ? 520 : 760)
  const popupMaxWidth = Math.min(popupAvailableWidth, Math.max(POPUP_MIN_WIDTH, popupTargetWidth))
  const popupButtonHeight = clamp(actionButtonHeight * 1.05, 36, 48)
  const preferCollapsedLog = isLogCollapsePreferred(orientation, safeHeight, minDimension)

  return {
    width: safeWidth,
    height: safeHeight,
    orientation,
    isCompact,
    preferCollapsedLog,
    margin,
    titleFontSize,
    subtitleFontSize,
    bodyFontSize,
    smallFontSize,
    headerTop,
    actionButtonWidth,
    actionButtonHeight,
    actionButtonGap,
    cardWidth,
    cardHeight,
    cardGap,
    summaryTopY,
    summaryBlockGap,
    battlefieldTopY,
    battlefieldHeight,
    battlefieldTopRowY,
    battlefieldBottomRowY,
    handActorY,
    handCardsY,
    controlsStartY,
    responseInfoY,
    logTopY,
    logHeight,
    logHeaderHeight,
    statusBottomOffset,
    popupMaxWidth,
    popupButtonHeight,
  }
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

class CardgameScene extends Phaser.Scene {
  private readonly rendererRef: PhaserRenderer
  private rootContainer: Phaser.GameObjects.Container | null = null
  private statusText: Phaser.GameObjects.Text | null = null
  private battlefieldDropZone: Phaser.GameObjects.Zone | null = null
  private pendingTargetPicker: Phaser.GameObjects.Container | null = null
  private currentLayout: SceneLayout = buildLayout(BASE_WIDTH, BASE_HEIGHT, 'horizontal')
  private lastLayoutSignature = ''
  private logCollapsed = false
  private logPreferenceSet = false

  private snapCardToOrigin(card: Phaser.GameObjects.Container): void {
    const ox = card.getData('originX')
    const oy = card.getData('originY')
    if (typeof ox === 'number' && typeof oy === 'number') {
      card.x = ox
      card.y = oy
    }
  }

  constructor(rendererRef: PhaserRenderer) {
    super('cardgame-main')
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
    this.updateLayout()
    this.statusText = this.add.text(this.currentLayout.margin, this.currentLayout.height - this.currentLayout.statusBottomOffset, '', {
      color: '#9db0d9',
      fontSize: this.currentLayout.bodyFontSize,
    })

    this.input.on('drag', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, dragX: number, dragY: number) => {
      const draggable = object as Phaser.GameObjects.Container
      draggable.x = dragX
      draggable.y = dragY
    })

    this.input.on('dragend', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, dropped: boolean) => {
      const card = object as Phaser.GameObjects.Container
      if (!dropped) {
        this.snapCardToOrigin(card)
      }
    })

    this.input.on('drop', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, zone: Phaser.GameObjects.Zone) => {
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

    this.scale.on('resize', () => {
      if (this.updateLayout()) {
        this.renderView(this.rendererRef.currentView)
      }
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

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.setText(message)
      this.statusText.setPosition(this.currentLayout.margin, this.currentLayout.height - this.currentLayout.statusBottomOffset)
      this.statusText.setFontSize(this.currentLayout.bodyFontSize)
    }
  }

  private clearRoot(): void {
    this.rootContainer?.removeAll(true)
    this.pendingTargetPicker = null
    this.battlefieldDropZone = null
  }

  private xForCard(index: number, count: number): number {
    if (count <= 1) {
      return this.currentLayout.width / 2
    }

    const minX = this.currentLayout.margin + this.currentLayout.cardWidth / 2
    const maxX = this.currentLayout.width - this.currentLayout.margin - this.currentLayout.cardWidth / 2
    const maxGap = (maxX - minX) / (count - 1)
    const gap = Math.min(this.currentLayout.cardGap, maxGap)
    const usedWidth = gap * (count - 1)
    const availableWidth = maxX - minX
    const startX = minX + (availableWidth - usedWidth) / 2 // Center the card spread inside the available battlefield width.
    return startX + index * gap
  }

  renderView(view: AppViewModel | null): void {
    this.updateLayout()
    this.clearRoot()
    if (!view || !this.rootContainer) {
      return
    }

    if (!this.logPreferenceSet) {
      this.logCollapsed = this.currentLayout.preferCollapsedLog
    }

    this.setStatus(view.status)

    if (!view.game) {
      this.renderLobby()
      return
    }

    this.renderGame(view)
  }

  private createButton(
    label: string,
    x: number,
    y: number,
    onClick: () => void,
    width = 240,
    height = 44,
  ): Phaser.GameObjects.Container {
    const background = this.add.rectangle(0, 0, width, height, 0x1c2f63).setStrokeStyle(1, 0x365092)
    const text = this.add.text(0, 0, label, {
      color: '#e5ecf5',
      fontSize: this.currentLayout.bodyFontSize,
      align: 'center',
      wordWrap: { width: Math.max(8, width - BUTTON_TEXT_HORIZONTAL_PADDING) },
    }).setOrigin(0.5)
    const button = this.add.container(x, y, [background, text])
    button.setSize(width, height)
    button.setInteractive({ useHandCursor: true })
    button.on('pointerup', onClick)
    return button
  }

  private renderLobby(): void {
    const left = this.currentLayout.margin
    const top = this.currentLayout.headerTop
    const headerRight = this.currentLayout.width - this.currentLayout.margin - this.currentLayout.actionButtonWidth / 2

    this.rootContainer?.add(this.add.text(left, top, 'Basic Land Game (Phaser Renderer)', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.titleFontSize,
    }))
    this.rootContainer?.add(this.add.text(left, top + this.currentLayout.actionButtonHeight + 6, 'Land-only 2-player game with local AI and optional P2P mode.', {
      color: '#9db0d9',
      fontSize: this.currentLayout.subtitleFontSize,
      wordWrap: { width: this.currentLayout.width - left * 2 },
    }))
    this.rootContainer?.add(this.createButton(this.orientationButtonLabel(), headerRight, top + this.currentLayout.actionButtonHeight / 2, () => {
      this.rendererRef.toggleOrientationMode()
    }, this.currentLayout.actionButtonWidth, this.currentLayout.actionButtonHeight))

    const modes: Array<{ mode: Mode; label: string }> = [
      { mode: 'local-hvh', label: 'Local Human vs Human' },
      { mode: 'local-hvai', label: 'Local Human vs AI' },
      { mode: 'local-aivai', label: 'Local AI vs AI' },
      { mode: 'p2p-host', label: 'P2P Host' },
      { mode: 'p2p-join', label: 'P2P Join' },
    ]

    const buttonWidth = Math.min(this.currentLayout.width - left * 2, this.currentLayout.isCompact ? 330 : 360)
    const modeStartY = top + this.currentLayout.actionButtonHeight * 2 + 40
    const modeGap = this.currentLayout.isCompact ? 46 : 58

    modes.forEach((entry, index) => {
      this.rootContainer?.add(
        this.createButton(entry.label, left + buttonWidth / 2, modeStartY + index * modeGap, () => {
          this.rendererRef.controller?.startGame(entry.mode)
        }, buttonWidth, this.currentLayout.isCompact ? 38 : 44),
      )
    })

    this.rootContainer?.add(
      this.createButton('Switch to DOM renderer', left + buttonWidth / 2, modeStartY + modes.length * modeGap + 24, () => {
        window.location.search = '?renderer=dom'
      }, buttonWidth, this.currentLayout.isCompact ? 38 : 42),
    )
  }

  private renderGame(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }

    const left = this.currentLayout.margin
    const headerRight = this.currentLayout.width - this.currentLayout.margin - this.currentLayout.actionButtonWidth / 2

    this.rootContainer?.add(this.add.text(left, this.currentLayout.headerTop, `Turn ${game.turn} • Phase: ${game.phase}`, {
      color: '#e5ecf5',
      fontSize: this.currentLayout.titleFontSize,
    }))
    this.rootContainer?.add(this.add.text(left, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight + 6, game.winnerText, {
      color: '#f7d56b',
      fontSize: this.currentLayout.subtitleFontSize,
    }))

    this.rootContainer?.add(this.createButton('Back to Lobby', headerRight, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight / 2, () => {
      this.rendererRef.controller?.backToLobby()
    }, this.currentLayout.actionButtonWidth, this.currentLayout.actionButtonHeight))
    this.rootContainer?.add(this.createButton('Rematch', headerRight, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight + this.currentLayout.actionButtonGap + this.currentLayout.actionButtonHeight / 2, () => {
      this.rendererRef.controller?.rematch()
    }, this.currentLayout.actionButtonWidth, this.currentLayout.actionButtonHeight))
    this.rootContainer?.add(this.createButton(this.orientationButtonLabel(), headerRight, this.currentLayout.headerTop + (this.currentLayout.actionButtonHeight + this.currentLayout.actionButtonGap) * 2 + this.currentLayout.actionButtonHeight / 2, () => {
      this.rendererRef.toggleOrientationMode()
    }, this.currentLayout.actionButtonWidth, this.currentLayout.actionButtonHeight))

    this.renderPlayerSummaries(view)
    this.renderBattlefield(game)
    this.renderHandAndControls(game)
    this.renderLog(game.log)
  }

  private renderPlayerSummaries(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }

    const active = game.actor
    const topPlayerIndex = active === 0 ? 1 : 0
    const bottomPlayerIndex = active
    const topPlayer = game.players[topPlayerIndex]
    const bottomPlayer = game.players[bottomPlayerIndex]

    const topSummary = this.add.text(this.currentLayout.margin, this.currentLayout.summaryTopY, [
      `Top Board • Player ${topPlayerIndex + 1} (${view.controllers[topPlayerIndex]})`,
      `Hand: ${topPlayer.handCount} • Deck: ${topPlayer.deckCount} • Graveyard: ${topPlayer.graveyardCount}`,
      `Battlefield: ${topPlayer.battlefield.map((entry) => entry.name).join(', ') || 'None'}`,
    ], {
      color: '#c6d4ef',
      fontSize: this.currentLayout.bodyFontSize,
      wordWrap: { width: Math.max(40, this.currentLayout.width - this.currentLayout.margin * 2) },
    })
    this.rootContainer?.add(topSummary)

    const bottomSummary = this.add.text(this.currentLayout.margin, this.currentLayout.summaryTopY + this.currentLayout.summaryBlockGap, [
      `Bottom Board • Player ${bottomPlayerIndex + 1} (${view.controllers[bottomPlayerIndex]})`,
      `Hand: ${bottomPlayer.handCount} • Deck: ${bottomPlayer.deckCount} • Graveyard: ${bottomPlayer.graveyardCount}`,
      `Battlefield: ${bottomPlayer.battlefield.map((entry) => entry.name).join(', ') || 'None'}`,
    ], {
      color: '#c6d4ef',
      fontSize: this.currentLayout.bodyFontSize,
      wordWrap: { width: Math.max(40, this.currentLayout.width - this.currentLayout.margin * 2) },
    })
    this.rootContainer?.add(bottomSummary)
  }

  private renderBattlefield(game: GameUiState): void {
    const zoneX = this.currentLayout.width / 2
    const zoneY = this.currentLayout.battlefieldTopY + this.currentLayout.battlefieldHeight / 2
    const zoneWidth = this.currentLayout.width - this.currentLayout.margin * 2

    const zoneBackground = this.add.rectangle(zoneX, zoneY, zoneWidth, this.currentLayout.battlefieldHeight, 0x0f1a3b).setStrokeStyle(2, 0x365092)
    this.rootContainer?.add(zoneBackground)

    const title = this.currentLayout.isCompact
      ? 'Battlefield (drop card here)'
      : 'Battlefield (drop hand card here)'

    this.rootContainer?.add(this.add.text(this.currentLayout.margin + 8, this.currentLayout.battlefieldTopY - (this.currentLayout.actionButtonHeight * 0.65), title, {
      color: '#e5ecf5',
      fontSize: this.currentLayout.subtitleFontSize,
    }))

    const active = game.actor
    const topPlayerIndex = active === 0 ? 1 : 0
    const bottomPlayerIndex = active

    this.rootContainer?.add(this.add.text(this.currentLayout.margin + 8, this.currentLayout.battlefieldTopRowY - this.currentLayout.cardHeight / 2 - (this.currentLayout.actionButtonHeight * 0.5), `Top: Player ${topPlayerIndex + 1}`, {
      color: '#9db0d9',
      fontSize: this.currentLayout.smallFontSize,
    }))
    this.rootContainer?.add(this.add.text(this.currentLayout.margin + 8, this.currentLayout.battlefieldBottomRowY - this.currentLayout.cardHeight / 2 - (this.currentLayout.actionButtonHeight * 0.5), `Bottom (active): Player ${bottomPlayerIndex + 1}`, {
      color: '#9db0d9',
      fontSize: this.currentLayout.smallFontSize,
    }))

    const dropZone = this.add.zone(zoneX, zoneY, zoneWidth, this.currentLayout.battlefieldHeight)
    dropZone.setRectangleDropZone(zoneWidth, this.currentLayout.battlefieldHeight)
    dropZone.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.battlefieldDropZone === dropZone) {
        this.battlefieldDropZone = null
      }
    })
    this.battlefieldDropZone = dropZone
    this.rootContainer?.add(dropZone)

    const topBattlefield = game.players[topPlayerIndex].battlefield
    for (let index = 0; index < topBattlefield.length; index += 1) {
      const card = topBattlefield[index]
      this.rootContainer?.add(this.renderStaticCard(this.xForCard(index, topBattlefield.length), this.currentLayout.battlefieldTopRowY, card.name))
    }

    const bottomBattlefield = game.players[bottomPlayerIndex].battlefield
    for (let index = 0; index < bottomBattlefield.length; index += 1) {
      const card = bottomBattlefield[index]
      this.rootContainer?.add(this.renderStaticCard(this.xForCard(index, bottomBattlefield.length), this.currentLayout.battlefieldBottomRowY, card.name))
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

    this.rootContainer?.add(this.add.text(this.currentLayout.margin + 8, this.currentLayout.handActorY, `Actor: Player ${actor + 1} (${game.actorControl})`, {
      color: '#f0f4ff',
      fontSize: this.currentLayout.subtitleFontSize,
    }))

    actorCards.forEach((card, index) => {
      const x = this.xForCard(index, actorCards.length)
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
      this.rootContainer?.add(this.add.text(this.currentLayout.margin + 8, this.currentLayout.responseInfoY, `Opponent played ${game.pendingLandName ?? 'a land'}.`, {
        color: '#f0f4ff',
        fontSize: this.currentLayout.bodyFontSize,
      }))

      const availableWidth = Math.max(0, this.currentLayout.width - this.currentLayout.margin * 2)
      const preferredButtonWidth = this.currentLayout.isCompact ? 400 : 440
      const buttonWidth = Math.min(preferredButtonWidth, availableWidth)
      const controlsX = this.currentLayout.margin + buttonWidth / 2 + (availableWidth - buttonWidth) / 2
      const buttonHeight = this.currentLayout.popupButtonHeight
      const startY = this.currentLayout.responseInfoY + this.currentLayout.actionButtonHeight + this.currentLayout.actionButtonGap

      game.legal.counterOptions.forEach((option, index) => {
        this.rootContainer?.add(this.createButton(option.label, controlsX, startY + index * (buttonHeight + 8), () => {
          this.rendererRef.controller?.submitAction(option.action)
        }, buttonWidth, buttonHeight))
      })
      if (game.legal.canPassResponse) {
        this.rootContainer?.add(this.createButton('Pass', controlsX, startY + game.legal.counterOptions.length * (buttonHeight + 8), () => {
          this.rendererRef.controller?.submitAction({ type: 'pass_response', actor: game.actor })
        }, buttonWidth, buttonHeight))
      }
      return
    }

    if (game.canInput && game.legal.canEndTurn && game.phase === 'main') {
      this.rootContainer?.add(this.createButton('End Turn', this.currentLayout.width - this.currentLayout.margin - this.currentLayout.actionButtonWidth / 2, this.currentLayout.controlsStartY, () => {
        this.rendererRef.controller?.submitAction({ type: 'end_turn', actor: game.actor })
      }, this.currentLayout.actionButtonWidth, this.currentLayout.actionButtonHeight + 4))
    }
  }

  private renderLog(lines: string[]): void {
    const headerWidth = clamp(this.currentLayout.actionButtonWidth, 170, 240)
    const headerX = this.currentLayout.margin + headerWidth / 2
    const headerY = this.currentLayout.logTopY + this.currentLayout.logHeaderHeight / 2
    const title = this.logCollapsed ? 'Replay Log ▸' : 'Replay Log ▾'

    this.rootContainer?.add(this.createButton(title, headerX, headerY, () => {
      this.logCollapsed = !this.logCollapsed
      this.logPreferenceSet = true
      this.renderView(this.rendererRef.currentView)
    }, headerWidth, this.currentLayout.logHeaderHeight))

    if (this.logCollapsed) {
      return
    }

    const panelTop = this.currentLayout.logTopY + this.currentLayout.logHeaderHeight + 6
    const panelHeight = Math.max(44, this.currentLayout.logHeight - this.currentLayout.logHeaderHeight - 6)
    const panelWidth = this.currentLayout.width - this.currentLayout.margin * 2
    const panelX = this.currentLayout.width / 2
    const panelY = panelTop + panelHeight / 2

    const background = this.add.rectangle(panelX, panelY, panelWidth, panelHeight, 0x0f1a3b).setStrokeStyle(1, 0x365092)
    this.rootContainer?.add(background)

    const logText = this.add.text(this.currentLayout.margin + 10, panelTop + 8, lines.length > 0 ? lines.join('\n') : 'No log entries yet.', {
      color: '#9db0d9',
      fontSize: this.currentLayout.smallFontSize,
      wordWrap: { width: panelWidth - 18 },
    })
    this.rootContainer?.add(logText)

    const logMaskInset = 1
    const logMaskShape = this.add.graphics()
    logMaskShape.fillStyle(0xffffff)
    logMaskShape.fillRect(
      panelX - panelWidth / 2 + logMaskInset,
      panelTop + logMaskInset,
      Math.max(0, panelWidth - logMaskInset * 2),
      Math.max(0, panelHeight - logMaskInset * 2),
    )
    logMaskShape.setVisible(false)
    this.rootContainer?.add(logMaskShape)
    logText.setMask(logMaskShape.createGeometryMask())
  }

  private showTargetPicker(
    game: GameUiState,
    cardId: string,
    options: Array<{ effectTargetId?: string; label: string }>,
    showAllTargets = false,
  ): void {
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
      const isPointerWithinOptions = (pointer: Phaser.Input.Pointer): boolean => {
        const localX = pointer.worldX - overlay.x
        const localY = pointer.worldY - overlay.y
        const withinX = localX >= -buttonWidth / 2 && localX <= buttonWidth / 2
        const withinY = localY >= optionsTopY && localY <= optionsTopY + optionsAreaHeight
        return withinX && withinY
      }

      const handleWheel = (pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
        if (isPointerWithinOptions(pointer)) {
          applyScroll(deltaY * SCROLL_WHEEL_MULTIPLIER)
        }
      }

      let dragPointerId: number | null = null
      let lastDragY = 0
      const handleViewportPointerDown = (pointer: Phaser.Input.Pointer): void => {
        if (!isPointerWithinOptions(pointer)) {
          return
        }
        dragPointerId = pointer.id
        lastDragY = pointer.worldY
      }
      const handlePointerMove = (pointer: Phaser.Input.Pointer) => {
        if (dragPointerId !== pointer.id) {
          return
        }
        const deltaY = lastDragY - pointer.worldY
        applyScroll(deltaY)
        lastDragY = pointer.worldY
      }
      const handlePointerUp = (pointer: Phaser.Input.Pointer) => {
        if (dragPointerId === pointer.id) {
          dragPointerId = null
        }
      }

      this.input.on('wheel', handleWheel)
      optionsViewportBackground.on('pointerdown', handleViewportPointerDown)
      this.input.on('pointermove', handlePointerMove)
      this.input.on('pointerup', handlePointerUp)
      this.input.on('pointerupoutside', handlePointerUp)
      overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
        dragPointerId = null
        this.input.off('wheel', handleWheel)
        optionsViewportBackground.off('pointerdown', handleViewportPointerDown)
        this.input.off('pointermove', handlePointerMove)
        this.input.off('pointerup', handlePointerUp)
        this.input.off('pointerupoutside', handlePointerUp)
      })

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
  private scene: CardgameScene | null = null
  currentView: AppViewModel | null = null
  private p2pOverlay: HTMLDivElement | null = null
  private p2pOverlayMode: 'host' | 'join' | null = null
  private p2pSettingsOpen = false
  private _orientationMode: OrientationMode = 'horizontal'

  get orientationMode(): OrientationMode {
    return this._orientationMode
  }

  toggleOrientationMode(): void {
    this._orientationMode = this._orientationMode === 'vertical' ? 'horizontal' : 'vertical'
    persistOrientationMode(this._orientationMode)
    this.scene?.handleOrientationChange()
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

    const overlay = document.createElement('div')
    overlay.className = 'phaser-p2p-overlay'
    container.appendChild(overlay)
    this.p2pOverlay = overlay

    this.scene = new CardgameScene(this)
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      width: canvasHost.clientWidth > 0 ? canvasHost.clientWidth : BASE_WIDTH,
      height: canvasHost.clientHeight > 0 ? canvasHost.clientHeight : BASE_HEIGHT,
      parent: canvasHost,
      backgroundColor: '#0b1020',
      scene: [this.scene],
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
    this.scene?.renderView(view)
    this.renderP2POverlay(view)
  }

  unmount(): void {
    this.p2pOverlay?.remove()
    this.p2pOverlay = null
    this.p2pOverlayMode = null
    this.p2pSettingsOpen = false

    this.game?.destroy(true)
    this.game = null
    this.scene = null

    if (this.container) {
      this.container.classList.remove('phaser-root')
      this.container.innerHTML = ''
    }
    this.container = null
    this.controller = null
    this.currentView = null
  }

  private setP2POverlayOpen(open: boolean): void {
    if (this.p2pSettingsOpen === open) {
      return
    }
    this.p2pSettingsOpen = open
    this.p2pOverlay?.classList.toggle('open', open)
  }

  private bindP2PSettingsModalControls(): void {
    if (!this.p2pOverlay) {
      return
    }

    const settingsToggle = this.p2pOverlay.querySelector<HTMLButtonElement>('#phaser-settings-toggle')
    if (settingsToggle) {
      settingsToggle.onclick = () => {
        this.setP2POverlayOpen(true)
      }
    }
    const settingsClose = this.p2pOverlay.querySelector<HTMLButtonElement>('#phaser-settings-close')
    if (settingsClose) {
      settingsClose.onclick = () => {
        this.setP2POverlayOpen(false)
      }
    }
    const settingsBackdrop = this.p2pOverlay.querySelector<HTMLDivElement>('.phaser-settings-backdrop')
    if (settingsBackdrop) {
      settingsBackdrop.onclick = (event: MouseEvent) => {
        if (event.target === settingsBackdrop) {
          this.setP2POverlayOpen(false)
        }
      }
    }
    const settingsPanel = this.p2pOverlay.querySelector<HTMLDivElement>('.phaser-settings-panel')
    if (settingsPanel) {
      settingsPanel.onclick = (event: MouseEvent) => {
        event.stopPropagation()
      }
    }
  }

  private renderP2POverlay(view: AppViewModel): void {
    if (!this.p2pOverlay) {
      return
    }

    if (view.mode !== 'p2p-host' && view.mode !== 'p2p-join') {
      if (this.p2pOverlayMode !== null) {
        this.p2pOverlay.innerHTML = ''
      }
      this.p2pOverlay.style.display = 'none'
      this.p2pOverlayMode = null
      this.setP2POverlayOpen(false)
      return
    }

    this.p2pOverlay.style.display = 'block'

    if (view.mode === 'p2p-host') {
      if (this.p2pOverlayMode !== 'host') {
        this.p2pOverlay.innerHTML = `
          <button id="phaser-settings-toggle" type="button">P2P Settings</button>
          <div class="phaser-settings-backdrop">
            <div class="panel phaser-settings-panel">
              <h3>P2P Host Signaling</h3>
              <button id="phaser-create-offer" type="button">Create Offer</button>
              <textarea id="phaser-offer" readonly></textarea>
              <textarea id="phaser-answer" placeholder="Paste remote answer"></textarea>
              <button id="phaser-accept-answer" type="button">Accept Answer</button>
              <button id="phaser-start" type="button">Start Game</button>
              <button id="phaser-settings-close" type="button">Close</button>
            </div>
          </div>
        `
        this.bindP2PSettingsModalControls()
        const createOfferButton = this.p2pOverlay.querySelector<HTMLButtonElement>('#phaser-create-offer')
        if (createOfferButton) {
          createOfferButton.onclick = () => {
            void this.controller?.createOffer()
          }
        }
        const acceptAnswerButton = this.p2pOverlay.querySelector<HTMLButtonElement>('#phaser-accept-answer')
        if (acceptAnswerButton) {
          acceptAnswerButton.onclick = () => {
            const value = this.p2pOverlay?.querySelector<HTMLTextAreaElement>('#phaser-answer')?.value ?? ''
            void this.controller?.acceptAnswer(value)
          }
        }
        const startButton = this.p2pOverlay.querySelector<HTMLButtonElement>('#phaser-start')
        if (startButton) {
          startButton.onclick = () => {
            this.controller?.startP2PGame()
          }
        }
        this.p2pOverlayMode = 'host'
        this.setP2POverlayOpen(false)
      }

      const offerField = this.p2pOverlay.querySelector<HTMLTextAreaElement>('#phaser-offer')
      if (offerField) {
        offerField.value = view.offer
      }
      return
    }

    if (this.p2pOverlayMode !== 'join') {
      this.p2pOverlay.innerHTML = `
        <button id="phaser-settings-toggle" type="button">P2P Settings</button>
        <div class="phaser-settings-backdrop">
          <div class="panel phaser-settings-panel">
            <h3>P2P Join Signaling</h3>
            <textarea id="phaser-join-offer" placeholder="Paste host offer"></textarea>
            <button id="phaser-create-answer" type="button">Create Answer</button>
            <textarea id="phaser-join-answer" readonly></textarea>
            <button id="phaser-settings-close" type="button">Close</button>
          </div>
        </div>
      `
      this.bindP2PSettingsModalControls()
      const createAnswerButton = this.p2pOverlay.querySelector<HTMLButtonElement>('#phaser-create-answer')
      if (createAnswerButton) {
        createAnswerButton.onclick = () => {
          const value = this.p2pOverlay?.querySelector<HTMLTextAreaElement>('#phaser-join-offer')?.value ?? ''
          void this.controller?.createAnswer(value)
        }
      }
      this.p2pOverlayMode = 'join'
      this.setP2POverlayOpen(false)
    }

    const answerField = this.p2pOverlay.querySelector<HTMLTextAreaElement>('#phaser-join-answer')
    if (answerField) {
      answerField.value = view.answer
    }
  }
}
