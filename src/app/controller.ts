import { chooseAiAction } from '../game/ai'
import { applyAction, canAct, createInitialGame } from '../game/engine'
import type { GameAction } from '../game/types'
import { P2PLink } from '../net/p2p'
import { buildViewModel } from './view-model'
import type { AppState, AppViewModel, Mode, RendererKind } from './types'

function activeActor(game: NonNullable<AppState['game']>): number {
  if (game.phase === 'respond' && game.pendingLandPlay) {
    return game.pendingLandPlay.actor === 0 ? 1 : 0
  }
  return game.currentPlayer
}

function isSeedPayload(payload: unknown): payload is { seed: number } {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  return typeof (payload as { seed?: unknown }).seed === 'number'
}

function isGameAction(payload: unknown): payload is GameAction {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  const action = payload as {
    type?: unknown
    actor?: unknown
    cardId?: unknown
    effectTargetId?: unknown
    discardCardId?: unknown
  }
  if (typeof action.type !== 'string' || typeof action.actor !== 'number') {
    return false
  }
  if (action.type === 'play_land') {
    if (typeof action.cardId !== 'string') {
      return false
    }
    return action.effectTargetId === undefined || typeof action.effectTargetId === 'string'
  }
  if (action.type === 'counter_land') {
    return action.discardCardId === undefined || typeof action.discardCardId === 'string'
  }
  return action.type === 'end_turn' || action.type === 'pass_response'
}

export interface ControllerApi {
  subscribe(listener: (view: AppViewModel) => void): () => void
  getViewModel(): AppViewModel
  startGame(mode: Mode): void
  backToLobby(): void
  createOffer(): Promise<void>
  acceptAnswer(answer: string): Promise<void>
  createAnswer(offer: string): Promise<void>
  startP2PGame(): void
  submitAction(action: GameAction): void
  rematch(): void
}

export class AppController implements ControllerApi {
  private state: AppState
  private listeners = new Set<(view: AppViewModel) => void>()
  private p2p: P2PLink | null = null

  constructor(renderer: RendererKind) {
    this.state = {
      mode: null,
      game: null,
      controllers: ['human', 'human'],
      seed: Date.now(),
      offer: '',
      answer: '',
      status: '',
      renderer,
    }
  }

  subscribe(listener: (view: AppViewModel) => void): () => void {
    this.listeners.add(listener)
    listener(this.getViewModel())
    return () => {
      this.listeners.delete(listener)
    }
  }

  getViewModel(): AppViewModel {
    return buildViewModel(this.state, this.p2p?.isConnected() ?? false)
  }

  private notify(): void {
    const view = this.getViewModel()
    for (const listener of this.listeners) {
      listener(view)
    }
  }

  private setupP2P(): void {
    this.p2p?.close()
    this.p2p = new P2PLink((packet) => {
      if (packet.type === 'start') {
        if (!isSeedPayload(packet.payload)) {
          this.state.status = 'Ignored invalid start payload from peer.'
          this.notify()
          return
        }
        this.state.seed = packet.payload.seed
        this.state.game = createInitialGame(packet.payload.seed)
        this.state.status = 'Remote game started.'
        this.notify()
        return
      }

      if (packet.type === 'action' && this.state.game) {
        if (!isGameAction(packet.payload)) {
          this.state.status = 'Ignored invalid action payload from peer.'
          this.notify()
          return
        }
        this.state.game = applyAction(this.state.game, packet.payload)
        this.notify()
        this.scheduleAiIfNeeded()
        return
      }

      if (packet.type === 'rematch') {
        if (!isSeedPayload(packet.payload)) {
          this.state.status = 'Ignored invalid rematch payload from peer.'
          this.notify()
          return
        }
        this.state.seed = packet.payload.seed
        this.state.game = createInitialGame(packet.payload.seed)
        this.state.status = 'Rematch started.'
        this.notify()
      }
    })
  }

