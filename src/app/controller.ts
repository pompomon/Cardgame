import { chooseAiAction } from '../game/ai'
import { tutorialPolicy } from '../game/ai-policies/tutorial'
import { createTutorialDecks } from '../game/cards'
import { applyAction, canAct, createInitialGame, getLegalActions } from '../game/engine'
import type { GameAction, GameState } from '../game/types'
import { P2PLink } from '../net/p2p'
import { activeActor } from './active-actor'
import { isGameAction, isLegalActionForState, isSeedPayload } from './action-validation'
import { readStorageItem, tryReadStorageItem, writeStorageItem } from './safe-storage'
import {
  applyAdventureEncounterResult,
  beginAdventureEncounter,
  clearStoredAdventureGameSnapshot,
  cloneAdventureRun,
  computeAdventureScore,
  createAdventureRun,
  createAdventureRunId,
  createInactiveAdventureState,
  deckPairForAdventureGame,
  isAdventureGameSnapshotForRun,
  isResumableAdventureRun,
  pauseAdventureRun,
  persistAdventureGameSnapshot,
  persistAdventureHighScore,
  readStoredAdventureGameSnapshot,
  readStoredAdventureHighScore,
  type AdventureEncounterOutcome,
  type AdventureRunState,
} from './adventure'
import {
  clearStoredAdventureRun,
  persistAdventureRun,
  readStoredAdventureRunRecord,
  type StoredAdventureRunRecord,
} from './adventure-persistence'
import { persistAnimationSpeed, resolveInitialAnimationSpeed } from './animation-settings'
import { persistBoardTheme, readStoredBoardTheme, type BoardTheme } from './board-theme'
import { readStoredCardVisualStyle, persistCardVisualStyle } from './card-visual-style-selection'
import {
  persistRenderQualityPreference,
  readStoredRenderQualityPreference,
  type RenderQualityPreference,
} from './render-quality'
import {
  appendGameRecordStep,
  createGameRecord,
  parseGameRecordJson,
  serializeGameRecord,
  snapshotFromRecord,
} from './game-recording'
import { buildViewModel } from './view-model'
import type { AiLevel, AnimationSpeed, AppState, AppViewModel, CardVisualStyle, Mode } from './types'

const RECORDING_STORAGE_KEY = 'cardgame.saved-recording'
const REPLAY_TICK_MS = 700
const TUTORIAL_SEED = 1
const ADVENTURE_STORAGE_WARNING = 'Adventure progress could not be saved (storage unavailable).'

// Adventure seeds come from the clock, as before. Clamp unusual clock values
// so run changes always receive the non-negative integer they require.
function adventureClockSeed(): number {
  const now = Math.floor(Date.now())
  return Number.isSafeInteger(now) && now >= 0 ? now : 0
}

function isP2PMode(mode: Mode): boolean {
  return mode === 'p2p-host' || mode === 'p2p-join'
}

function normalizeImportedMode(mode: Mode): Mode {
  if (isP2PMode(mode)) {
    return 'local-hvh'
  }
  return mode === 'adventure-hvai' ? 'local-hvai' : mode
}

export interface ControllerApi {
  subscribe(listener: (view: AppViewModel) => void): () => void
  getViewModel(): AppViewModel
  setAiLevel(level: AiLevel): void
  setCardVisualStyle(style: CardVisualStyle): void
  setAnimationSpeed(speed: AnimationSpeed): void
  setBoardTheme(theme: BoardTheme): void
  setRenderQualityPreference(preference: RenderQualityPreference): void
  startGame(mode: Mode): void
  startAdventure(): void
  resumeAdventure(): void
  pauseAdventure(): void
  abandonAdventure(): void
  backToLobby(statusMessage?: string): void
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
  // The unsaved ID shown for a version 1 run converted in memory. Later reads
  // of the same unversioned save reuse it, so the first version 2 write keeps
  // the ID already in memory. A successful run write or a reset retires it.
  private unsavedConversionRunId: string | null = null

