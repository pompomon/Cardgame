import Phaser from 'phaser'
import { resolvePlayLandDrop, resolveTargetedPlayLandAction } from '../../app/action-resolution'
import type { ControllerApi } from '../../app/controller'
import type { AppViewModel, GameUiState, Mode } from '../../app/types'
import type { AppRenderer } from '../types'

const WIDTH = 1280
const HEIGHT = 820

class CardgameScene extends Phaser.Scene {
  private readonly rendererRef: PhaserRenderer
  private rootContainer: Phaser.GameObjects.Container | null = null
  private statusText: Phaser.GameObjects.Text | null = null
  private battlefieldDropZone: Phaser.GameObjects.Zone | null = null
  private pendingTargetPicker: Phaser.GameObjects.Container | null = null

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
    this.statusText = this.add.text(24, HEIGHT - 34, '', { color: '#9db0d9', fontSize: '16px' })

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

    this.renderView(this.rendererRef.currentView)
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.setText(message)
    }
  }

  private clearRoot(): void {
    this.pendingTargetPicker = null
    this.battlefieldDropZone = null
    this.rootContainer?.removeAll(true)
  }

  renderView(view: AppViewModel | null): void {
    this.clearRoot()
    if (!view || !this.rootContainer) {
      return
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
      fontSize: '16px',
      align: 'center',
    }).setOrigin(0.5)
    const button = this.add.container(x, y, [background, text])
    button.setSize(width, height)
    button.setInteractive({ useHandCursor: true })
    button.on('pointerup', onClick)
    return button
  }

  private renderLobby(): void {
    this.rootContainer?.add(this.add.text(24, 24, 'Basic Land Game (Phaser Renderer)', { color: '#e5ecf5', fontSize: '34px' }))
    this.rootContainer?.add(this.add.text(24, 70, 'Land-only 2-player game with local AI and optional P2P mode.', { color: '#9db0d9', fontSize: '18px' }))

    const modes: Array<{ mode: Mode; label: string }> = [
      { mode: 'local-hvh', label: 'Local Human vs Human' },
      { mode: 'local-hvai', label: 'Local Human vs AI' },
      { mode: 'local-aivai', label: 'Local AI vs AI' },
      { mode: 'p2p-host', label: 'P2P Host' },
      { mode: 'p2p-join', label: 'P2P Join' },
    ]

    modes.forEach((entry, index) => {
      this.rootContainer?.add(
        this.createButton(entry.label, 170, 150 + index * 58, () => {
          this.rendererRef.controller?.startGame(entry.mode)
        }),
      )
    })

    this.rootContainer?.add(
      this.createButton('Switch to DOM renderer', 190, 500, () => {
        window.location.search = '?renderer=dom'
      }, 280),
    )
  }

  private renderGame(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }
    this.rootContainer?.add(this.add.text(24, 16, `Turn ${game.turn} • Phase: ${game.phase}`, { color: '#e5ecf5', fontSize: '28px' }))
    this.rootContainer?.add(this.add.text(24, 52, game.winnerText, { color: '#f7d56b', fontSize: '18px' }))

    this.rootContainer?.add(this.createButton('Back to Lobby', WIDTH - 160, 30, () => this.rendererRef.controller?.backToLobby(), 220, 38))
    this.rootContainer?.add(this.createButton('Rematch', WIDTH - 160, 76, () => this.rendererRef.controller?.rematch(), 220, 38))

    this.renderPlayerSummaries(view)
    this.renderBattlefield(game)
    this.renderHandAndControls(game)
  }

  private renderPlayerSummaries(view: AppViewModel): void {
    const p1 = view.game?.players[0]
    const p2 = view.game?.players[1]
    if (!p1 || !p2) {
      return
    }

    const p1Text = this.add.text(24, 110, [
      `Player 1 (${view.controllers[0]})`,
      `Hand: ${p1.handCount} • Deck: ${p1.deckCount} • Graveyard: ${p1.graveyardCount}`,
      `Battlefield: ${p1.battlefield.map((entry) => entry.name).join(', ') || 'None'}`,
    ], { color: '#c6d4ef', fontSize: '16px' })
    this.rootContainer?.add(p1Text)

    const p2Text = this.add.text(24, 190, [
      `Player 2 (${view.controllers[1]})`,
      `Hand: ${p2.handCount} • Deck: ${p2.deckCount} • Graveyard: ${p2.graveyardCount}`,
      `Battlefield: ${p2.battlefield.map((entry) => entry.name).join(', ') || 'None'}`,
    ], { color: '#c6d4ef', fontSize: '16px' })
    this.rootContainer?.add(p2Text)

    const log = view.game?.log ?? []
    const logText = this.add.text(24, 605, ['Replay Log:', ...log], { color: '#9db0d9', fontSize: '14px' })
    this.rootContainer?.add(logText)
  }

  private renderBattlefield(game: GameUiState): void {
    const zoneBackground = this.add.rectangle(WIDTH / 2, 360, WIDTH - 60, 220, 0x0f1a3b).setStrokeStyle(2, 0x365092)
    this.rootContainer?.add(zoneBackground)

    const zoneTitle = this.add.text(40, 255, 'Battlefield (drop hand card here)', { color: '#e5ecf5', fontSize: '18px' })
    this.rootContainer?.add(zoneTitle)

    const dropZone = this.add.zone(WIDTH / 2, 360, WIDTH - 60, 220)
    dropZone.setRectangleDropZone(WIDTH - 60, 220)
    dropZone.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.battlefieldDropZone === dropZone) {
        this.battlefieldDropZone = null
      }
    })
    this.battlefieldDropZone = dropZone
    this.rootContainer?.add(dropZone)

    let x = 90
    for (const card of game.players[0].battlefield) {
      this.rootContainer?.add(this.renderStaticCard(x, 330, card.name, '#9dd7ff'))
      x += 130
    }

    x = 90
    for (const card of game.players[1].battlefield) {
      this.rootContainer?.add(this.renderStaticCard(x, 420, card.name, '#ffc99d'))
      x += 130
    }
  }

  private renderStaticCard(x: number, y: number, label: string, textColor: string): Phaser.GameObjects.Container {
    const rect = this.add.rectangle(0, 0, 110, 145, 0x132652).setStrokeStyle(1, 0x4f6caa)
    const text = this.add.text(0, 0, label, { color: textColor, fontSize: '16px', align: 'center', wordWrap: { width: 100 } }).setOrigin(0.5)
    return this.add.container(x, y, [rect, text])
  }

  private renderHandAndControls(game: GameUiState): void {
    const actor = game.actor
    const actorCards = game.players[actor].handCards
    const canDrag = game.canInput && game.phase === 'main'

    this.rootContainer?.add(this.add.text(40, 470, `Actor: Player ${actor + 1} (${game.actorControl})`, { color: '#f0f4ff', fontSize: '18px' }))

    actorCards.forEach((card, index) => {
      const x = 90 + index * 130
      const y = 550
      const cardObject = this.renderStaticCard(x, y, card.name, '#ffffff')
      cardObject.setData('cardId', card.id)
      cardObject.setData('originX', x)
      cardObject.setData('originY', y)
      if (canDrag && game.legal.playLandByCard[card.id]) {
        cardObject.setSize(110, 145)
        cardObject.setInteractive({ draggable: true, useHandCursor: true })
        this.input.setDraggable(cardObject)
      }
      this.rootContainer?.add(cardObject)
    })

    if (game.canInput && game.phase === 'respond') {
      this.rootContainer?.add(this.add.text(560, 480, `Opponent played ${game.pendingLandName ?? 'a land'}.`, { color: '#f0f4ff', fontSize: '16px' }))
      game.legal.counterOptions.forEach((option, index) => {
        this.rootContainer?.add(this.createButton(option.label, 820, 530 + index * 48, () => {
          this.rendererRef.controller?.submitAction(option.action)
        }, 420, 42))
      })
      if (game.legal.canPassResponse) {
        this.rootContainer?.add(this.createButton('Pass', 820, 530 + game.legal.counterOptions.length * 48, () => {
          this.rendererRef.controller?.submitAction({ type: 'pass_response', actor: game.actor })
        }, 420, 42))
      }
      return
    }

    if (game.canInput && game.legal.canEndTurn && game.phase === 'main') {
      this.rootContainer?.add(this.createButton('End Turn', 1110, 550, () => {
        this.rendererRef.controller?.submitAction({ type: 'end_turn', actor: game.actor })
      }, 220, 44))
    }
  }

  private showTargetPicker(
    game: GameUiState,
    cardId: string,
    options: Array<{ effectTargetId?: string; label: string }>,
  ): void {
    this.pendingTargetPicker?.destroy(true)

    const overlay = this.add.container(WIDTH / 2, HEIGHT / 2)
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.pendingTargetPicker === overlay) {
        this.pendingTargetPicker = null
      }
    })
    const backdrop = this.add.rectangle(0, 0, 660, 360, 0x000000, 0.82).setStrokeStyle(2, 0x4f6caa)
    overlay.add(backdrop)
    overlay.add(this.add.text(0, -148, 'Choose target', { color: '#e5ecf5', fontSize: '24px' }).setOrigin(0.5))

    options.forEach((option, index) => {
      const button = this.createButton(option.label, 0, -84 + index * 56, () => {
        const action = resolveTargetedPlayLandAction(game, cardId, option.effectTargetId)
        if (action) {
          this.rendererRef.controller?.submitAction(action)
        }
        overlay.destroy(true)
      }, 600, 44)
      overlay.add(button)
    })

    const cancelButton = this.createButton('Cancel', 0, 130, () => {
      overlay.destroy(true)
    }, 220, 42)
    overlay.add(cancelButton)

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
      width: WIDTH,
      height: HEIGHT,
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
      this.p2pOverlay.innerHTML = ''
      this.p2pOverlay.style.display = 'none'
      return
    }

    this.p2pOverlay.style.display = 'block'

    if (view.mode === 'p2p-host') {
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
      const offerField = this.p2pOverlay.querySelector<HTMLTextAreaElement>('#phaser-offer')
      if (offerField) {
        offerField.value = view.offer
      }

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
      return
    }

    this.p2pOverlay.innerHTML = `
      <div class="panel">
        <h3>P2P Join Signaling</h3>
        <textarea id="phaser-join-offer" placeholder="Paste host offer"></textarea>
        <button id="phaser-create-answer">Create Answer</button>
        <textarea id="phaser-join-answer" readonly></textarea>
      </div>
    `
    const answerField = this.p2pOverlay.querySelector<HTMLTextAreaElement>('#phaser-join-answer')
    if (answerField) {
      answerField.value = view.answer
    }

    this.p2pOverlay.querySelector('#phaser-create-answer')?.addEventListener('click', () => {
      const value = this.p2pOverlay?.querySelector<HTMLTextAreaElement>('#phaser-join-offer')?.value ?? ''
      void this.controller?.createAnswer(value)
    })
  }
}
