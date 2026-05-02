import Phaser from 'phaser'
import { resolvePlayLandDrop, resolveTargetedPlayLandAction } from '../../app/action-resolution'
import type { ControllerApi } from '../../app/controller'
import type { AppViewModel, GameUiState, Mode } from '../../app/types'
import type { AppRenderer } from '../types'

const BASE_WIDTH = 1280
const BASE_HEIGHT = 820
const MOBILE_BREAKPOINT = 960
const DEFAULT_TARGET_OPTIONS = 5
const BUTTON_TEXT_HORIZONTAL_PADDING = 24
const MIN_BUTTON_TEXT_WIDTH = 40
const SCROLL_WHEEL_MULTIPLIER = 0.8

interface CardStyle {
  fill: number
  stroke: number
  text: string
}

interface SceneLayout {
  width: number
  height: number
  isCompact: boolean
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

function buildLayout(width: number, height: number): SceneLayout {
  const isCompact = width < MOBILE_BREAKPOINT
  const margin = isCompact ? 14 : 24
  const titleFontSize = isCompact ? '22px' : '30px'
  const subtitleFontSize = isCompact ? '15px' : '18px'
  const bodyFontSize = isCompact ? '14px' : '16px'
  const smallFontSize = isCompact ? '12px' : '14px'
  const actionButtonWidth = isCompact ? 172 : 220
  const actionButtonHeight = isCompact ? 34 : 38
  const actionButtonGap = isCompact ? 8 : 10
  const cardWidth = isCompact ? 88 : 110
  const cardHeight = isCompact ? 120 : 145
  const cardGap = isCompact ? 102 : 130
  const summaryTopY = margin + (isCompact ? 66 : 94)
  const summaryBlockGap = isCompact ? 70 : 82
  const battlefieldTopY = summaryTopY + summaryBlockGap * 2 + (isCompact ? 24 : 16)
  const battlefieldHeight = isCompact ? 190 : 230
  const battlefieldTopRowY = battlefieldTopY + (isCompact ? 56 : 70)
  const battlefieldBottomRowY = battlefieldTopY + (isCompact ? 128 : 160)
  const handActorY = battlefieldTopY + battlefieldHeight + (isCompact ? 22 : 26)
  const handCardsY = handActorY + (isCompact ? 68 : 82)
  const controlsStartY = handActorY + (isCompact ? 24 : 32)
  const responseInfoY = controlsStartY
  const logTopY = handCardsY + cardHeight / 2 + (isCompact ? 16 : 22)
  const logHeaderHeight = isCompact ? 34 : 40
  const logBottomPadding = margin + 28
  const logHeight = Math.max(80, height - logTopY - logBottomPadding)
  const statusBottomOffset = isCompact ? 18 : 22
  const popupMaxWidth = Math.min(width - margin * 2, isCompact ? 460 : 700)
  const popupButtonHeight = isCompact ? 38 : 44

  return {
    width,
    height,
    isCompact,
    margin,
    titleFontSize,
    subtitleFontSize,
    bodyFontSize,
    smallFontSize,
    headerTop: margin,
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
  private currentLayout: SceneLayout = buildLayout(BASE_WIDTH, BASE_HEIGHT)
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
      this.renderView(this.rendererRef.currentView)
    })

