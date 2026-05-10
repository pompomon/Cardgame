import { createStarterDeck } from '../game/cards'
import { BASIC_LANDS, isBasicLand, type BasicLand, type Card, type GameState } from '../game/types'

export const ADVENTURE_RUN_STORAGE_KEY = 'cardgame.adventure-run'
export const ADVENTURE_HIGH_SCORE_STORAGE_KEY = 'cardgame.adventure-high-score'
export const ADVENTURE_GAME_STORAGE_KEY = 'cardgame.adventure-game'

export type AdventureOpponentKind = 'standard' | 'dual' | 'mono' | 'random'
export type AdventureRunStatus = 'active' | 'paused' | 'completed' | 'failed'

export interface AdventureOpponentDeck {
  id: string
  label: string
  kind: AdventureOpponentKind
  lands: BasicLand[]
  deck: Card[]
}

export interface AdventureRunState {
  baseSeed: number
  currentRound: number
  remainingChances: number
  winStreak: number
  totalRoundsPlayed: number
  totalCardsPlayed: number
  currentOpponentIndex: number
  activeGameSeed: number | null
  status: AdventureRunStatus
  opponentLineup: AdventureOpponentDeck[]
}

function lcg(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function shuffle<T>(items: T[], seed: number): T[] {
  const random = lcg(seed)
  const clone = [...items]
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]]
  }
  return clone
}

function cloneDeck(deck: Card[]): Card[] {
  return deck.map((card) => ({ ...card }))
}

function buildDeckFromCounts(
  ownerKey: string,
  counts: Partial<Record<BasicLand, number>>,
  seed: number,
): Card[] {
  const cards: Card[] = []
  for (const land of BASIC_LANDS) {
    const amount = counts[land] ?? 0
    for (let index = 0; index < amount; index += 1) {
      cards.push({
        id: `${ownerKey}-${land.toLowerCase()}-${index}`,
        name: land,
        type: 'land',
      })
    }
  }
  return shuffle(cards, seed)
}

function createStandardDeck(ownerKey: string, seed: number): Card[] {
  const counts: Partial<Record<BasicLand, number>> = {}
  for (const land of BASIC_LANDS) {
    counts[land] = 10
  }
  return buildDeckFromCounts(ownerKey, counts, seed)
}

function createDualDeck(ownerKey: string, first: BasicLand, second: BasicLand, seed: number): Card[] {
  return buildDeckFromCounts(ownerKey, { [first]: 25, [second]: 25 }, seed)
}

function createMonoDeck(ownerKey: string, land: BasicLand, seed: number): Card[] {
  return buildDeckFromCounts(ownerKey, { [land]: 50 }, seed)
}

function createRandomDeck(ownerKey: string, seed: number): Card[] {
  const random = lcg(seed)
  const cards: Card[] = []
  for (let index = 0; index < 50; index += 1) {
    const land = BASIC_LANDS[Math.floor(random() * BASIC_LANDS.length)]
    cards.push({
      id: `${ownerKey}-${land.toLowerCase()}-${index}`,
      name: land,
      type: 'land',
    })
  }
  return shuffle(cards, seed + 17)
}

function dualLandPairs(): Array<[BasicLand, BasicLand]> {
  const pairs: Array<[BasicLand, BasicLand]> = []
  for (let i = 0; i < BASIC_LANDS.length; i += 1) {
    for (let j = i + 1; j < BASIC_LANDS.length; j += 1) {
      pairs.push([BASIC_LANDS[i], BASIC_LANDS[j]])
    }
  }
  return pairs
}