  constructor() {
    this.state = {
      mode: null,
      game: null,
      controllers: ['human', 'human'],
      seed: Date.now(),
      offer: '',
      answer: '',
      status: '',
      recording: null,
      replay: null,
      hasSavedRecording: this.hasSavedRecording(),
      aiLevel: 'basic',
      cardVisualStyle: readStoredCardVisualStyle(),
      animationSpeed: resolveInitialAnimationSpeed(),
      boardTheme: readStoredBoardTheme(),
      renderQualityPreference: readStoredRenderQualityPreference(),
      p2pStarted: false,
      pendingP2PStartSeed: null,
      pendingRematchSeed: null,
      adventure: createInactiveAdventureState(readStoredAdventureHighScore()),
    }
    this.refreshAdventureFromStorage()
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
    const value = readStorageItem(RECORDING_STORAGE_KEY)
    return typeof value === 'string' && value.length > 0
  }

  private refreshSavedRecordingFlag(): void {
    this.state.hasSavedRecording = this.hasSavedRecording()
  }

  private readAdventureRunRecord(): StoredAdventureRunRecord | null {
    const record = readStoredAdventureRunRecord(this.unsavedConversionRunId ?? undefined)
    if (record?.migratedFromV1) {
      this.unsavedConversionRunId = record.run.runId
    }
    return record
  }

