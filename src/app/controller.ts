import { chooseAiAction } from '../game/ai'
import { applyAction, canAct, createInitialGame, getLegalActions } from '../game/engine'
import type { GameAction, GameState } from '../game/types'
import { P2PLink } from '../net/p2p'
import { activeActor } from './active-actor'
import {
  appendGameRecordStep,
  createGameRecord,
  parseGameRecordJson,
  serializeGameRecord,
  snapshotFromRecord,
} from './game-recording'
import { buildViewModel } from './view-model'
import type { AppState, AppViewModel, Mode, RendererKind } from './types'

const RECORDING_STORAGE_KEY = 'cardgame.saved-recording'
const REPLAY_TICK_MS = 700

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

function isSameAction(left: GameAction, right: GameAction): boolean {
  if (left.type !== right.type || left.actor !== right.actor) {
    return false
  }
  if (left.type === 'play_land' && right.type === 'play_land') {
    return left.cardId === right.cardId && left.effectTargetId === right.effectTargetId
  }
  if (left.type === 'counter_land' && right.type === 'counter_land') {
    return left.discardCardId === right.discardCardId
  }
  return true
}

function isLegalActionForState(state: GameState, action: GameAction): boolean {
  if (!canAct(state, action.actor)) {
    return false
  }
  return getLegalActions(state, action.actor).some((candidate) => isSameAction(candidate, action))
}

function isP2PMode(mode: Mode): boolean {
  return mode === 'p2p-host' || mode === 'p2p-join'
}

function normalizeImportedMode(mode: Mode): Mode {
  return isP2PMode(mode) ? 'local-hvh' : mode
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
  exportRecordingJson(): string | null
  importRecordingJson(json: string): void
  saveRecordingToLocalStorage(): void
  loadRecordingFromLocalStorage(): void
  reportStatus(message: string): void
  startReplay(): void
  pauseReplay(): void
  stepReplay(delta: number): void
  jumpReplayToEnd(): void
  exitReplay(): void
}

export class AppController implements ControllerApi {
  private state: AppState
  private listeners = new Set<(view: AppViewModel) => void>()
  private p2p: P2PLink | null = null
  private replayInterval: ReturnType<typeof setInterval> | null = null
  private aiTimeout: ReturnType<typeof setTimeout> | null = null

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
      recording: null,
      replay: null,
      hasSavedRecording: this.hasSavedRecording(),
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

  private hasSavedRecording(): boolean {
    try {
      const value = localStorage.getItem(RECORDING_STORAGE_KEY)
      return typeof value === 'string' && value.length > 0
    } catch {
      return false
    }
  }

  private refreshSavedRecordingFlag(): void {
    this.state.hasSavedRecording = this.hasSavedRecording()
  }

  private stopReplayInterval(): void {
    if (!this.replayInterval) {
      return
    }
    clearInterval(this.replayInterval)
    this.replayInterval = null
  }

  private clearAiTimeout(): void {
    if (!this.aiTimeout) {
      return
    }
    clearTimeout(this.aiTimeout)
    this.aiTimeout = null
  }

  private isReplayActive(): boolean {
    return this.state.replay !== null
  }

  private clearReplay(): void {
    this.stopReplayInterval()
    this.state.replay = null
  }

  private initializeRecording(mode: Mode): void {
    if (!this.state.game) {
      this.state.recording = null
      return
    }
    this.state.recording = createGameRecord(
      this.state.seed,
      mode,
      this.state.controllers,
      this.state.game,
    )
  }

  private appendRecordingStep(action: GameAction, nextState: GameState, source: 'human' | 'ai' | 'remote'): void {
    if (!this.state.recording) {
      return
    }
    this.state.recording = appendGameRecordStep(
      this.state.recording,
      action,
      nextState,
      source,
    )
  }

  private applyReplayStep(nextStep: number): void {
    if (!this.state.replay) {
      return
    }

    const boundedStep = Math.max(0, Math.min(nextStep, this.state.replay.record.timeline.length))
    this.state.replay = {
      ...this.state.replay,
      step: boundedStep,
      isPlaying: boundedStep < this.state.replay.record.timeline.length && this.state.replay.isPlaying,
    }
    this.state.game = snapshotFromRecord(this.state.replay.record, boundedStep)

    if (boundedStep >= this.state.replay.record.timeline.length) {
      this.stopReplayInterval()
      this.state.replay = { ...this.state.replay, isPlaying: false }
      this.state.status = 'Replay reached final state.'
    } else {
      this.state.status = `Replay step ${boundedStep}/${this.state.replay.record.timeline.length}.`
    }
  }

