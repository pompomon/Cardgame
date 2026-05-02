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
