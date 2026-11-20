import { buildAdventureOpponentPools, type AdventureOpponentDeck } from '../../app/adventure-map'
import { deriveAiSeed } from '../../game/ai-random'
import { createStarterDeck } from '../../game/cards'
import type { GameState, LogEvent } from '../../game/types'
import {
  formatPercent,
  playGame,
  wilsonInterval,
  type DeckPair,
  type TournamentEntrant,
  type TournamentPolicy,
} from './ai-tournament'

// Measures every Adventure opponent deck against the standard deck (ten of
// each land, the deck the player brings to every encounter) in best-of-three
// series. The opt-in tool `src/test/tools/adventure-decks.tool.ts` runs it;
// docs/research/adventure-deck-strength.md records the results.

/**
 * Who moves first. `adventure` seats the standard deck first, as Adventure
 * seats the player; `swapped` seats the Adventure deck first.
 */
export type AdventureSimSeating = 'adventure' | 'swapped'

export const ADVENTURE_SIM_SEATINGS: readonly AdventureSimSeating[] = ['adventure', 'swapped']

export function isAdventureSimSeating(value: unknown): value is AdventureSimSeating {
  return typeof value === 'string' && (ADVENTURE_SIM_SEATINGS as readonly string[]).includes(value)
}

/** Every Adventure deck id in pool order: the twelve non-boss decks, then the five bosses. */
export const ADVENTURE_SIM_DECK_IDS: readonly string[] = (() => {
  const pools = buildAdventureOpponentPools(0)
  return Object.freeze([...pools.nonBoss, ...pools.boss].map((deck) => deck.id))
})()

export function isAdventureSimDeckId(value: unknown): value is string {
  return typeof value === 'string' && ADVENTURE_SIM_DECK_IDS.includes(value)
}

/** The seat of the Adventure deck. */
export function adventureDeckSeat(seating: AdventureSimSeating): 0 | 1 {
  switch (seating) {
    case 'adventure':
      return 1
    case 'swapped':
      return 0
    default:
      return 1
  }
}

// Tags that keep the seeds of games and of Adventure pools apart.
const SIM_GAME_WORD = 0x61647367
const SIM_POOL_WORD = 0x6164706c

/**
 * The seed of game `game` (0-based) of series `series`. It is mixed because
 * the engine's shuffle gives nearly the same first draw for consecutive seeds.
 * Every deck and matchup uses the same seeds, so within a seating the standard
 * deck meets each Adventure deck with the same shuffles.
 */
export function adventureSimGameSeed(series: number, game: number): number {
  return deriveAiSeed(series, game, SIM_GAME_WORD)
}

/** The Adventure deck `deckId` as `buildAdventureOpponentPools(poolSeed)` builds it. */
export function adventureDeckForSim(deckId: string, poolSeed: number): AdventureOpponentDeck {
  const pools = buildAdventureOpponentPools(poolSeed)
  const deck = [...pools.nonBoss, ...pools.boss].find((entry) => entry.id === deckId)
  if (!deck) {
    throw new Error(`Unknown Adventure deck "${deckId}". Known: ${ADVENTURE_SIM_DECK_IDS.join(', ')}`)
  }
  return deck
}

/**
 * Decks by seat for one game. Both are shuffled for every game, and the random
 * deck is redrawn too; a run keeps one random deck in one order.
 */
export function adventureSimDecks(deckId: string, seating: AdventureSimSeating, gameSeed: number): DeckPair {
  const adventureSeat = adventureDeckSeat(seating)
  const adventure = adventureDeckForSim(deckId, deriveAiSeed(gameSeed, SIM_POOL_WORD)).deck
  const standard = createStarterDeck(adventureSeat === 1 ? 0 : 1, gameSeed)
  return adventureSeat === 1 ? [standard, adventure] : [adventure, standard]
}

/** Ability use of one side, summed over games. */
export interface AdventureSimTally {
  /** Lands that resolved; countered lands are not included. */
  lands: number
  /** Island counters (Intercept). */
  intercepts: number
  /** Mountain destroys (Banish), Mimic copies included. */
  banishes: number
  /** Swamp discards (Drain Memory), Mimic copies included. */
  drains: number
  /** Forest returns (Reclaim), Mimic copies included. */
  reclaims: number
  /** Plains reuses (Mimic). */
  mimics: number
  /** Draws beyond the turn draw: Island (Listen In), Mimic copies included. */
  extraDraws: number
}