  private refreshAdventureFromStorage(): void {
    const run = this.readAdventureRunRecord()?.run ?? null
    const highScore = readStoredAdventureHighScore()
    if (this.state.mode === 'adventure-hvai') {
      this.state.adventure.highScore = highScore
      this.state.adventure.hasSavedRun = run !== null
      return
    }
    if (!run) {
      // Reset adventure view-state to the inactive baseline so the lobby never
      // shows stale round/lineup/status when storage is missing or corrupted.
      this.state.adventure = createInactiveAdventureState(highScore)
      return
    }
    // Show a stored 'active' run as 'paused'. A run is stored as 'active' if
    // the user closed the tab mid-round; surfacing it as 'paused' lets them
    // resume cleanly. Reading never writes: the normalization (and any
    // version 1 conversion) is only saved by the next explicit run save.
    this.state.adventure = {
      run: run.status === 'active' ? pauseAdventureRun(run) : run,
      highScore,
      hasSavedRun: true,
    }
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

  private setAdventureRun(run: AdventureRunState | null, statusMessage?: string): boolean {
    const highScore = this.state.adventure.highScore
    if (!run) {
      this.unsavedConversionRunId = null
      this.state.adventure = createInactiveAdventureState(highScore)
      clearStoredAdventureRun()
      if (statusMessage) {
        this.state.status = statusMessage
      }
      return true
    }
    const next = cloneAdventureRun(run)
    // Replace the in-memory run even when the write fails, so the current
    // session keeps playing; hasSavedRun follows the write result because
    // resumeAdventure() reads the run back from storage.
    const persisted = persistAdventureRun(next)
    if (persisted) {
      this.unsavedConversionRunId = null
    }
    this.state.adventure = {
      run: next,
      highScore,
      hasSavedRun: persisted,
    }
    if (!persisted) {
      this.state.status = ADVENTURE_STORAGE_WARNING
    } else if (statusMessage) {
      this.state.status = statusMessage
    }
    return persisted
  }

  // A resumable run needs a write when it became active in this session or
  // its last save failed. A run that was only loaded (or converted from
  // version 1) is never written just because the lobby was shown.
  private adventureRunNeedsSave(): boolean {
    const run = this.state.adventure.run
    return run !== null
      && isResumableAdventureRun(run)
      && (run.status === 'active' || !this.state.adventure.hasSavedRun)
  }

  private launchAdventureGameFromRun(run: AdventureRunState): void {
    const seed = run.attemptSeed ?? adventureClockSeed()
    const [playerDeck, opponentDeck] = deckPairForAdventureGame(run, seed)
    this.state.mode = 'adventure-hvai'
    this.state.seed = seed
    this.state.game = createInitialGame(seed, [playerDeck, opponentDeck])
    this.state.controllers = ['human', 'ai']
    this.state.offer = ''
    this.state.answer = ''
    this.state.p2pStarted = false
    this.state.pendingP2PStartSeed = null
    this.state.pendingRematchSeed = null
    this.initializeRecording('adventure-hvai')
  }

  private launchAdventureGameFromSnapshot(run: AdventureRunState, snapshot: GameState): void {
    const seed = run.attemptSeed ?? adventureClockSeed()
    this.state.mode = 'adventure-hvai'
    this.state.seed = seed
    this.state.game = snapshot
    this.state.controllers = ['human', 'ai']
    this.state.offer = ''
    this.state.answer = ''
    this.state.p2pStarted = false
    this.state.pendingP2PStartSeed = null
    this.state.pendingRematchSeed = null
    this.initializeRecording('adventure-hvai')
  }

  private applyAdventureCompletion(run: AdventureRunState, message: string): void {
    const score = computeAdventureScore(run)
    const nextHighScore = Math.max(this.state.adventure.highScore, score)
    this.state.adventure.highScore = nextHighScore
    persistAdventureHighScore(nextHighScore)
    const fullMessage = `${message} Score: ${score}. High score: ${nextHighScore}.`
    // This helper is terminal-only and receives a 'completed' or 'failed'
    // run. Clear stored run/snapshot and surface terminal status in memory
    // without persisting and immediately removing the run.
    clearStoredAdventureRun()
    clearStoredAdventureGameSnapshot()
    this.unsavedConversionRunId = null
    this.state.adventure = {
      run: cloneAdventureRun(run),
      highScore: nextHighScore,
      hasSavedRun: false,
    }
    this.state.status = fullMessage
    this.state.mode = null
    this.state.game = null
    this.state.controllers = ['human', 'human']
  }

  private onAdventureGameFinished(previousState: GameState): void {
    if (this.state.mode !== 'adventure-hvai' || !this.state.game || previousState.phase === 'gameOver' || this.state.game.phase !== 'gameOver') {
      return
    }
    const run = this.state.adventure.run
    if (!run || run.status !== 'active' || run.stage !== 'encounter') {
      return
    }

    // Any in-progress mid-round snapshot is no longer valid once a round
    // resolves; clear it so a future resume starts a fresh round from the
    // run state rather than restoring a stale finished board. The new
    // attempt or tier also stops any leftover snapshot from matching.
    clearStoredAdventureGameSnapshot()

    const winner = this.state.game.winner
    const outcome: AdventureEncounterOutcome = winner === 0 ? 'win' : winner === 1 ? 'loss' : 'draw'
    const next = applyAdventureEncounterResult(run, outcome, adventureClockSeed())
    if (next.status === 'completed') {
      this.applyAdventureCompletion(next, 'Adventure completed!')
      return
    }
    if (next.status === 'failed') {
      this.applyAdventureCompletion(next, 'Adventure failed.')
      return
    }
    const round = next.currentTierIndex + 1
    if (outcome === 'win') {
      this.setAdventureRun(next, `Round won. Resume adventure for Round ${round}.`)
    } else if (outcome === 'loss') {
      this.setAdventureRun(next, `Round lost. ${next.remainingChances} chances left. Resume adventure to retry Round ${round}.`)
    } else {
      this.setAdventureRun(next, `Round ended in a draw. Resume adventure to replay Round ${round}.`)
    }
    this.state.mode = null
    this.state.game = null
    this.state.controllers = ['human', 'human']
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
      const action = this.state.mode === 'tutorial'
        ? tutorialPolicy({
          state: game,
          actor,
          actions: getLegalActions(game, actor),
          context: {
            level: 'basic',
            visibility: {
              kind: 'partial',
              canInspectOpponentHand: false,
            },
          },
        })
        : chooseAiAction(game, actor, { level: this.state.aiLevel })
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

    const previous = this.state.game
    const next = applyAction(previous, action)
    this.state.game = next
    if (this.state.mode === 'adventure-hvai' && action.type === 'play_land' && this.state.adventure.run?.status === 'active') {
      // Update the in-memory counter only. setAdventureRun() would
      // synchronously JSON-stringify and write the entire run (including the
      // 7×50-card opponent map) to localStorage on every play_land, which
      // can introduce main-thread jank during gameplay. Persistence happens
      // at round boundaries via setAdventureRun() in onAdventureGameFinished()
      // and on pause/resume/abandon, which already capture totalCardsPlayed.
      this.state.adventure.run.totalCardsPlayed += 1
    }

    this.appendRecordingStep(action, next, source)
    this.onAdventureGameFinished(previous)
    this.notify()
    this.scheduleAiIfNeeded()
  }

  setAiLevel(level: AiLevel): void {
    this.state.aiLevel = level
    this.notify()
  }

  setCardVisualStyle(style: CardVisualStyle): void {
    this.state.cardVisualStyle = style
    persistCardVisualStyle(style)
    this.notify()
  }

  setAnimationSpeed(speed: AnimationSpeed): void {
    this.state.animationSpeed = speed
    persistAnimationSpeed(speed)
    this.notify()
  }

  setBoardTheme(theme: BoardTheme): void {
    this.state.boardTheme = theme
    persistBoardTheme(theme)
    this.notify()
  }

  setRenderQualityPreference(preference: RenderQualityPreference): void {
    this.state.renderQualityPreference = preference
    persistRenderQualityPreference(preference)
    this.notify()
  }

  startAdventure(): void {
    if (this.isReplayActive()) {
      this.state.status = 'Adventure is unavailable during replay.'
      this.notify()
      return
    }
    this.stopReplayInterval()
    this.clearAiTimeout()
    this.p2p?.close()
    this.p2p = null
    this.state.replay = null
    const seed = adventureClockSeed()
    const run = beginAdventureEncounter(createAdventureRun(seed, createAdventureRunId()), seed)
    clearStoredAdventureGameSnapshot()
    const persisted = this.setAdventureRun(run)
    this.launchAdventureGameFromRun(run)
    if (persisted) {
      this.state.status = 'Adventure started. Round 1 begins.'
    }
    this.notify()
    this.scheduleAiIfNeeded()
  }

  resumeAdventure(): void {
    if (this.isReplayActive()) {
      this.state.status = 'Adventure is unavailable during replay.'
      this.notify()
      return
    }
    // Read once. A version 1 run arrives converted in memory; this resume is
    // its first version 2 write.
    const record = this.readAdventureRunRecord()
    if (!record || !isResumableAdventureRun(record.run)) {
      this.state.status = 'No paused adventure run found.'
      this.refreshAdventureFromStorage()
      this.notify()
      return
    }
    const stored = record.run
    const slot = readStoredAdventureGameSnapshot()
    const resumed = beginAdventureEncounter(stored, adventureClockSeed())
    const persisted = this.setAdventureRun(resumed)
    const round = resumed.currentTierIndex + 1
    let recovered = false
    // Restore a mid-game save only when it belongs to this run's paused
    // encounter: same run, node, attempt number and attempt seed. Anything
    // else (a bare version 1 game, a corrupt slot, or a save from another
    // run or attempt) is never restored; the encounter restarts from its
    // seed without using a chance.
    if (stored.stage === 'encounter' && slot.kind === 'envelope' && isAdventureGameSnapshotForRun(slot.envelope, resumed)) {
      this.launchAdventureGameFromSnapshot(resumed, slot.envelope.game)
      clearStoredAdventureGameSnapshot()
    } else {
      if (slot.kind !== 'none') {
        // Warn only when a mid-encounter game was lost; stale saves from
        // earlier attempts are cleaned up quietly.
        recovered = stored.stage === 'encounter' || (record.migratedFromV1 && slot.kind === 'legacy')
        clearStoredAdventureGameSnapshot()
      }
      this.launchAdventureGameFromRun(resumed)
    }
    // Message priority: storage warning (already set by setAdventureRun),
    // then the recovery warning, then the success message.
    if (persisted) {
      this.state.status = recovered
        ? `Adventure resumed at Round ${round}. The saved game could not be restored, so the round restarted without using a chance.`
        : `Adventure resumed at Round ${round}.`
    }
    this.notify()
    this.scheduleAiIfNeeded()
  }

  pauseAdventure(): void {
    if (this.state.mode !== 'adventure-hvai') {
      return
    }
    const run = this.state.adventure.run
    if (!run || !isResumableAdventureRun(run)) {
      return
    }
    // Pausing mid-round: save the live GameState, bound to this run's
    // attempt identity, so resuming continues exactly where the player left
    // off. Pausing after the round ended (gameOver) is handled by
    // onAdventureGameFinished, which already wrote a paused run to storage
    // and sent us back to the lobby — no game snapshot is needed then.
    const game = this.state.game
    if (game && game.phase !== 'gameOver' && run.stage === 'encounter') {
      persistAdventureGameSnapshot(run, game)
    } else {
      clearStoredAdventureGameSnapshot()
    }
    const paused = pauseAdventureRun(run)
    this.resetToLobby()
    // The single run write for this pause. If it fails, drop the game save
    // too; setAdventureRun() surfaces the storage warning last.
    const persisted = this.setAdventureRun(paused, `Adventure paused at Round ${paused.currentTierIndex + 1}.`)
    if (!persisted) {
      clearStoredAdventureGameSnapshot()
    }
    this.notify()
  }

  abandonAdventure(): void {
    const hadAdventure = this.state.adventure.run !== null || this.state.adventure.hasSavedRun
    clearStoredAdventureGameSnapshot()
    this.setAdventureRun(null)
    if (this.state.mode === 'adventure-hvai') {
      this.backToLobby(hadAdventure ? 'Adventure run reset.' : undefined)
      return
    }
    if (hadAdventure) {
      this.state.status = 'Adventure run reset.'
      this.notify()
    }
  }

  startGame(mode: Mode): void {
    if (mode === 'adventure-hvai') {
      this.startAdventure()
      return
    }
    this.stopReplayInterval()
    this.clearAiTimeout()
    this.state.replay = null
    if (!isP2PMode(mode)) {
      this.p2p?.close()
      this.p2p = null
    }
    this.state.mode = mode
    this.state.seed = mode === 'tutorial' ? TUTORIAL_SEED : Date.now()
    this.state.game = mode === 'tutorial'
      ? createInitialGame(this.state.seed, createTutorialDecks())
      : createInitialGame(this.state.seed)
    this.state.p2pStarted = false
    this.state.pendingP2PStartSeed = null
    this.state.pendingRematchSeed = null
    // If there's an in-memory active adventure (e.g. user navigated back to
    // the lobby with state still active), demote it to 'paused' rather than
    // clearing it. Starting a non-adventure mode should never silently delete
    // saved adventure progress; the user can still resume the run from the
    // lobby afterwards. A run that was only loaded from storage is not
    // rewritten.
    let adventurePersisted = true
    const adventureRun = this.state.adventure.run
    if (adventureRun && this.adventureRunNeedsSave()) {
      // pauseAdventureRun() keeps the attempt seed and identity as-is.
      adventurePersisted = this.setAdventureRun(pauseAdventureRun(adventureRun))
    }

    if (mode === 'local-hvh') {
      this.state.controllers = ['human', 'human']
      if (adventurePersisted) {
        this.state.status = 'Local Human vs Human game started.'
      }
    } else if (mode === 'local-hvai') {
      this.state.controllers = ['human', 'ai']
      if (adventurePersisted) {
        this.state.status = 'Local Human vs AI game started.'
      }
    } else if (mode === 'local-aivai') {
      this.state.controllers = ['ai', 'ai']
      if (adventurePersisted) {
        this.state.status = 'Local AI vs AI simulation started.'
      }
    } else if (mode === 'tutorial') {
      this.state.controllers = ['human', 'ai']
      if (adventurePersisted) {
        this.state.status = 'Tutorial started. Follow the hint panel to learn each creature ability.'
      }
      this.state.offer = ''
      this.state.answer = ''
    } else if (mode === 'p2p-host') {
      this.setupP2P()
      this.state.controllers = ['human', 'remote']
      if (adventurePersisted) {
        this.state.status = 'Host created. Exchange offer/answer to connect.'
      }
      this.state.offer = ''
      this.state.answer = ''
    } else {
      this.setupP2P()
      this.state.controllers = ['remote', 'human']
      if (adventurePersisted) {
        this.state.status = 'Joiner ready. Paste offer to generate answer.'
      }
      this.state.offer = ''
      this.state.answer = ''
    }

    if (mode === 'tutorial') {
      this.state.recording = null
    } else {
      this.initializeRecording(mode)
    }
    this.notify()
    this.scheduleAiIfNeeded()
  }

  // UI-only reset to the lobby; it never writes Adventure progress.
  private resetToLobby(statusMessage?: string): void {
    this.stopReplayInterval()
    this.clearAiTimeout()
    this.p2p?.close()
    this.p2p = null
    this.state.mode = null
    this.state.game = null
    this.state.replay = null
    this.state.recording = null
    this.state.status = statusMessage ?? ''
    this.state.offer = ''
    this.state.answer = ''
    this.state.p2pStarted = false
    this.state.pendingP2PStartSeed = null
    this.state.pendingRematchSeed = null
  }

  backToLobby(statusMessage?: string): void {
    this.resetToLobby(statusMessage)
    const run = this.state.adventure.run
    if (run && isResumableAdventureRun(run)) {
      // Demote and save a run that became active in this session (or whose
      // last save failed). A run that was only loaded stays as stored.
      if (this.adventureRunNeedsSave()) {
        const persisted = this.setAdventureRun(pauseAdventureRun(run))
        if (!persisted) {
          clearStoredAdventureGameSnapshot()
        }
      }
    } else {
      this.refreshAdventureFromStorage()
    }
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
    if (this.state.mode === 'adventure-hvai') {
      this.state.status = 'Use Resume Adventure from lobby to continue the run.'
      this.notify()
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
    if (this.state.mode === 'tutorial') {
      this.state.seed = TUTORIAL_SEED
      this.state.game = createInitialGame(this.state.seed, createTutorialDecks())
      this.state.recording = null
    } else {
      this.state.seed = newSeed
      this.state.game = createInitialGame(this.state.seed)
      this.initializeRecording(this.state.mode)
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
    // Don't clear the persisted adventure run here: importing a recording
    // shouldn't silently delete a user's saved adventure progress. Refresh
    // the in-memory adventure view-state from storage instead so the user
    // can resume the adventure run after exiting the replay.
    this.refreshAdventureFromStorage()
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
    if (writeStorageItem(RECORDING_STORAGE_KEY, payload)) {
      this.state.status = 'Recording saved to local storage.'
    } else {
      this.state.status = 'Failed to save recording to local storage.'
    }
    this.refreshSavedRecordingFlag()
    this.notify()
  }

  loadRecordingFromLocalStorage(): void {
    const result = tryReadStorageItem(RECORDING_STORAGE_KEY)
    if (!result.available) {
      // Distinct from "no saved recording": storage threw, so we cannot
      // tell whether a recording exists. Surface an actionable failure
      // status instead of pretending the slot is empty.
      this.state.status = 'Failed to read local storage recording.'
      this.refreshSavedRecordingFlag()
      this.notify()
      return
    }
    const payload = result.value ?? ''
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
    // Only block replay while an adventure match is actively in progress.
    // A merely-saved (paused) run should not prevent users from playing
    // recordings; their adventure progress is preserved in storage and can
    // be resumed later from the lobby.
    if (this.state.mode === 'adventure-hvai') {
      this.state.status = 'Replay is unavailable while an adventure match is in progress.'
      this.notify()
      return
    }
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