    this.renderView(this.rendererRef.currentView)
  }

  private updateLayout(): void {
    const width = this.scale.width || BASE_WIDTH
    const height = this.scale.height || BASE_HEIGHT
    this.currentLayout = buildLayout(width, height)
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
      this.logCollapsed = this.currentLayout.isCompact
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
      wordWrap: { width: Math.max(MIN_BUTTON_TEXT_WIDTH, width - BUTTON_TEXT_HORIZONTAL_PADDING) },
    }).setOrigin(0.5)
    const button = this.add.container(x, y, [background, text])
    button.setSize(width, height)
    button.setInteractive({ useHandCursor: true })
    button.on('pointerup', onClick)
    return button
  }

  private renderLobby(): void {
    const left = this.currentLayout.margin
    const top = this.currentLayout.margin

    this.rootContainer?.add(this.add.text(left, top, 'Basic Land Game (Phaser Renderer)', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.titleFontSize,
    }))
    this.rootContainer?.add(this.add.text(left, top + 44, 'Land-only 2-player game with local AI and optional P2P mode.', {
      color: '#9db0d9',
      fontSize: this.currentLayout.subtitleFontSize,
      wordWrap: { width: this.currentLayout.width - left * 2 },
    }))

    const modes: Array<{ mode: Mode; label: string }> = [
      { mode: 'local-hvh', label: 'Local Human vs Human' },
      { mode: 'local-hvai', label: 'Local Human vs AI' },
      { mode: 'local-aivai', label: 'Local AI vs AI' },
      { mode: 'p2p-host', label: 'P2P Host' },
      { mode: 'p2p-join', label: 'P2P Join' },
    ]

    const buttonWidth = Math.min(this.currentLayout.width - left * 2, this.currentLayout.isCompact ? 330 : 360)
    const modeStartY = top + 120
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
    this.rootContainer?.add(this.add.text(left, this.currentLayout.headerTop + (this.currentLayout.isCompact ? 30 : 40), game.winnerText, {
      color: '#f7d56b',
      fontSize: this.currentLayout.subtitleFontSize,
    }))

    this.rootContainer?.add(this.createButton('Back to Lobby', headerRight, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight / 2, () => {
      this.rendererRef.controller?.backToLobby()
    }, this.currentLayout.actionButtonWidth, this.currentLayout.actionButtonHeight))
    this.rootContainer?.add(this.createButton('Rematch', headerRight, this.currentLayout.headerTop + this.currentLayout.actionButtonHeight + this.currentLayout.actionButtonGap + this.currentLayout.actionButtonHeight / 2, () => {
      this.rendererRef.controller?.rematch()
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
    ], { color: '#c6d4ef', fontSize: this.currentLayout.bodyFontSize })
    this.rootContainer?.add(topSummary)

    const bottomSummary = this.add.text(this.currentLayout.margin, this.currentLayout.summaryTopY + this.currentLayout.summaryBlockGap, [
      `Bottom Board • Player ${bottomPlayerIndex + 1} (${view.controllers[bottomPlayerIndex]})`,
      `Hand: ${bottomPlayer.handCount} • Deck: ${bottomPlayer.deckCount} • Graveyard: ${bottomPlayer.graveyardCount}`,
      `Battlefield: ${bottomPlayer.battlefield.map((entry) => entry.name).join(', ') || 'None'}`,
    ], { color: '#c6d4ef', fontSize: this.currentLayout.bodyFontSize })
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

    this.rootContainer?.add(this.add.text(this.currentLayout.margin + 8, this.currentLayout.battlefieldTopY - 28, title, {
      color: '#e5ecf5',
      fontSize: this.currentLayout.subtitleFontSize,
    }))

    const active = game.actor
    const topPlayerIndex = active === 0 ? 1 : 0
    const bottomPlayerIndex = active

    this.rootContainer?.add(this.add.text(this.currentLayout.margin + 8, this.currentLayout.battlefieldTopRowY - this.currentLayout.cardHeight / 2 - 18, `Top: Player ${topPlayerIndex + 1}`, {
      color: '#9db0d9',
      fontSize: this.currentLayout.smallFontSize,
    }))
    this.rootContainer?.add(this.add.text(this.currentLayout.margin + 8, this.currentLayout.battlefieldBottomRowY - this.currentLayout.cardHeight / 2 - 18, `Bottom (active): Player ${bottomPlayerIndex + 1}`, {
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

      const controlsX = this.currentLayout.width - this.currentLayout.margin - (this.currentLayout.isCompact ? 210 : 230)
      const buttonWidth = this.currentLayout.isCompact ? 400 : 440
      const buttonHeight = this.currentLayout.isCompact ? 38 : 42
      const startY = this.currentLayout.responseInfoY + 44

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
    const headerWidth = this.currentLayout.isCompact ? 180 : 210
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
    const popupWidth = this.currentLayout.popupMaxWidth
    const buttonWidth = popupWidth - popupPadding * 2
    const titleHeight = this.currentLayout.isCompact ? 44 : 56
    const optionGap = this.currentLayout.isCompact ? 8 : 10
    const cancelHeight = this.currentLayout.popupButtonHeight
    const showAllButtonHeight = hasHiddenOptions ? cancelHeight : 0
    const footerGap = hasHiddenOptions ? 8 : 0
    const footerHeight = cancelHeight + footerGap + showAllButtonHeight
    const optionsHeightWanted = optionCount > 0
      ? optionCount * this.currentLayout.popupButtonHeight + Math.max(0, optionCount - 1) * optionGap
      : this.currentLayout.popupButtonHeight
    const desiredHeight = titleHeight + optionsHeightWanted + footerHeight + popupPadding * 2 + 20
    const maxHeight = this.currentLayout.height - this.currentLayout.margin * 2
    const popupHeight = Math.min(desiredHeight, maxHeight)

    const overlay = this.add.container(this.currentLayout.width / 2, this.currentLayout.height / 2)
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.pendingTargetPicker === overlay) {
        this.pendingTargetPicker = null
      }
    })

    const backdrop = this.add.rectangle(0, 0, popupWidth, popupHeight, 0x000000, 0.82).setStrokeStyle(2, 0x4f6caa)
    overlay.add(backdrop)
    overlay.add(this.add.text(0, -popupHeight / 2 + popupPadding + titleHeight / 2, 'Choose target', {
      color: '#e5ecf5',
      fontSize: this.currentLayout.subtitleFontSize,
    }).setOrigin(0.5))

    const optionsTopY = -popupHeight / 2 + popupPadding + titleHeight
    const footerTopY = popupHeight / 2 - popupPadding - footerHeight
    const optionsAreaHeight = Math.max(48, footerTopY - optionsTopY - 10)
    const optionsViewportY = optionsTopY + optionsAreaHeight / 2

    const optionsViewportBackground = this.add.rectangle(0, optionsViewportY, buttonWidth, optionsAreaHeight, 0x0f1a3b, 0.4)
      .setStrokeStyle(1, 0x365092)
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
      const onWheel = (pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
        const localX = pointer.worldX - overlay.x
        const localY = pointer.worldY - overlay.y
        const withinX = localX >= -buttonWidth / 2 && localX <= buttonWidth / 2
        const withinY = localY >= optionsTopY && localY <= optionsTopY + optionsAreaHeight
        if (withinX && withinY) {
          applyScroll(deltaY * SCROLL_WHEEL_MULTIPLIER)
        }
      }

      this.input.on('wheel', onWheel)
      overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
        this.input.off('wheel', onWheel)
      })

      overlay.add(this.add.text(buttonWidth / 2 - 10, optionsTopY + optionsAreaHeight / 2, '⇵', {
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
      const showAllY = cancelY + cancelHeight / 2 + 8 + showAllButtonHeight / 2
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

  mount(container: HTMLElement, controller: ControllerApi): void {
    this.container = container
    this.controller = controller

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
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      parent: canvasHost,
      backgroundColor: '#0b1020',
      scene: [this.scene],
      scale: {
        mode: Phaser.Scale.FIT,
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

    this.game?.destroy(true)
    this.game = null
    this.scene = null

    if (this.container) {
      this.container.innerHTML = ''
    }
    this.container = null
    this.controller = null
    this.currentView = null
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
      return
    }

    this.p2pOverlay.style.display = 'block'

    if (view.mode === 'p2p-host') {
      if (this.p2pOverlayMode !== 'host') {
        this.p2pOverlay.innerHTML = `
          <div class="panel">
            <h3>P2P Host Signaling</h3>
            <button id="phaser-create-offer">Create Offer</button>
            <textarea id="phaser-offer" readonly></textarea>
            <textarea id="phaser-answer" placeholder="Paste remote answer"></textarea>
            <button id="phaser-accept-answer">Accept Answer</button>
            <button id="phaser-start">Start Game</button>
          </div>
        `
        this.p2pOverlay.querySelector('#phaser-create-offer')?.addEventListener('click', () => {
          void this.controller?.createOffer()
        })
        this.p2pOverlay.querySelector('#phaser-accept-answer')?.addEventListener('click', () => {
          const value = this.p2pOverlay?.querySelector<HTMLTextAreaElement>('#phaser-answer')?.value ?? ''
          void this.controller?.acceptAnswer(value)
        })
        this.p2pOverlay.querySelector('#phaser-start')?.addEventListener('click', () => {
          this.controller?.startP2PGame()
        })
        this.p2pOverlayMode = 'host'
      }

      const offerField = this.p2pOverlay.querySelector<HTMLTextAreaElement>('#phaser-offer')
      if (offerField) {
        offerField.value = view.offer
      }
      return
    }

    if (this.p2pOverlayMode !== 'join') {
      this.p2pOverlay.innerHTML = `
        <div class="panel">
          <h3>P2P Join Signaling</h3>
          <textarea id="phaser-join-offer" placeholder="Paste host offer"></textarea>
          <button id="phaser-create-answer">Create Answer</button>
          <textarea id="phaser-join-answer" readonly></textarea>
        </div>
      `
      this.p2pOverlay.querySelector('#phaser-create-answer')?.addEventListener('click', () => {
        const value = this.p2pOverlay?.querySelector<HTMLTextAreaElement>('#phaser-join-offer')?.value ?? ''
        void this.controller?.createAnswer(value)
      })
      this.p2pOverlayMode = 'join'
    }

    const answerField = this.p2pOverlay.querySelector<HTMLTextAreaElement>('#phaser-join-answer')
    if (answerField) {
      answerField.value = view.answer
    }
  }
}
