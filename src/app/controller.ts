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
  clearStoredAdventureGameSnapshot,
  computeAdventureScore,
  createAdventureRun,
  createAdventureRunId,
  createInactiveAdventureState,
  deckPairForAdventureGame,
  isAdventureGameSnapshotForRun,
  isResumableAdventureRun,
  openAdventureMap,
  pauseAdventureRun,
  persistAdventureGameSnapshot,
  persistAdventureHighScore,
  readStoredAdventureGameSnapshot,
  readStoredAdventureHighScore,
  resumeAdventureEncounter,
  selectedAdventureNode,
  startAdventureEncounter,
  type AdventureEncounterOutcome,
  type AdventureRunState,
} from './adventure'
import {
  ADVENTURE_RUN_STORAGE_KEY,
  clearStoredAdventureRun,
  persistAdventureRun,
  readStoredAdventureRunRecord,
  type StoredAdventureRunRecord,
} from './adventure-persistence'
import { displayAdventureOpponentLabel } from './game-presentation'
import { persistAnimationSpeed, resolveInitialAnimationSpeed } from './animation-settings'
import { persistBoardTheme, readStoredBoardTheme, type BoardTheme } from './board-theme'
import {
  readStoredCardVisualStyle, persistCardVisualStyle,
  readStoredMonochromeCards, persistMonochromeCards,
} from './card-visual-style-selection'
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
const ADVENTURE_RESULT_WARNING = 'The encounter result could not be saved (storage unavailable). Retry saving the result.'
const ADVENTURE_PENDING_NOTICE = 'Save the encounter result first: choose Retry Saving Result.'

function adventureChancesText(chances: number): string {
  return `${chances} ${chances === 1 ? 'chance' : 'chances'} left`
}