  private setupReplayInterval(): void {
    this.stopReplayInterval()
    this.replayInterval = setInterval(() => {
      if (!this.state.replay || !this.state.replay.isPlaying) {
        return
      }
      this.applyReplayStep(this.state.replay.step + 1)
      this.notify()
    }, REPLAY_TICK_MS)
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
        if (this.state.mode) {
          this.initializeRecording(this.state.mode)
        }
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
        this.applyRecordedAction(packet.payload, 'remote', false)
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
        if (this.state.mode) {
          this.initializeRecording(this.state.mode)
        }
        this.state.status = 'Rematch started.'
        this.notify()
      }
    })
  }

  private scheduleAiIfNeeded(): void {
    this.clearAiTimeout()
    if (!this.state.game || this.state.game.phase === 'gameOver' || this.isReplayActive()) {
      return
    }

    const actor = activeActor(this.state.game)
    const control = this.state.controllers[actor]
    if (control !== 'ai' || !canAct(this.state.game, actor)) {
      return
    }

    this.aiTimeout = setTimeout(() => {
      this.aiTimeout = null
      if (!this.state.game || this.isReplayActive()) {
        return
      }
      const actor = activeActor(this.state.game)
      if (this.state.controllers[actor] !== 'ai') {
        return
      }
      const action = chooseAiAction(this.state.game, actor)
      if (!action) {
        return
      }
      if (!isLegalActionForState(this.state.game, action)) {
        return
      }
      this.applyRecordedAction(action, 'ai', true)
    }, 350)
  }

  private applyRecordedAction(action: GameAction, source: 'human' | 'ai' | 'remote', broadcastToPeer: boolean): void {
    if (!this.state.game || this.isReplayActive()) {
      return
    }
    if (!isLegalActionForState(this.state.game, action)) {
      if (source === 'remote') {
        this.state.status = 'Ignored illegal action from peer.'
        this.notify()
      }
      return
    }
    const next = applyAction(this.state.game, action)
    this.state.game = next

    if (broadcastToPeer && (this.state.mode === 'p2p-host' || this.state.mode === 'p2p-join')) {
      this.p2p?.send('action', action)
    }

    this.appendRecordingStep(action, next, source)
    this.notify()
    this.scheduleAiIfNeeded()
  }

  startGame(mode: Mode): void {
    this.stopReplayInterval()
    this.clearAiTimeout()
    this.state.replay = null
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

    this.initializeRecording(mode)
    this.notify()
    this.scheduleAiIfNeeded()
  }

  backToLobby(): void {
    this.stopReplayInterval()
    this.clearAiTimeout()
    this.p2p?.close()
    this.p2p = null
    this.state.mode = null
    this.state.game = null
    this.state.replay = null
    this.state.status = ''
    this.state.offer = ''
    this.state.answer = ''
    this.notify()
  }

  async createOffer(): Promise<void> {
    if (!this.p2p || this.isReplayActive()) {
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
    if (!this.p2p || !answer.trim() || this.isReplayActive()) {
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
    if (!this.p2p || !offer.trim() || this.isReplayActive()) {
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
    if (!this.state.game || this.isReplayActive()) {
      return
    }
    this.p2p?.send('start', { seed: this.state.seed })
    this.state.status = 'P2P game started.'
    this.notify()
  }

  submitAction(action: GameAction): void {
    this.applyRecordedAction(action, 'human', true)
  }

  rematch(): void {
    if (!this.state.mode || this.isReplayActive()) {
      return
    }
    this.clearAiTimeout()
    this.state.seed = Date.now()
    this.state.game = createInitialGame(this.state.seed)
    this.initializeRecording(this.state.mode)
    if (this.state.mode === 'p2p-host' || this.state.mode === 'p2p-join') {
      this.p2p?.send('rematch', { seed: this.state.seed })
    }
    this.state.status = 'Rematch started.'
    this.notify()
    this.scheduleAiIfNeeded()
  }

  exportRecordingJson(): string | null {
    if (!this.state.recording) {
      this.state.status = 'No game recording available to export.'
      this.notify()
      return null
    }
    this.state.status = 'Game recording prepared for export.'
    this.notify()
    return serializeGameRecord(this.state.recording)
  }

  importRecordingJson(json: string): void {
    this.stopReplayInterval()
    this.clearAiTimeout()
    const parsed = parseGameRecordJson(json)
    if (!parsed.ok) {
      if (this.state.replay) {
        this.state.replay = {
          ...this.state.replay,
          isPlaying: false,
        }
      }
      this.state.status = `Failed to load recording: ${parsed.error}`
      this.notify()
      return
    }

    this.p2p?.close()
    this.p2p = null
    this.state.recording = parsed.record
    this.state.replay = {
      record: parsed.record,
      step: 0,
      isPlaying: false,
    }
    this.state.mode = normalizeImportedMode(parsed.record.metadata.mode)
    this.state.seed = parsed.record.metadata.seed
    const [controller0, controller1] = parsed.record.metadata.controllers
    this.state.controllers = [
      controller0 === 'remote' ? 'human' : controller0,
      controller1 === 'remote' ? 'human' : controller1,
    ]
    this.state.offer = ''
    this.state.answer = ''
    this.state.game = snapshotFromRecord(parsed.record, 0)
    this.state.status = 'Recording loaded. Use replay controls to play or jump to final state.'
    this.notify()
  }

  saveRecordingToLocalStorage(): void {
    if (!this.state.recording) {
      this.state.status = 'No game recording available to save.'
      this.notify()
      return
    }
    const payload = serializeGameRecord(this.state.recording)
    try {
      localStorage.setItem(RECORDING_STORAGE_KEY, payload)
      this.state.status = 'Recording saved to local storage.'
    } catch {
      this.state.status = 'Failed to save recording to local storage.'
    }
    this.refreshSavedRecordingFlag()
    this.notify()
  }

  loadRecordingFromLocalStorage(): void {
    let payload = ''
    try {
      payload = localStorage.getItem(RECORDING_STORAGE_KEY) ?? ''
    } catch {
      this.state.status = 'Failed to read local storage recording.'
      this.refreshSavedRecordingFlag()
      this.notify()
      return
    }
    if (!payload) {
      this.state.status = 'No saved recording found in local storage.'
      this.refreshSavedRecordingFlag()
      this.notify()
      return
    }
    this.refreshSavedRecordingFlag()
    this.importRecordingJson(payload)
  }

  reportStatus(message: string): void {
    this.state.status = message
    this.notify()
  }

  startReplay(): void {
    if (this.state.mode !== null && isP2PMode(this.state.mode) && (this.p2p?.isConnected() ?? false)) {
      this.state.status = 'Replay is unavailable while connected to a peer game.'
      this.notify()
      return
    }
    const record = this.state.replay?.record ?? this.state.recording
    if (!record) {
      this.state.status = 'No recording available for replay.'
      this.notify()
      return
    }
    const step = this.state.replay?.step ?? 0
    const boundedStep = Math.max(0, Math.min(step, record.timeline.length))
    if (boundedStep === record.timeline.length) {
      this.stopReplayInterval()
      this.state.replay = {
        record,
        step: record.timeline.length,
        isPlaying: false,
      }
      this.state.game = snapshotFromRecord(record, record.timeline.length)
      this.state.status = 'Replay reached final state.'
      this.notify()
      return
    }
    this.state.replay = {
      record,
      step: boundedStep,
      isPlaying: true,
    }
    this.state.game = snapshotFromRecord(record, boundedStep)
    this.state.status = `Replay playing from step ${boundedStep}/${record.timeline.length}.`
    this.setupReplayInterval()
    this.notify()
  }

  pauseReplay(): void {
    if (!this.state.replay) {
      return
    }
    this.state.replay = {
      ...this.state.replay,
      isPlaying: false,
    }
    this.stopReplayInterval()
    this.state.status = `Replay paused at step ${this.state.replay.step}/${this.state.replay.record.timeline.length}.`
    this.notify()
  }

  stepReplay(delta: number): void {
    if (!this.state.replay) {
      return
    }
    this.state.replay = {
      ...this.state.replay,
      isPlaying: false,
    }
    this.stopReplayInterval()
    this.applyReplayStep(this.state.replay.step + delta)
    this.notify()
  }

  jumpReplayToEnd(): void {
    if (!this.state.replay) {
      return
    }
    this.state.replay = {
      ...this.state.replay,
      isPlaying: false,
    }
    this.stopReplayInterval()
    this.applyReplayStep(this.state.replay.record.timeline.length)
    this.notify()
  }

  exitReplay(): void {
    if (!this.state.replay) {
      return
    }
    const finalState = snapshotFromRecord(this.state.replay.record, this.state.replay.record.timeline.length)
    this.clearReplay()
    this.state.game = finalState
    this.state.status = 'Exited replay at final recorded game state.'
    this.notify()
  }
}