export function buildAdventureLineup(seed: number): AdventureOpponentDeck[] {
  const nonBossPool: AdventureOpponentDeck[] = []
  nonBossPool.push({
    id: 'standard',
    label: 'Standard Deck (10 of each land)',
    kind: 'standard',
    lands: [...BASIC_LANDS],
    deck: createStandardDeck('opp-standard', seed + 100),
  })

  const pairs = dualLandPairs()
  pairs.forEach((pair, index) => {
    nonBossPool.push({
      id: `dual-${pair[0]}-${pair[1]}`,
      label: `Dual ${pair[0]}/${pair[1]} Deck`,
      kind: 'dual',
      lands: [pair[0], pair[1]],
      deck: createDualDeck(`opp-dual-${index}`, pair[0], pair[1], seed + 200 + index * 13),
    })
  })

  nonBossPool.push({
    id: 'random',
    label: 'Fully Random Deck',
    kind: 'random',
    lands: [...BASIC_LANDS],
    deck: createRandomDeck('opp-random', seed + 600),
  })

  const bossPool: AdventureOpponentDeck[] = BASIC_LANDS.map((land, index) => ({
    id: `boss-${land}`,
    label: `Boss: Mono ${land} Deck`,
    kind: 'mono',
    lands: [land],
    deck: createMonoDeck(`opp-boss-${index}`, land, seed + 900 + index * 13),
  }))

  const chosenNonBoss = shuffle(nonBossPool, seed + 300).slice(0, 6)
  const chosenBoss = shuffle(bossPool, seed + 301)[0]
  return [...chosenNonBoss, chosenBoss].map((entry, index) => ({
    ...entry,
    id: `adventure-opponent-${index + 1}-${entry.id}`,
    deck: cloneDeck(entry.deck),
  }))
}

export function createAdventureRun(seed: number): AdventureRunState {
  return {
    baseSeed: seed,
    currentRound: 1,
    remainingChances: 3,
    winStreak: 0,
    totalRoundsPlayed: 0,
    totalCardsPlayed: 0,
    currentOpponentIndex: 0,
    activeGameSeed: seed,
    status: 'active',
    opponentLineup: buildAdventureLineup(seed),
  }
}

export function deckPairForAdventureGame(run: AdventureRunState, seed: number): [Card[], Card[]] {
  const opponent = run.opponentLineup[run.currentOpponentIndex]
  const playerDeck = createStarterDeck(0, seed)
  const opponentDeck = opponent ? cloneDeck(opponent.deck) : createStarterDeck(1, seed + 1)
  return [playerDeck, opponentDeck]
}

export function computeAdventureScore(run: AdventureRunState): number {
  return run.remainingChances * 100 - run.totalCardsPlayed + run.totalRoundsPlayed * 5
}

function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const card = value as { id?: unknown; name?: unknown; type?: unknown }
  return typeof card.id === 'string' && isBasicLand(card.name) && card.type === 'land'
}

function isAdventureOpponentDeck(value: unknown): value is AdventureOpponentDeck {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as {
    id?: unknown
    label?: unknown
    kind?: unknown
    lands?: unknown
    deck?: unknown
  }
  return typeof entry.id === 'string'
    && typeof entry.label === 'string'
    && (entry.kind === 'standard' || entry.kind === 'dual' || entry.kind === 'mono' || entry.kind === 'random')
    && Array.isArray(entry.lands)
    && entry.lands.every((land) => isBasicLand(land))
    && Array.isArray(entry.deck)
    && entry.deck.length === 50
    && entry.deck.every((card) => isCard(card))
}

function isAdventureRunStatus(value: unknown): value is AdventureRunStatus {
  return value === 'active' || value === 'paused' || value === 'completed' || value === 'failed'
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

function isAdventureRunState(value: unknown): value is AdventureRunState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const run = value as {
    baseSeed?: unknown
    currentRound?: unknown
    remainingChances?: unknown
    winStreak?: unknown
    totalRoundsPlayed?: unknown
    totalCardsPlayed?: unknown
    currentOpponentIndex?: unknown
    activeGameSeed?: unknown
    status?: unknown
    opponentLineup?: unknown
  }
  if (!isFiniteInteger(run.baseSeed)) return false
  if (!isFiniteInteger(run.currentRound) || run.currentRound < 1 || run.currentRound > 7) return false
  if (!isFiniteInteger(run.remainingChances) || run.remainingChances < 0) return false
  if (!isFiniteInteger(run.winStreak) || run.winStreak < 0) return false
  if (!isFiniteInteger(run.totalRoundsPlayed) || run.totalRoundsPlayed < 0) return false
  if (!isFiniteInteger(run.totalCardsPlayed) || run.totalCardsPlayed < 0) return false
  if (!isFiniteInteger(run.currentOpponentIndex) || run.currentOpponentIndex < 0 || run.currentOpponentIndex > 6) return false
  if (run.activeGameSeed !== null && !isFiniteInteger(run.activeGameSeed)) return false
  if (!isAdventureRunStatus(run.status)) return false
  if (!Array.isArray(run.opponentLineup) || run.opponentLineup.length !== 7) return false
  return run.opponentLineup.every((entry) => isAdventureOpponentDeck(entry))
}