export const ADVENTURE_SIM_TALLY_KEYS: readonly (keyof AdventureSimTally)[] = [
  'lands',
  'intercepts',
  'banishes',
  'drains',
  'reclaims',
  'mimics',
  'extraDraws',
]

/** How a game was won: five different lands, five of one land, or the loser drew from an empty deck. */
export type AdventureSimWinKind = 'fiveDifferent' | 'fiveSame' | 'deckOut'

export const ADVENTURE_SIM_WIN_KINDS: readonly AdventureSimWinKind[] = ['fiveDifferent', 'fiveSame', 'deckOut']

/** Results from the Adventure deck's side. */
export type AdventureSimOutcome = 'win' | 'loss' | 'draw'

export interface AdventureSimGame {
  readonly seed: number
  /** A drawn game or one that hit the step cap counts as a draw. */
  readonly outcome: AdventureSimOutcome
  /** Whether the game hit the step cap. */
  readonly unfinished: boolean
  readonly turns: number
  /** `null` unless a side won. */
  readonly winKind: AdventureSimWinKind | null
  readonly adventure: AdventureSimTally
  readonly standard: AdventureSimTally
}

export interface AdventureSimSeries {
  readonly outcome: AdventureSimOutcome
  readonly games: readonly AdventureSimGame[]
}

/** The two sides of a series: the Adventure deck's player and the standard deck's player. */
export interface AdventureSimPolicies {
  readonly adventure: TournamentPolicy
  readonly standard: TournamentPolicy
}

export function emptyAdventureSimTally(): AdventureSimTally {
  return { lands: 0, intercepts: 0, banishes: 0, drains: 0, reclaims: 0, mimics: 0, extraDraws: 0 }
}

/** Adds the events of one engine step to the tallies by seat. */
export function tallyAdventureSimEvents(events: readonly LogEvent[], tallies: readonly [AdventureSimTally, AdventureSimTally]): void {
  const draws = [0, 0]
  for (const event of events) {
    switch (event.kind) {
      case 'play_land':
        tallies[event.actor].lands += 1
        break
      case 'counter_resolved':
        tallies[event.actor].intercepts += 1
        break
      case 'ability_mountain_destroy':
        tallies[event.actor].banishes += 1
        break
      case 'ability_swamp_discard':
        tallies[event.actor].drains += 1
        break
      case 'ability_forest_return':
        tallies[event.actor].reclaims += 1
        break
      case 'ability_plains_reuse':
        tallies[event.actor].mimics += 1
        break
      case 'draw':
        draws[event.actor] += 1
        break
      // Every turn draw comes with the turn_start of the same seat.
      case 'turn_start':
        draws[event.actor] -= 1
        break
      default:
        break
    }
  }
  tallies[0].extraDraws += Math.max(0, draws[0])
  tallies[1].extraDraws += Math.max(0, draws[1])
}

function winKindOf(state: GameState, deckOut: boolean): AdventureSimWinKind | null {
  const winner = state.winner
  if (typeof winner !== 'number') {
    return null
  }
  if (deckOut) {
    return 'deckOut'
  }
  const names = new Set(state.players[winner].battlefield.map((entry) => entry.card.name))
  return names.size === 5 ? 'fiveDifferent' : 'fiveSame'
}

/** Plays one game of `deckId` against the standard deck. */
export function playAdventureSimGame(
  deckId: string,
  seating: AdventureSimSeating,
  policies: AdventureSimPolicies,
  seed: number,
): AdventureSimGame {
  const adventureSeat = adventureDeckSeat(seating)
  const standardSeat = adventureSeat === 1 ? 0 : 1
  const seatPolicies: [TournamentPolicy, TournamentPolicy] = adventureSeat === 1
    ? [policies.standard, policies.adventure]
    : [policies.adventure, policies.standard]
  const tallies: [AdventureSimTally, AdventureSimTally] = [emptyAdventureSimTally(), emptyAdventureSimTally()]
  const played = playGame(seed, seatPolicies, {
    decks: adventureSimDecks(deckId, seating, seed),
    onEvents: (events) => tallyAdventureSimEvents(events, tallies),
  })
  let outcome: AdventureSimOutcome = 'draw'
  if (played.winner === adventureSeat) {
    outcome = 'win'
  } else if (played.winner === standardSeat) {
    outcome = 'loss'
  }
  return {
    seed,
    outcome,
    unfinished: played.winner === null,
    turns: played.turns,
    winKind: winKindOf(played.finalState, played.deckOut),
    adventure: tallies[adventureSeat],
    standard: tallies[standardSeat],
  }
}