// The status after a committed encounter result. Only terminal runs carry a score.
function adventureResultStatus(
  run: AdventureRunState,
  outcome: AdventureEncounterOutcome,
  score: number | null,
  highScore: number,
): string {
  if (run.status === 'completed' || run.status === 'failed') {
    const heading = run.status === 'completed' ? 'Adventure completed!' : 'Adventure failed.'
    return `${heading} Score: ${score ?? 0}. High score: ${highScore}.`
  }
  const tier = run.currentTierIndex + 1
  if (outcome === 'win') {
    return `Encounter won. Choose your Tier ${tier} encounter.`
  }
  if (outcome === 'loss') {
    return `Encounter lost. ${adventureChancesText(run.remainingChances)}. Retry Tier ${tier}.`
  }
  return `Encounter ended in a draw. Retry Tier ${tier}.`
}

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
  setMonochromeCards(enabled: boolean): void
  setAnimationSpeed(speed: AnimationSpeed): void
  setBoardTheme(theme: BoardTheme): void
  setRenderQualityPreference(preference: RenderQualityPreference): void
  startGame(mode: Mode): void
  startAdventure(): void
  startAdventureNode(nodeId: string): void
  retryAdventureCompletion(): void
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
      monochromeCards: readStoredMonochromeCards(),
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
      // shows stale tier/route/status when storage is missing or corrupted.
      this.state.adventure = createInactiveAdventureState(highScore)
      return
    }
    // Show a stored 'active' run as 'paused'. A run is stored as 'active' if
    // the user closed the tab mid-encounter or left from the map; surfacing
    // it as 'paused' lets them resume cleanly. Reading never writes: the
    // normalization (and any version 1 conversion) is only saved by the next
    // committed transition.
    this.state.adventure = {
      run: run.status === 'active' ? pauseAdventureRun(run) : run,
      highScore,
      hasSavedRun: true,
      pendingCompletion: null,
      lastResult: null,
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

  // Leaves any replay, AI turn or peer session and shows Adventure mode with
  // no game, which is the map hub. Callers set the Adventure state and status.
  private enterAdventureHub(): void {
    this.stopReplayInterval()
    this.clearAiTimeout()
    this.p2p?.close()
    this.p2p = null
    this.state.replay = null
    this.state.mode = 'adventure-hvai'
    this.state.game = null
    this.state.recording = null
    this.state.controllers = ['human', 'ai']
    this.state.offer = ''
    this.state.answer = ''
    this.state.p2pStarted = false
    this.state.pendingP2PStartSeed = null
    this.state.pendingRematchSeed = null
  }

  // Launches the committed attempt: a restored game, or a new game from the
  // attempt seed and the selected node's decks.
  private launchAdventureGame(run: AdventureRunState, snapshot: GameState | null): void {
    const seed = run.attemptSeed
    if (seed === null) {
      throw new Error('An Adventure encounter needs an attempt seed.')
    }
    this.clearAiTimeout()
    this.state.mode = 'adventure-hvai'
    this.state.seed = seed
    this.state.game = snapshot ?? createInitialGame(seed, deckPairForAdventureGame(run, seed))
    this.state.controllers = ['human', 'ai']
    this.initializeRecording('adventure-hvai')
  }

  // The run key is gone when storage accepts the removal or a successful read
  // confirms the key is absent, so refusing to remove an empty slot is not a
  // failure. An unreadable slot after a refused removal counts as a failure.
  private removeStoredAdventureRun(): boolean {
    if (clearStoredAdventureRun()) {
      return true
    }
    const remaining = tryReadStorageItem(ADVENTURE_RUN_STORAGE_KEY)
    return remaining.available && remaining.value === null
  }

  private onAdventureGameFinished(previousState: GameState): void {
    const game = this.state.game
    if (this.state.mode !== 'adventure-hvai' || !game || previousState.phase === 'gameOver' || game.phase !== 'gameOver') {
      return
    }
    const run = this.state.adventure.run
    if (!run || run.status !== 'active' || run.stage !== 'encounter' || this.state.adventure.pendingCompletion) {
      return
    }
    const outcome: AdventureEncounterOutcome = game.winner === 0 ? 'win' : game.winner === 1 ? 'loss' : 'draw'
    this.commitAdventureResult(run, outcome)
  }

  // Commits a finished encounter, storage first. A non-terminal result writes
  // the next run. A terminal result writes the maximum high score, then
  // removes the run. Until every write succeeds, memory keeps the pre-result
  // run and the game-over board, and the outcome waits for Retry completion,
  // which re-applies it to a fresh candidate from the same run.
  private commitAdventureResult(run: AdventureRunState, outcome: AdventureEncounterOutcome): void {
    const nodeId = run.selectedNodeId
    if (nodeId === null) {
      return
    }
    const candidate = applyAdventureEncounterResult(run, outcome)
    const terminal = !isResumableAdventureRun(candidate)
    let score: number | null = null
    let highScore = this.state.adventure.highScore
    let committed: boolean
    if (terminal) {
      score = computeAdventureScore(candidate)
      highScore = Math.max(readStoredAdventureHighScore(), highScore, score)
      committed = persistAdventureHighScore(highScore) && this.removeStoredAdventureRun()
    } else {
      committed = persistAdventureRun(candidate)
    }
    if (!committed) {
      this.state.adventure = { ...this.state.adventure, pendingCompletion: { outcome } }
      this.state.status = ADVENTURE_RESULT_WARNING
      return
    }
    // The next attempt or tier, or a removed run, no longer matches any saved
    // game, so clearing the slot is only cleanup.
    clearStoredAdventureGameSnapshot()
    this.unsavedConversionRunId = null
    this.clearAiTimeout()
    this.state.adventure = {
      run: candidate,
      highScore,
      hasSavedRun: !terminal,
      pendingCompletion: null,
      lastResult: { outcome, tierIndex: run.currentTierIndex, nodeId, score },
    }
    // The hub replaces the finished board; the recording stays exportable.
    this.state.game = null
    this.state.status = adventureResultStatus(candidate, outcome, score, highScore)
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
    if (
      this.state.mode === 'adventure-hvai'
      && action.type === 'play_land'
      && this.state.adventure.run?.status === 'active'
      && this.state.adventure.run.stage === 'encounter'
    ) {
      // Update the in-memory counter only; writing the run (with its
      // ten-deck map) on every summon would add main-thread jank. The next
      // committed transition (result, pause) saves it. Route fields are
      // never changed in place.
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

  setMonochromeCards(enabled: boolean): void {
    this.state.monochromeCards = enabled
    persistMonochromeCards(enabled)
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
    if (this.state.adventure.pendingCompletion) {
      this.state.status = ADVENTURE_PENDING_NOTICE
      this.notify()
      return
    }
    const current = this.state.adventure.run
    if (this.state.mode === 'adventure-hvai' && current && isResumableAdventureRun(current)) {
      // A stale or repeated Start while a run is open must not replace it.
      return
    }
    // Persistence first: the new run replaces any saved run only once the
    // write succeeds, so a refused write keeps the previous state.
    const run = createAdventureRun(adventureClockSeed(), createAdventureRunId())
    if (!persistAdventureRun(run)) {
      this.state.status = `${ADVENTURE_STORAGE_WARNING} The Adventure did not start.`
      this.notify()
      return
    }
    this.unsavedConversionRunId = null
    clearStoredAdventureGameSnapshot()
    this.enterAdventureHub()
    this.state.adventure = {
      run,
      highScore: this.state.adventure.highScore,
      hasSavedRun: true,
      pendingCompletion: null,
      lastResult: null,
    }
    this.state.status = 'Adventure started. Choose your first encounter.'
    this.notify()
  }

  startAdventureNode(nodeId: string): void {
    const adventure = this.state.adventure
    const run = adventure.run
    // Re-read the latest state: a stale or repeated activation after an
    // encounter started (or while a result waits to be saved) does nothing.
    if (
      this.state.mode !== 'adventure-hvai'
      || this.isReplayActive()
      || this.state.game !== null
      || adventure.pendingCompletion !== null
      || !run
      || !isResumableAdventureRun(run)
    ) {
      return
    }
    const candidate = startAdventureEncounter(run, nodeId)
    const node = candidate ? selectedAdventureNode(candidate) : null
    if (!candidate || !node) {
      this.state.status = 'That encounter is not available. Choose a highlighted encounter.'
      this.notify()
      return
    }
    // Persistence first: a refused write keeps the map, the same choices and
    // the attempt number.
    if (!persistAdventureRun(candidate)) {
      this.state.status = `${ADVENTURE_STORAGE_WARNING} The encounter did not start.`
      this.notify()
      return
    }
    this.unsavedConversionRunId = null
    // Identity matching rejects older saved games; clearing is cleanup only.
    clearStoredAdventureGameSnapshot()
    this.state.adventure = { ...adventure, run: candidate, hasSavedRun: true, lastResult: null }
    this.launchAdventureGame(candidate, null)
    const opponent = displayAdventureOpponentLabel(node.opponent.kind, node.opponent.lands)
    this.state.status = `Tier ${candidate.currentTierIndex + 1} encounter started against ${opponent}.`
    this.notify()
    this.scheduleAiIfNeeded()
  }

  retryAdventureCompletion(): void {
    const { run, pendingCompletion } = this.state.adventure
    if (this.state.mode !== 'adventure-hvai' || !run || !pendingCompletion) {
      return
    }
    this.commitAdventureResult(run, pendingCompletion.outcome)
    this.notify()
  }

  resumeAdventure(): void {
    if (this.isReplayActive()) {
      this.state.status = 'Adventure is unavailable during replay.'
      this.notify()
      return
    }
    if (this.state.adventure.pendingCompletion) {
      this.state.status = ADVENTURE_PENDING_NOTICE
      this.notify()
      return
    }
    if (this.state.mode === 'adventure-hvai') {
      // A stale or repeated Resume after the run already opened.
      return
    }
    // Read once. A version 1 run arrives converted in memory; its first
    // version 2 write is the next committed transition.
    const record = this.readAdventureRunRecord()
    if (!record || !isResumableAdventureRun(record.run)) {
      this.state.status = 'No paused adventure run found.'
      this.refreshAdventureFromStorage()
      this.notify()
      return
    }
    const stored = record.run
    const tier = stored.currentTierIndex + 1
    const slot = readStoredAdventureGameSnapshot()
    const highScore = readStoredAdventureHighScore()
    // Restore a mid-game save only for a run paused at its encounter, when
    // the save belongs to the same run, node, attempt number and attempt
    // seed, and the game is still in progress. The run is marked active
    // before launching, so the same save is never restored twice.
    if (
      stored.status === 'paused'
      && stored.stage === 'encounter'
      && slot.kind === 'envelope'
      && slot.envelope.game.phase !== 'gameOver'
      && isAdventureGameSnapshotForRun(slot.envelope, stored)
    ) {
      const resumed = resumeAdventureEncounter(stored)
      if (!persistAdventureRun(resumed)) {
        this.state.status = `${ADVENTURE_STORAGE_WARNING} The Adventure was not resumed.`
        this.notify()
        return
      }
      this.unsavedConversionRunId = null
      this.enterAdventureHub()
      this.state.adventure = { run: resumed, highScore, hasSavedRun: true, pendingCompletion: null, lastResult: null }
      this.launchAdventureGame(resumed, slot.envelope.game)
      clearStoredAdventureGameSnapshot()
      this.state.status = `Adventure resumed at Tier ${tier}.`
      this.notify()
      this.scheduleAiIfNeeded()
      return
    }
    // Everything else opens the map without writing. A run saved mid-encounter
    // keeps its committed node and attempt, so the encounter restarts from the
    // same seed without using a chance. Warn whenever a game was lost,
    // including a tab closed without pausing; other stale saves are cleaned up
    // quietly.
    const lostGame = stored.stage === 'encounter' || (record.migratedFromV1 && slot.kind === 'legacy')
    if (slot.kind !== 'none') {
      clearStoredAdventureGameSnapshot()
    }
    this.enterAdventureHub()
    this.state.adventure = {
      run: openAdventureMap(stored),
      highScore,
      hasSavedRun: true,
      pendingCompletion: null,
      lastResult: null,
    }
    this.state.status = lostGame
      ? `Adventure resumed at Tier ${tier}. The saved game could not be restored, so the encounter restarts without using a chance.`
      : `Adventure resumed at Tier ${tier}.`
    this.notify()
  }

  pauseAdventure(): void {
    if (this.state.mode !== 'adventure-hvai' || this.isReplayActive()) {
      return
    }
    const adventure = this.state.adventure
    const run = adventure.run
    if (!run || !isResumableAdventureRun(run)) {
      return
    }
    if (adventure.pendingCompletion) {
      this.state.status = ADVENTURE_PENDING_NOTICE
      this.notify()
      return
    }
    const game = this.state.game
    if (run.stage === 'encounter' && (!game || game.phase === 'gameOver')) {
      // A finished game is committed (or waiting to be saved) first.
      return
    }
    const paused = pauseAdventureRun(run)
    // Mid-encounter, save the live game bound to this attempt, then the
    // paused run. Leave for the lobby only after both writes succeed; a
    // refused write keeps the encounter (or the map) open so Pause can be
    // retried.
    if (run.stage === 'encounter' && game) {
      if (!persistAdventureGameSnapshot(run, game)) {
        this.state.status = `${ADVENTURE_STORAGE_WARNING} The game was not paused.`
        this.notify()
        return
      }
      if (!persistAdventureRun(paused)) {
        clearStoredAdventureGameSnapshot()
        this.state.status = `${ADVENTURE_STORAGE_WARNING} The game was not paused.`
        this.notify()
        return
      }
    } else if (!persistAdventureRun(paused)) {
      this.state.status = `${ADVENTURE_STORAGE_WARNING} The Adventure was not paused.`
      this.notify()
      return
    }
    this.unsavedConversionRunId = null
    this.resetToLobby(`Adventure paused at Tier ${paused.currentTierIndex + 1}.`)
    this.state.adventure = {
      run: paused,
      highScore: adventure.highScore,
      hasSavedRun: true,
      pendingCompletion: null,
      lastResult: null,
    }
    this.notify()
  }

  abandonAdventure(): void {
    const adventure = this.state.adventure
    const hadAdventure = adventure.run !== null || adventure.hasSavedRun || adventure.pendingCompletion !== null
    // Reset is the explicit way out of every Adventure state, including a
    // result waiting to be saved. A new run ID makes any leftover save stale,
    // so clearing the game slot is cleanup only.
    clearStoredAdventureGameSnapshot()
    const removed = this.removeStoredAdventureRun()
    this.unsavedConversionRunId = null
    if (this.state.mode === 'adventure-hvai') {
      this.resetToLobby()
    }
    // Show what storage now holds: a run that could not be removed reappears.
    this.refreshAdventureFromStorage()
    if (!removed) {
      this.state.status = 'Adventure run could not be reset (storage unavailable).'
    } else if (hadAdventure) {
      this.state.status = 'Adventure run reset.'
    }
    this.notify()
  }

  startGame(mode: Mode): void {
    if (mode === 'adventure-hvai') {
      this.startAdventure()
      return
    }
    if (this.state.adventure.pendingCompletion) {
      this.state.status = ADVENTURE_PENDING_NOTICE
      this.notify()
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
    // Starting another mode never writes or deletes Adventure progress. Every
    // Adventure transition is saved when it happens, so the lobby simply
    // shows the stored run (an 'active' one as paused) for a later resume.
    this.refreshAdventureFromStorage()

    if (mode === 'local-hvh') {
      this.state.controllers = ['human', 'human']
      this.state.status = 'Local Human vs Human game started.'
    } else if (mode === 'local-hvai') {
      this.state.controllers = ['human', 'ai']
      this.state.status = 'Local Human vs AI game started.'
    } else if (mode === 'local-aivai') {
      this.state.controllers = ['ai', 'ai']
      this.state.status = 'Local AI vs AI simulation started.'
    } else if (mode === 'tutorial') {
      this.state.controllers = ['human', 'ai']
      this.state.status = 'Tutorial started. Follow the hint panel to learn each creature ability.'
      this.state.offer = ''
      this.state.answer = ''
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
    if (this.state.adventure.pendingCompletion) {
      this.state.status = ADVENTURE_PENDING_NOTICE
      this.notify()
      return
    }
    // Leaving never writes Adventure progress: each transition was saved when
    // it happened, so the lobby shows the stored run. Leaving mid-encounter
    // without Pause keeps no game, and the encounter restarts on resume
    // without using a chance.
    this.resetToLobby(statusMessage)
    this.refreshAdventureFromStorage()
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
      this.state.status = 'Rematch is unavailable in Adventure. Continue from the Adventure map.'
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
    if (this.state.adventure.pendingCompletion) {
      this.state.status = ADVENTURE_PENDING_NOTICE
      this.notify()
      return
    }
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
    // Only block replay while Adventure mode is open (an encounter or the
    // map). A merely-saved (paused) run should not prevent users from playing
    // recordings; their adventure progress is preserved in storage and can
    // be resumed later from the lobby.
    if (this.state.mode === 'adventure-hvai') {
      this.state.status = 'Replay is unavailable while an Adventure is open. Pause or leave the Adventure first.'
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
