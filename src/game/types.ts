export type CardType = 'land' | 'creature'

export interface Card {
  id: string
  name: string
  type: CardType
  cost: number
  power: number
  toughness: number
}

export interface BattlefieldCard {
  instanceId: string
  card: Card
  tapped: boolean
  summoningSickness: boolean
}

export interface PlayerState {
  id: number
  life: number
  deck: Card[]
  hand: Card[]
  battlefield: BattlefieldCard[]
  graveyard: Card[]
  landsPlayedThisTurn: number
}

export type GamePhase = 'main' | 'declareAttackers' | 'declareBlockers' | 'gameOver'

export type Winner = number | 'draw' | null

export interface GameState {
  players: [PlayerState, PlayerState]
  turn: number
  currentPlayer: number
  phase: GamePhase
  attackers: string[]
  winner: Winner
  log: string[]
}

export type GameAction =
  | { type: 'play_land'; actor: number; cardId: string }
  | { type: 'cast_creature'; actor: number; cardId: string }
  | { type: 'end_main'; actor: number }
  | { type: 'declare_attackers'; actor: number; attackerIds: string[] }
  | { type: 'declare_blockers'; actor: number; blocks: Record<string, string | null> }