/**
 * Plays a best-of-three series with `play(game)` for game 0, 1 and 2: games
 * stop once a side has two wins, and drawn games count towards the three.
 * After three games the side with more wins takes the series; otherwise it
 * is drawn.
 */
export function bestOfThree(play: (game: number) => AdventureSimGame): AdventureSimSeries {
  const games: AdventureSimGame[] = []
  let wins = 0
  let losses = 0
  for (let game = 0; game < 3 && wins < 2 && losses < 2; game += 1) {
    const played = play(game)
    games.push(played)
    if (played.outcome === 'win') {
      wins += 1
    } else if (played.outcome === 'loss') {
      losses += 1
    }
  }
  let outcome: AdventureSimOutcome = 'draw'
  if (wins > losses) {
    outcome = 'win'
  } else if (losses > wins) {
    outcome = 'loss'
  }
  return { outcome, games }
}

/** Plays series `series` of `deckId` against the standard deck. */
export function playAdventureSimSeries(
  deckId: string,
  seating: AdventureSimSeating,
  policies: AdventureSimPolicies,
  series: number,
): AdventureSimSeries {
  return bestOfThree((game) => playAdventureSimGame(deckId, seating, policies, adventureSimGameSeed(series, game)))
}

export interface AdventureSimRecord {
  wins: number
  losses: number
  draws: number
}

/** The summed results of one deck, matchup and seating. Plain JSON, so runs can be merged. */
export interface AdventureSimCell {
  readonly deckId: string
  /** Entrant names as `adventure vs standard`. */
  readonly matchup: string
  readonly seating: AdventureSimSeating
  readonly series: AdventureSimRecord
  readonly games: AdventureSimRecord
  unfinished: number
  /** Summed over games; the engine counts each player's turn once. */
  turns: number
  readonly winKinds: { readonly adventure: Record<AdventureSimWinKind, number>; readonly standard: Record<AdventureSimWinKind, number> }
  readonly tallies: { readonly adventure: AdventureSimTally; readonly standard: AdventureSimTally }
}

export function adventureSimMatchupName(adventure: TournamentEntrant, standard: TournamentEntrant): string {
  return `${adventure.name} vs ${standard.name}`
}

function emptyWinKinds(): Record<AdventureSimWinKind, number> {
  return { fiveDifferent: 0, fiveSame: 0, deckOut: 0 }
}

function emptyCell(deckId: string, matchup: string, seating: AdventureSimSeating): AdventureSimCell {
  return {
    deckId,
    matchup,
    seating,
    series: { wins: 0, losses: 0, draws: 0 },
    games: { wins: 0, losses: 0, draws: 0 },
    unfinished: 0,
    turns: 0,
    winKinds: { adventure: emptyWinKinds(), standard: emptyWinKinds() },
    tallies: { adventure: emptyAdventureSimTally(), standard: emptyAdventureSimTally() },
  }
}

function addOutcome(record: AdventureSimRecord, outcome: AdventureSimOutcome): void {
  switch (outcome) {
    case 'win':
      record.wins += 1
      break
    case 'loss':
      record.losses += 1
      break
    case 'draw':
      record.draws += 1
      break
    default:
      break
  }
}

function addTally(target: AdventureSimTally, source: AdventureSimTally): void {
  for (const key of ADVENTURE_SIM_TALLY_KEYS) {
    target[key] += source[key]
  }
}

function addSeries(cell: AdventureSimCell, series: AdventureSimSeries): void {
  addOutcome(cell.series, series.outcome)
  for (const game of series.games) {
    addOutcome(cell.games, game.outcome)
    cell.unfinished += game.unfinished ? 1 : 0
    cell.turns += game.turns
    if (game.winKind !== null && game.outcome !== 'draw') {
      cell.winKinds[game.outcome === 'win' ? 'adventure' : 'standard'][game.winKind] += 1
    }
    addTally(cell.tallies.adventure, game.adventure)
    addTally(cell.tallies.standard, game.standard)
  }
}

