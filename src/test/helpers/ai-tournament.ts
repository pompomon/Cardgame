import { isLegalActionForState } from '../../app/action-validation'
import { actionClassKey } from '../../game/ai-action-classes'
import { activeActor, applyAction, createInitialGame, getLegalActions } from '../../game/engine'
import type { Card, GameAction, GameState } from '../../game/types'

// Measurement harness for AI levels: seeded games, mirrored matches, Wilson
// intervals and per-decision latency. Default-suite tests use it with small
// game counts; the opt-in tools in `src/test/tools/` run full tournaments.

/** Chooses an action for `actor`; `gameSeed` is the game's seed. */
export type TournamentPolicy = (state: GameState, actor: number, gameSeed: number) => GameAction | null

export interface TournamentEntrant {
  readonly name: string
  readonly policy: TournamentPolicy
}

export type DeckPair = [Card[] | undefined, Card[] | undefined]

/** A decision with two or more legal actions and the action that was chosen. */
export interface DecisionRecord {
  readonly state: GameState
  readonly action: GameAction
  readonly gameSeed: number
}

export interface PlayedGame {
  readonly winner: GameState['winner']
  readonly turns: number
  readonly deckOut: boolean
  /** Milliseconds per decision with two or more legal actions, by seat. */
  readonly latencies: [number[], number[]]
  /** Decisions with two or more legal actions, by seat, when recorded. */
  readonly decisions: [DecisionRecord[], DecisionRecord[]]
}

export interface PlayOptions {
  readonly decks?: DeckPair
  /** Keeps every decision with two or more legal actions. */
  readonly recordDecisions?: boolean
  readonly clock?: () => number
}

const MAX_STEPS = 5000

function defaultClock(): number {
  return performance.now()
}

/**
 * Plays one game. Logs are dropped after every step, which no policy reads,
 * so long games do not slow `applyAction` down. Throws on an illegal action.
 */
export function playGame(seed: number, policies: readonly [TournamentPolicy, TournamentPolicy], options: PlayOptions = {}): PlayedGame {
  const clock = options.clock ?? defaultClock
  let state: GameState = createInitialGame(seed, options.decks)
  state = { ...state, log: [], events: [] }
  const latencies: [number[], number[]] = [[], []]
  const decisions: [DecisionRecord[], DecisionRecord[]] = [[], []]
  let deckOut = false
  for (let step = 0; step < MAX_STEPS && state.phase !== 'gameOver'; step += 1) {
    const actor = activeActor(state)
    const legal = getLegalActions(state, actor)
    let action: GameAction | null
    if (legal.length === 1) {
      action = legal[0]
    } else {
      const start = clock()
      action = policies[actor](state, actor, seed)
      latencies[actor].push(clock() - start)
      if (action && options.recordDecisions) {
        decisions[actor].push({ state, action, gameSeed: seed })
      }
    }
    if (!action || !isLegalActionForState(state, action)) {
      throw new Error(`Seat ${actor} chose an illegal action in game ${seed} at step ${step}: ${JSON.stringify(action)}`)
    }
    const next = applyAction(state, action)
    deckOut = next.events.some((event) => event.kind === 'deck_empty_loss')
    state = { ...next, log: [], events: [] }
  }
  return { winner: state.winner, turns: state.turn, deckOut, latencies, decisions }
}

/** A 95% Wilson score interval for `successes` out of `trials`. */
export function wilsonInterval(successes: number, trials: number, z = 1.96): { low: number; high: number } {
  if (trials <= 0) {
    return { low: 0, high: 1 }
  }
  const rate = successes / trials
  const denominator = 1 + (z * z) / trials
  const center = (rate + (z * z) / (2 * trials)) / denominator
  const margin = (z * Math.sqrt((rate * (1 - rate)) / trials + (z * z) / (4 * trials * trials))) / denominator
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) }
}

export interface LatencySummary {
  readonly count: number
  readonly mean: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
}

export function summarizeLatency(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]
  return {
    count: sorted.length,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  }
}

