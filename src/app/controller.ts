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
import type { AiLevel, AppState, AppViewModel, Mode, RendererKind } from './types'

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
  setAiLevel(level: AiLevel): void
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
      aiLevel: 'basic',
      p2pStarted: false,
      pendingP2PStartSeed: null,
      pendingRematchSeed: null,
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
      this.state.aiLevel,
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
      if (!this.state.mode || !isP2PMode(this.state.mode)) {
        return
      }
      if (packet.type === 'start') {
        if (this.state.mode === 'p2p-host') {
          this.state.status = 'Ignored unexpected start packet from peer.'
          this.notify()
          return
        }
        if (this.state.p2pStarted) {
          this.state.status = 'Ignored duplicate start packet from peer.'
          this.notify()
          return
        }
        if (!isSeedPayload(packet.payload)) {
          this.state.status = 'Ignored invalid start payload from peer.'
          this.notify()
          return
        }
        // If we cannot acknowledge the start packet, abort local transition.
        // Otherwise this peer would move into the match while the host waits
        // forever in the lobby for an ack that never arrives.
        const acknowledged = this.p2p?.send('start-ack', { seed: packet.payload.seed }) ?? false
        if (!acknowledged) {
          this.state.status = 'P2P start failed: could not acknowledge start packet. Reconnect and retry.'
          this.notify()
          return
        }
        this.state.seed = packet.payload.seed
        this.state.game = createInitialGame(packet.payload.seed)
        this.state.p2pStarted = true
        if (this.state.mode) {
          this.initializeRecording(this.state.mode)
        }
        this.state.status = 'Remote game started.'
        this.notify()
        return
      }

      if (packet.type === 'start-ack') {
        if (!isSeedPayload(packet.payload)) {
          this.state.status = 'Ignored invalid start-ack payload from peer.'
          this.notify()
          return
        }
        // Only flip p2pStarted when the ack matches the seed we are still
        // waiting on, so a stale ack from a prior session can't push the
        // host into a match it didn't initiate.
        if (this.state.pendingP2PStartSeed !== packet.payload.seed) {
          return
        }
        this.state.pendingP2PStartSeed = null
        this.state.p2pStarted = true
        this.state.status = 'P2P game started.'
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
        // Handle simultaneous rematch clicks deterministically: keep only the
        // lower seed. This avoids each peer applying the other peer's seed
        // and later applying its own pending seed again on ack.
        if (this.state.pendingRematchSeed !== null && packet.payload.seed !== this.state.pendingRematchSeed) {
          const winningSeed = Math.min(this.state.pendingRematchSeed, packet.payload.seed)
          if (packet.payload.seed !== winningSeed) {
            this.state.status = 'Ignoring competing rematch; waiting for peer acknowledgement.'
            this.notify()
            return
          }
          this.state.pendingRematchSeed = null
        }
        // If we cannot acknowledge the rematch packet, abort local transition.
        // Applying locally without an ack would desynchronize peers.
        const acknowledged = this.p2p?.send('rematch-ack', { seed: packet.payload.seed }) ?? false
        if (!acknowledged) {
          this.state.status = 'P2P rematch failed: could not acknowledge rematch packet. Reconnect and retry.'
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
        return
      }

      if (packet.type === 'rematch-ack') {
        if (!isSeedPayload(packet.payload)) {
          this.state.status = 'Ignored invalid rematch-ack payload from peer.'
          this.notify()
          return
        }
        if (this.state.pendingRematchSeed !== packet.payload.seed || !this.state.mode) {
          return
        }
        // Apply the rematch only now, after the peer has acknowledged the
        // new seed. Until this point neither seed/game nor recording were
        // mutated, so a failed ack leaves the previous game intact and
        // both peers stay in sync.
        this.clearAiTimeout()
        this.state.seed = this.state.pendingRematchSeed
        this.state.game = createInitialGame(this.state.seed)
        this.initializeRecording(this.state.mode)
        this.state.pendingRematchSeed = null
        this.state.status = 'Rematch started.'
        this.notify()
        this.scheduleAiIfNeeded()
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
      const game = this.state.game
      if (!game || this.isReplayActive()) {
        return
      }
      const actor = activeActor(game)
      if (this.state.controllers[actor] !== 'ai') {
        return
      }
      const action = chooseAiAction(game, actor, { level: this.state.aiLevel })
      if (!action) {
        return
      }
      if (!isLegalActionForState(game, action)) {
        return
      }
      this.applyRecordedAction(action, 'ai', true)
    }, 350)
  }

  private applyRecordedAction(action: GameAction, source: 'human' | 'ai' | 'remote', broadcastToPeer: boolean): void {
    if (!this.state.game || this.isReplayActive()) {
      return
    }
    const inP2PMode = this.state.mode !== null && isP2PMode(this.state.mode)
    if (source === 'remote' && inP2PMode && !this.state.p2pStarted) {
      this.state.status = 'Ignored action while start handshake is in progress.'
      this.notify()
      return
    }
    if (this.state.pendingRematchSeed !== null && inP2PMode) {
      if (source === 'remote') {
        this.state.status = 'Ignored action while rematch handshake is in progress.'
        this.notify()
      }
      return
    }
    if (source === 'remote' && inP2PMode) {
      const remoteActor = this.state.controllers.findIndex((controller) => controller === 'remote')
      if (remoteActor !== -1 && action.actor !== remoteActor) {
        this.state.status = 'Ignored out-of-role action from peer.'
        this.notify()
        return
      }
    }
    if (!isLegalActionForState(this.state.game, action)) {
      if (source === 'remote') {
        this.state.status = 'Ignored illegal action from peer.'
        this.notify()
      }
      return
    }
    if (broadcastToPeer && (this.state.mode === 'p2p-host' || this.state.mode === 'p2p-join')) {
      // Broadcast the action BEFORE applying it locally. P2PLink.send()
      // returns false when the data channel is not open or when the
      // underlying RTCDataChannel.send() throws (e.g. transient channel
      // closure). If we applied locally first, a failed send would advance
      // this peer's game while the other peer never receives the action,
      // permanently desynchronizing the session. Aborting the action
      // entirely keeps both peers on the same state and lets the user
      // either retry once the channel recovers or reconnect.
      const delivered = this.p2p?.send('action', action) ?? false
      if (!delivered) {
        this.state.status = 'P2P send failed: action was not delivered to peer. Try again or reconnect.'
        this.notify()
        return
      }
    }

    const next = applyAction(this.state.game, action)
    this.state.game = next

    this.appendRecordingStep(action, next, source)
    this.notify()
    this.scheduleAiIfNeeded()
  }

  setAiLevel(level: AiLevel): void {
    this.state.aiLevel = level
    this.notify()
  }

  startGame(mode: Mode): void {
    this.stopReplayInterval()
    this.clearAiTimeout()
    this.state.replay = null
    if (!isP2PMode(mode)) {
      this.p2p?.close()
      this.p2p = null
    }
    this.state.mode = mode
    this.state.seed = Date.now()
    this.state.game = createInitialGame(this.state.seed)
    this.state.p2pStarted = false
    this.state.pendingP2PStartSeed = null
    this.state.pendingRematchSeed = null

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
    this.state.recording = null
    this.state.status = ''
    this.state.offer = ''
    this.state.answer = ''
    this.state.p2pStarted = false
    this.state.pendingP2PStartSeed = null
    this.state.pendingRematchSeed = null
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
    if (this.state.pendingP2PStartSeed !== null) {
      this.state.status = 'Already waiting for peer to acknowledge start.'
      this.notify()
      return
    }
    // Send the start packet but DO NOT flip p2pStarted yet. p2p.send()
    // returning true only means the WebRTC send queue accepted the packet
    // locally; it is NOT an acknowledgment that the joiner actually
    // received and applied the synchronized seed. We wait for an explicit
    // application-level `start-ack` from the joiner before transitioning
    // the host out of the lobby. This prevents the host from stranding
    // itself in the match scene if the peer disconnects between the local
    // send() returning true and the packet actually being delivered.
    const sent = this.p2p?.send('start', { seed: this.state.seed }) ?? false
    if (!sent) {
      this.state.status = 'P2P start packet not sent: peer is not connected yet.'
      this.notify()
      return
    }
    this.state.pendingP2PStartSeed = this.state.seed
    this.state.status = 'Waiting for peer to acknowledge start...'
    this.notify()
  }

  submitAction(action: GameAction): void {
    if (this.state.pendingRematchSeed !== null && this.state.mode !== null && isP2PMode(this.state.mode)) {
      this.state.status = 'Rematch in progress. Wait for peer acknowledgement before taking actions.'
      this.notify()
      return
    }
    this.applyRecordedAction(action, 'human', true)
  }

  rematch(): void {
    if (!this.state.mode || this.isReplayActive()) {
      return
    }
    if (this.state.pendingRematchSeed !== null && isP2PMode(this.state.mode)) {
      this.state.status = 'Already waiting for peer to acknowledge rematch.'
      this.notify()
      return
    }
    const newSeed = Date.now()
    if (this.state.mode === 'p2p-host' || this.state.mode === 'p2p-join') {
      // For P2P, send the rematch packet but DO NOT mutate local
      // seed/game/recording yet. p2p.send() returning true only means the
      // WebRTC send queue accepted the packet locally — it is NOT an ack
      // that the peer actually received and applied the new seed. We hold
      // the new seed in pendingRematchSeed and only commit the rematch
      // once the peer's `rematch-ack` arrives. This way a transient channel
      // failure or peer disconnect after send() leaves the previous game
      // intact on this side, so both peers stay in sync.
      const delivered = this.p2p?.send('rematch', { seed: newSeed }) ?? false
      if (!delivered) {
        this.state.status = 'P2P send failed: peer did not receive the rematch packet. Reconnect before continuing.'
        this.notify()
        return
      }
      this.state.pendingRematchSeed = newSeed
      this.state.status = 'Waiting for peer to acknowledge rematch...'
      this.notify()
      return
    }
    this.clearAiTimeout()
    this.state.seed = newSeed
    this.state.game = createInitialGame(this.state.seed)
    this.initializeRecording(this.state.mode)
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
    this.state.aiLevel = parsed.record.metadata.aiLevel
    const [controller0, controller1] = parsed.record.metadata.controllers
    this.state.controllers = [
      controller0 === 'remote' ? 'human' : controller0,
      controller1 === 'remote' ? 'human' : controller1,
    ]
    this.state.offer = ''
    this.state.answer = ''
    this.state.p2pStarted = false
    this.state.pendingP2PStartSeed = null
    this.state.pendingRematchSeed = null
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
    this.scheduleAiIfNeeded()
  }
}
