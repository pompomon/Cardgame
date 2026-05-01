export type BasicLand = 'Forest' | 'Island' | 'Mountain' | 'Plains' | 'Swamp'
export type CardType = 'land'

export interface Card {
  id: string
  name: BasicLand
  type: CardType
}

export interface BattlefieldCard {
  instanceId: string
  card: Card
}

export interface PlayerState {
  id: number
  deck: Card[]
  hand: Card[]
  battlefield: BattlefieldCard[]
  graveyard: Card[]
  landsPlayedThisTurn: number
}

export type GamePhase = 'main' | 'respond' | 'gameOver'

export type Winner = number | 'draw' | null

export interface PendingLandPlay {
  actor: number
  card: Card
  effectTargetId?: string
}

export interface GameState {
  players: [PlayerState, PlayerState]
  turn: number
  currentPlayer: number
  nextInstanceId: number
  phase: GamePhase
  pendingLandPlay: PendingLandPlay | null
  winner: Winner
  log: string[]
}

export type GameAction =
  | { type: 'play_land'; actor: number; cardId: string; effectTargetId?: string }
  | { type: 'end_turn'; actor: number }
  | { type: 'counter_land'; actor: number; discardCardId?: string }
  | { type: 'pass_response'; actor: number }