export function persistAdventureRun(run: AdventureRunState): void {
  try {
    localStorage.setItem(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(run))
  } catch {
    // Ignore storage failures.
  }
}

export function clearStoredAdventureRun(): void {
  try {
    localStorage.removeItem(ADVENTURE_RUN_STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

export function readStoredAdventureRun(): AdventureRunState | null {
  try {
    const raw = localStorage.getItem(ADVENTURE_RUN_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    return isAdventureRunState(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function readStoredAdventureHighScore(): number {
  try {
    const raw = localStorage.getItem(ADVENTURE_HIGH_SCORE_STORAGE_KEY)
    if (raw === null) {
      return 0
    }
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

export function persistAdventureHighScore(score: number): void {
  try {
    localStorage.setItem(ADVENTURE_HIGH_SCORE_STORAGE_KEY, String(score))
  } catch {
    // Ignore storage failures.
  }
}

export function persistAdventureGameSnapshot(game: GameState): void {
  try {
    localStorage.setItem(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(game))
  } catch {
    // Ignore storage failures.
  }
}

export function clearStoredAdventureGameSnapshot(): void {
  try {
    localStorage.removeItem(ADVENTURE_GAME_STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function isBattlefieldCard(value: unknown): value is { instanceId: string; card: Card } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as { instanceId?: unknown; card?: unknown }
  return typeof entry.instanceId === 'string' && isCard(entry.card)
}

function isPlayerStateSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const player = value as {
    id?: unknown
    deck?: unknown
    hand?: unknown
    battlefield?: unknown
    graveyard?: unknown
    landsPlayedThisTurn?: unknown
  }
  return typeof player.id === 'number' && Number.isInteger(player.id)
    && Array.isArray(player.deck) && player.deck.every((entry) => isCard(entry))
    && Array.isArray(player.hand) && player.hand.every((entry) => isCard(entry))
    && Array.isArray(player.battlefield) && player.battlefield.every((entry) => isBattlefieldCard(entry))
    && Array.isArray(player.graveyard) && player.graveyard.every((entry) => isCard(entry))
    && typeof player.landsPlayedThisTurn === 'number' && Number.isFinite(player.landsPlayedThisTurn)
}

function isGameStateSnapshot(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as {
    players?: unknown
    turn?: unknown
    currentPlayer?: unknown
    nextInstanceId?: unknown
    phase?: unknown
    pendingLandPlay?: unknown
    pendingPlainsReuse?: unknown
    winner?: unknown
    log?: unknown
  }
  if (!Array.isArray(candidate.players) || candidate.players.length !== 2) return false
  if (!candidate.players.every((entry) => isPlayerStateSnapshot(entry))) return false
  if (typeof candidate.turn !== 'number' || !Number.isFinite(candidate.turn)) return false
  if (typeof candidate.currentPlayer !== 'number' || (candidate.currentPlayer !== 0 && candidate.currentPlayer !== 1)) return false
  if (typeof candidate.nextInstanceId !== 'number' || !Number.isFinite(candidate.nextInstanceId)) return false
  if (candidate.phase !== 'main' && candidate.phase !== 'respond' && candidate.phase !== 'plains_target' && candidate.phase !== 'gameOver') return false
  if (candidate.pendingLandPlay !== null && (typeof candidate.pendingLandPlay !== 'object')) return false
  if (candidate.pendingPlainsReuse !== null && (typeof candidate.pendingPlainsReuse !== 'object')) return false
  if (candidate.winner !== null && candidate.winner !== 'draw' && candidate.winner !== 0 && candidate.winner !== 1) return false
  if (!Array.isArray(candidate.log) || !candidate.log.every((entry) => typeof entry === 'string')) return false
  return true
}

export function readStoredAdventureGameSnapshot(): GameState | null {
  try {
    const raw = localStorage.getItem(ADVENTURE_GAME_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    return isGameStateSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}