export interface AdventureSimCellOptions {
  readonly deckId: string
  readonly adventure: TournamentEntrant
  readonly standard: TournamentEntrant
  readonly seating: AdventureSimSeating
  /** Series numbers; each seeds its games through `adventureSimGameSeed`. */
  readonly series: readonly number[]
}

/** Plays the series of one cell, one per step, and returns the summed cell. */
export function* adventureSimCellSteps(options: AdventureSimCellOptions): Generator<void, AdventureSimCell> {
  const cell = emptyCell(options.deckId, adventureSimMatchupName(options.adventure, options.standard), options.seating)
  const policies: AdventureSimPolicies = { adventure: options.adventure.policy, standard: options.standard.policy }
  for (const series of options.series) {
    addSeries(cell, playAdventureSimSeries(options.deckId, options.seating, policies, series))
    yield
  }
  return cell
}

function cellKey(cell: AdventureSimCell): string {
  return `${cell.matchup}\u0000${cell.seating}\u0000${cell.deckId}`
}

function addRecord(target: AdventureSimRecord, source: AdventureSimRecord): void {
  target.wins += source.wins
  target.losses += source.losses
  target.draws += source.draws
}

/** Sums cells of the same deck, matchup and seating, such as shards of one run. */
export function mergeAdventureSimCells(cells: readonly AdventureSimCell[]): AdventureSimCell[] {
  const merged = new Map<string, AdventureSimCell>()
  for (const cell of cells) {
    const key = cellKey(cell)
    let target = merged.get(key)
    if (!target) {
      target = emptyCell(cell.deckId, cell.matchup, cell.seating)
      merged.set(key, target)
    }
    addRecord(target.series, cell.series)
    addRecord(target.games, cell.games)
    target.unfinished += cell.unfinished
    target.turns += cell.turns
    for (const side of ['adventure', 'standard'] as const) {
      for (const kind of ADVENTURE_SIM_WIN_KINDS) {
        target.winKinds[side][kind] += cell.winKinds[side][kind]
      }
      addTally(target.tallies[side], cell.tallies[side])
    }
  }
  return [...merged.values()]
}

const RESULTS_VERSION = 1
const MAX_RESULT_CELLS = 10_000