export interface MatchResult {
  readonly games: number
  readonly wins: number
  readonly losses: number
  readonly draws: number
  /** Wins plus half the draws, per game. */
  readonly score: number
  readonly low: number
  readonly high: number
  readonly averageTurns: number
  readonly deckOuts: number
  /** Decision latency of the first entrant. */
  readonly latency: LatencySummary
  /** Decisions of the first entrant, when recorded. */
  readonly decisions: DecisionRecord[]
}

export interface MatchOptions {
  readonly seeds: readonly number[]
  /** Decks by seat for a seed. Defaults to both starter decks. */
  readonly decksFor?: (seed: number) => DeckPair
  /**
   * `mirrored` plays each seed twice with the entrants' seats swapped and
   * each seat keeping its deck. `first-as-seat-1` always seats the first
   * entrant second, like the AI in Adventure.
   */
  readonly seating?: 'mirrored' | 'first-as-seat-1'
  readonly recordDecisions?: boolean
  readonly clock?: () => number
}

/** Plays `first` against `second` and scores the games for `first`. */
export function playMatch(first: TournamentEntrant, second: TournamentEntrant, options: MatchOptions): MatchResult {
  const seating = options.seating ?? 'mirrored'
  const seatings: Array<0 | 1> = seating === 'mirrored' ? [0, 1] : [1]
  let wins = 0
  let losses = 0
  let draws = 0
  let turns = 0
  let deckOuts = 0
  let games = 0
  const latencies: number[] = []
  const decisions: DecisionRecord[] = []
  for (const seed of options.seeds) {
    for (const seat of seatings) {
      const policies: [TournamentPolicy, TournamentPolicy] = seat === 0
        ? [first.policy, second.policy]
        : [second.policy, first.policy]
      const game = playGame(seed, policies, {
        decks: options.decksFor?.(seed),
        recordDecisions: options.recordDecisions,
        clock: options.clock,
      })
      games += 1
      turns += game.turns
      deckOuts += game.deckOut ? 1 : 0
      latencies.push(...game.latencies[seat])
      decisions.push(...game.decisions[seat])
      if (game.winner === seat) {
        wins += 1
      } else if (game.winner === 'draw' || game.winner === null) {
        draws += 1
      } else {
        losses += 1
      }
    }
  }
  const points = wins + draws / 2
  const interval = wilsonInterval(points, games)
  return {
    games,
    wins,
    losses,
    draws,
    score: games === 0 ? 0 : points / games,
    low: interval.low,
    high: interval.high,
    averageTurns: games === 0 ? 0 : turns / games,
    deckOuts,
    latency: summarizeLatency(latencies),
    decisions,
  }
}

/** Seeds `start`, `start + 1`, … of the given count. */
export function seedRange(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index)
}

/** The action class a policy picks, or `null` when it returns no action. */
export function chosenClass(policy: TournamentPolicy, state: GameState, gameSeed: number): string | null {
  const actor = activeActor(state)
  const action = policy(state, actor, gameSeed)
  return action ? actionClassKey(state, action) : null
}

/**
 * Whether the land pending in `respond` wins for its caster once it resolves.
 * Plains and Swamp targets do not change the caster's board, so any target
 * stands in for all of them.
 */
export function pendingLandWins(state: GameState): boolean {
  const pending = state.pendingLandPlay
  if (state.phase !== 'respond' || !pending) {
    return false
  }
  let next = applyAction(state, { type: 'pass_response', actor: activeActor(state) })
  while (next.phase === 'plains_target' || next.phase === 'swamp_target') {
    next = applyAction(next, getLegalActions(next, activeActor(next))[0])
  }
  return next.winner === pending.actor
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatMatchRow(label: string, result: MatchResult): string {
  return `| ${label} | ${result.games} | ${result.wins}-${result.losses}-${result.draws} | ${formatPercent(result.score)} [${formatPercent(result.low)}, ${formatPercent(result.high)}] | ${result.averageTurns.toFixed(1)} | ${result.deckOuts} | ${result.latency.mean.toFixed(2)} / ${result.latency.p95.toFixed(2)} / ${result.latency.max.toFixed(2)} |`
}

export const MATCH_TABLE_HEADER = [
  '| Match | Games | W-L-D | Score [95% Wilson] | Avg turns | Deck-outs | Latency ms mean / p95 / max |',
  '|---|---|---|---|---|---|---|',
].join('\n')
