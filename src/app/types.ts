import type { GameAction, GamePhase, GameState } from '../game/types'
import type { GameRecordFile } from './game-recording'

export type Mode = 'local-hvh' | 'local-hvai' | 'local-aivai' | 'p2p-host' | 'p2p-join'
export type ControllerKind = 'human' | 'ai' | 'remote'
export type RendererKind = 'dom' | 'phaser'

export interface AppState {
  mode: Mode | null
  game: GameState | null
  controllers: [ControllerKind, ControllerKind]
  seed: number
  offer: string
  answer: string
  status: string
  renderer: RendererKind
  recording: GameRecordFile | null
  replay: ReplaySessionState | null
  hasSavedRecording: boolean
  // True once a P2P game's `start` packet has been acknowledged by the
  // peer (host receives `start-ack`) or applied by the joiner (joiner
  // received the `start` packet and acknowledged it). Used by renderers
  // to decide when to leave the lobby for an in-match scene: P2P sessions
  // stay in the lobby until BOTH peers have synchronized seeds confirmed
  // via the application-level handshake.
  p2pStarted: boolean
  // Host-side: the seed the host queued in a `start` packet but has not
  // yet received an ack for. Stays non-null while the host is waiting on
  // the joiner's `start-ack`. When the ack arrives the host applies this
  // seed (it already initialized state.game from this seed in startP2PGame()
  // because the seed is also used locally to keep the deck shuffle
  // deterministic for both peers) and clears the field.
  pendingP2PStartSeed: number | null
  // Host-side (rematch initiator): the new seed the host queued in a
  // `rematch` packet but has not yet received an ack for. While set the
  // rematch is "in flight" — local seed/game/recording have NOT yet been
  // mutated. When the ack arrives the host applies this seed, recreates
  // the game, reinitializes the recording, and clears the field. If the
  // peer never acks, the previous game stays intact on this side.
  pendingRematchSeed: number | null
}

export interface ReplaySessionState {
  record: GameRecordFile
  step: number
  isPlaying: boolean
}

export interface UiCard {
  id: string
  name: string
}

export interface UiBattlefieldCard {
  instanceId: string
  name: string
}

export interface PlayerUiState {
  id: number
  handCount: number
  deckCount: number
  graveyardCount: number
  handCards: UiCard[]
  battlefield: UiBattlefieldCard[]
}

export interface PlayLandOption {
  action: Extract<GameAction, { type: 'play_land' }>
  label: string
}

export interface CounterOption {
  action: Extract<GameAction, { type: 'counter_land' }>
  label: string
}

export interface GameUiState {
  turn: number
  phase: GamePhase
  winnerText: string
  actor: number
  actorControl: ControllerKind
  canInput: boolean
  pendingLandName: string | null
  players: [PlayerUiState, PlayerUiState]
  legal: {
    playLandByCard: Record<string, PlayLandOption[]>
    counterOptions: CounterOption[]
    canEndTurn: boolean
    canPassResponse: boolean
  }
  log: string[]
  isReplay: boolean
}

export interface AppViewModel {
  mode: Mode | null
  renderer: RendererKind
  status: string
  offer: string
  answer: string
  seed: number
  controllers: [ControllerKind, ControllerKind]
  p2pConnected: boolean
  p2pStarted: boolean
  game: GameUiState | null
  recording: {
    canSave: boolean
    canLoadLocal: boolean
    hasLocalSave: boolean
    metadata: {
      seed: number
      mode: Mode
      controllers: [ControllerKind, ControllerKind]
      completed: boolean
    } | null
  }
  replay: {
    active: boolean
    step: number
    totalSteps: number
    isPlaying: boolean
  }
}