export function serializeAdventureSimCells(cells: readonly AdventureSimCell[]): string {
  return `${JSON.stringify({ version: RESULTS_VERSION, cells }, null, 2)}\n`
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasCounts(value: unknown, keys: readonly string[]): boolean {
  return isRecordObject(value) && keys.every((key) => isCount(value[key]))
}

function isSidePair(value: unknown, keys: readonly string[]): boolean {
  return isRecordObject(value) && hasCounts(value.adventure, keys) && hasCounts(value.standard, keys)
}

const RECORD_KEYS = ['wins', 'losses', 'draws']

export function isAdventureSimCell(value: unknown): value is AdventureSimCell {
  return isRecordObject(value)
    && isAdventureSimDeckId(value.deckId)
    && typeof value.matchup === 'string'
    && isAdventureSimSeating(value.seating)
    && hasCounts(value.series, RECORD_KEYS)
    && hasCounts(value.games, RECORD_KEYS)
    && isCount(value.unfinished)
    && isCount(value.turns)
    && isSidePair(value.winKinds, ADVENTURE_SIM_WIN_KINDS)
    && isSidePair(value.tallies, ADVENTURE_SIM_TALLY_KEYS)
}

/** Reads results that `serializeAdventureSimCells` wrote; throws on anything else. */
export function parseAdventureSimCells(text: string): AdventureSimCell[] {
  const parsed: unknown = JSON.parse(text)
  if (
    !isRecordObject(parsed)
    || parsed.version !== RESULTS_VERSION
    || !Array.isArray(parsed.cells)
    || parsed.cells.length > MAX_RESULT_CELLS
    || !parsed.cells.every(isAdventureSimCell)
  ) {
    throw new Error('Not an Adventure deck simulation result file.')
  }
  return parsed.cells
}

function recordTotal(record: AdventureSimRecord): number {
  return record.wins + record.losses + record.draws
}

/** Wins plus half the draws, per series or game, with a 95% Wilson interval. */
export function adventureSimScore(record: AdventureSimRecord): { score: number; low: number; high: number } {
  const total = recordTotal(record)
  const points = record.wins + record.draws / 2
  const interval = wilsonInterval(points, total)
  return { score: total === 0 ? 0 : points / total, low: interval.low, high: interval.high }
}

function formatScore(record: AdventureSimRecord): string {
  const { score, low, high } = adventureSimScore(record)
  return `${formatPercent(score)} [${formatPercent(low)}, ${formatPercent(high)}]`
}

function formatRecord(record: AdventureSimRecord): string {
  return `${record.wins}-${record.losses}-${record.draws}`
}

function formatWinKinds(kinds: Record<AdventureSimWinKind, number>): string {
  return ADVENTURE_SIM_WIN_KINDS.map((kind) => kinds[kind]).join(' / ')
}

function perGame(total: number, games: number): string {
  return games === 0 ? '0.00' : (total / games).toFixed(2)
}

function groupKey(cell: AdventureSimCell): string {
  return `${cell.matchup}, ${cell.seating} seating`
}

function byPoolOrder(left: AdventureSimCell, right: AdventureSimCell): number {
  return ADVENTURE_SIM_DECK_IDS.indexOf(left.deckId) - ADVENTURE_SIM_DECK_IDS.indexOf(right.deckId)
}

/**
 * A markdown report: series scores of every deck by matchup and seating,
 * then per group the decks ranked by series score with game results, win
 * kinds and ability use per game.
 */
export function formatAdventureSimReport(cells: readonly AdventureSimCell[]): string {
  const merged = mergeAdventureSimCells(cells)
  const groups = new Map<string, AdventureSimCell[]>()
  for (const cell of merged) {
    const key = groupKey(cell)
    groups.set(key, [...(groups.get(key) ?? []), cell])
  }
  const groupNames = [...groups.keys()]
  const lines: string[] = [
    'Scores are for the Adventure deck: wins plus half the draws, with 95% Wilson intervals.',
    '`adventure` seating puts the standard deck first, as Adventure seats the player; `swapped` puts the Adventure deck first.',
    '',
    '### Series score by deck',
    '',
    `| Deck | ${groupNames.join(' | ')} |`,
    `|---|${groupNames.map(() => '---').join('|')}|`,
  ]
  const deckIds = ADVENTURE_SIM_DECK_IDS.filter((deckId) => merged.some((cell) => cell.deckId === deckId))
  for (const deckId of deckIds) {
    const scores = groupNames.map((name) => {
      const cell = groups.get(name)?.find((entry) => entry.deckId === deckId)
      return cell ? formatScore(cell.series) : '–'
    })
    lines.push(`| ${deckId} | ${scores.join(' | ')} |`)
  }
  for (const [name, group] of groups) {
    const ranked = [...group].sort((left, right) =>
      adventureSimScore(right.series).score - adventureSimScore(left.series).score || byPoolOrder(left, right))
    lines.push(
      '',
      `### ${name}`,
      '',
      '| Deck | Series W-L-D | Series score | Games W-L-D | Game score | Games per series | Avg turns | Adventure wins: 5 different / 5 same / deck-out | Standard wins: 5 different / 5 same / deck-out | Unfinished |',
      '|---|---|---|---|---|---|---|---|---|---|',
    )
    for (const cell of ranked) {
      const games = recordTotal(cell.games)
      const series = recordTotal(cell.series)
      lines.push(`| ${cell.deckId} | ${formatRecord(cell.series)} | ${formatScore(cell.series)} | ${formatRecord(cell.games)} | ${formatScore(cell.games)} | ${perGame(games, series)} | ${perGame(cell.turns, games)} | ${formatWinKinds(cell.winKinds.adventure)} | ${formatWinKinds(cell.winKinds.standard)} | ${cell.unfinished} |`)
    }
    lines.push(
      '',
      `Ability use per game, Adventure deck / standard deck (${name}):`,
      '',
      '| Deck | Lands | Intercepts | Banishes | Drains | Reclaims | Mimics | Extra draws |',
      '|---|---|---|---|---|---|---|---|',
    )
    for (const cell of [...group].sort(byPoolOrder)) {
      const games = recordTotal(cell.games)
      const columns = ADVENTURE_SIM_TALLY_KEYS.map((key) =>
        `${perGame(cell.tallies.adventure[key], games)} / ${perGame(cell.tallies.standard[key], games)}`)
      lines.push(`| ${cell.deckId} | ${columns.join(' | ')} |`)
    }
  }
  return lines.join('\n')
}