  private scheduleAiIfNeeded(): void {
    if (!this.state.game || this.state.game.phase === 'gameOver') {
      return
    }

    const actor = activeActor(this.state.game)
    const control = this.state.controllers[actor]
    if (control !== 'ai' || !canAct(this.state.game, actor)) {
      return
    }

    setTimeout(() => {
      if (!this.state.game) {
        return
      }
      const action = chooseAiAction(this.state.game, actor)
      if (!action) {
        return
      }
      this.submitAction(action)
    }, 350)
  }

  startGame(mode: Mode): void {
    this.state.mode = mode
    this.state.seed = Date.now()
    this.state.game = createInitialGame(this.state.seed)

    if (mode === 'local-hvh') {
      this.state.controllers = ['human', 'human']
      this.state.status = 'Local Human vs Human game started.'
    } else if (mode === 'local-hvai') {
      this.state.controllers = ['human', 'ai']
      this.state.status = 'Local Human vs AI game started.'
    } else if (mode === 'local-aivai') {
      this.state.controllers = ['ai', 'ai']
      this.state.status = 'Local AI vs AI simulation started.'
    } else if (mode === 'p2p-host') {
      this.setupP2P()
      this.state.controllers = ['human', 'remote']
      this.state.status = 'Host created. Exchange offer/answer to connect.'
      this.state.offer = ''
      this.state.answer = ''
    } else {
      this.setupP2P()
      this.state.controllers = ['remote', 'human']
      this.state.status = 'Joiner ready. Paste offer to generate answer.'
      this.state.offer = ''
      this.state.answer = ''
    }

    this.notify()
    this.scheduleAiIfNeeded()
  }

  backToLobby(): void {
    this.p2p?.close()
    this.p2p = null
    this.state.mode = null
    this.state.game = null
    this.state.status = ''
    this.state.offer = ''
    this.state.answer = ''
    this.notify()
  }

  async createOffer(): Promise<void> {
    if (!this.p2p) {
      return
    }
    try {
      this.state.offer = await this.p2p.createOffer()
      this.state.status = 'Offer ready. Share with joiner.'
    } catch {
      this.state.status = 'Failed to create offer. Check connection and try again.'
    }
    this.notify()
  }

  async acceptAnswer(answer: string): Promise<void> {
    if (!this.p2p || !answer.trim()) {
      return
    }
    try {
      await this.p2p.acceptAnswer(answer.trim())
      this.state.status = 'Answer accepted. Data channel should connect shortly.'
    } catch {
      this.state.status = 'Failed to accept answer. Verify the pasted answer and retry.'
    }
    this.notify()
  }

  async createAnswer(offer: string): Promise<void> {
    if (!this.p2p || !offer.trim()) {
      return
    }
    try {
      this.state.answer = await this.p2p.acceptOffer(offer.trim())
      this.state.status = 'Answer created. Send it to host.'
    } catch {
      this.state.status = 'Failed to create answer. Verify the pasted offer and retry.'
    }
    this.notify()
  }

  startP2PGame(): void {
    if (!this.state.game) {
      return
    }
    this.p2p?.send('start', { seed: this.state.seed })
    this.state.status = 'P2P game started.'
    this.notify()
  }

  submitAction(action: GameAction): void {
    if (!this.state.game) {
      return
    }
    this.state.game = applyAction(this.state.game, action)
    if (this.state.mode === 'p2p-host' || this.state.mode === 'p2p-join') {
      this.p2p?.send('action', action)
    }
    this.notify()
    this.scheduleAiIfNeeded()
  }

  rematch(): void {
    if (!this.state.mode) {
      return
    }
    this.state.seed = Date.now()
    this.state.game = createInitialGame(this.state.seed)
    if (this.state.mode === 'p2p-host' || this.state.mode === 'p2p-join') {
      this.p2p?.send('rematch', { seed: this.state.seed })
    }
    this.state.status = 'Rematch started.'
    this.notify()
    this.scheduleAiIfNeeded()
  }
}
