import { canonicalActionClasses } from './ai-action-classes'
import { determinize, projectKnowledge } from './ai-knowledge'
import type { AiSearchBudget, AiVisibilityProfile } from './ai-policy-types'
import { createAiRng } from './ai-random'
import { playRollout, searchStep, type RolloutSettings, type StepMeter } from './ai-rollout'
import { activeActor, getLegalActions } from './engine'
import type { GameAction, GameState } from './types'

// Determinized Monte-Carlo search for the Hard AI.
//
// Hard sees both hands, so the only thing it cannot know is the order of each
// deck, which no player knows. The search samples deck orders ("worlds"),
// applies every candidate action class in each world and plays the rollout
// policy forward with one random stream per world (common random numbers), so
// differences between classes come from the actions rather than from luck.
// Rollout choices never look at the sampled order: action values mask the
// card an Island draws, and End Turn is scored before its draw.
//
// Every engine step counts against `maxEngineSteps`. There is no clock, so a
// decision is the same on every device and after a pause and resume. The first
// world always completes; later worlds start only if they are expected to fit,
// and their rollouts share what is left. A search therefore takes at most
// max(maxEngineSteps, 16 × classes) steps plus about one rollout decision per
// class, and the counter window and target choice that decision may leave.
//
// Twelve worlds rather than eight cost about 1.4 times the time and win 55% of
// mirrored games against eight; see docs/agent/adr/0003-hard-ai-search.md.

export const HARD_AI_DEFAULT_BUDGET: AiSearchBudget = Object.freeze({
  determinizations: 12,
  rolloutTurns: 4,
  rolloutEpsilon: 0.15,
  maxEngineSteps: 6000,
})

const BUDGET_LIMITS: Readonly<Record<keyof AiSearchBudget, readonly [number, number]>> = Object.freeze({
  determinizations: [1, 256],
  rolloutTurns: [0, 32],
  rolloutEpsilon: [0, 1],
  maxEngineSteps: [1, 1_000_000],
})

// Classes beyond this many are cut down by sequential halving.
const UNIFORM_CLASS_LIMIT = 4
const FINALISTS = 3
// A rollout may take at least this many steps, however small the budget.
const MIN_ROLLOUT_STEPS = 16

// The search needs every hand to be the same in every world: class
// representatives name hand cards by id, and an id missing from a sampled
// hand would make the engine ignore the action.
const FULL_VISIBILITY: AiVisibilityProfile = Object.freeze({ kind: 'full', canInspectOpponentHand: true })

function budgetField(budget: Partial<AiSearchBudget> | undefined, field: keyof AiSearchBudget, integer: boolean): number {
  const fallback = HARD_AI_DEFAULT_BUDGET[field]
  const value = budget?.[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const [min, max] = BUDGET_LIMITS[field]
  const clamped = Math.min(max, Math.max(min, value))
  return integer ? Math.floor(clamped) : clamped
}

/** A complete budget: missing or non-finite fields take the defaults, others are clamped. */
export function resolveSearchBudget(budget?: Partial<AiSearchBudget>): AiSearchBudget {
  return {
    determinizations: budgetField(budget, 'determinizations', true),
    rolloutTurns: budgetField(budget, 'rolloutTurns', true),
    rolloutEpsilon: budgetField(budget, 'rolloutEpsilon', false),
    maxEngineSteps: budgetField(budget, 'maxEngineSteps', true),
  }
}

export interface AiSearchOptions {
  /** Seeds the sampled worlds and rollouts. */
  readonly searchSeed: number
  readonly budget: AiSearchBudget
  readonly rootWeights: Float64Array
  readonly opponentWeights: Float64Array
  /** Whether the modelled opponent sees the searching player's hand. */
  readonly opponentSeesHand: boolean
}

export interface AiClassStatistics {
  readonly key: string
  readonly action: GameAction
  /** Worlds the class was played in. */
  readonly samples: number
  /** Mean value for the searching player, in win probability. */
  readonly mean: number
  /** Standard error of `mean`; 0 with fewer than two samples. */
  readonly standardError: number
  /** Whether the class survived every elimination round. */
  readonly finalist: boolean
  /** Whether the class wins before the opponent can answer, after any target choice of its own. */
  readonly winsNow: boolean
}

/** `single`: one class; `win`: a class wins before the opponent can answer; `searched`: worlds were sampled. */
export type AiSearchOutcome = 'single' | 'win' | 'searched'

export interface AiSearchResult {
  readonly outcome: AiSearchOutcome
  /** In class key order. */
  readonly classes: readonly AiClassStatistics[]
  readonly worlds: number
  readonly steps: number
  /** The value of class `c` in world `w` at `w * classes.length + c`; NaN where it was not played. */
  readonly values: Float64Array
}

export interface AiPairedDifference {
  readonly mean: number
  readonly standardError: number
  readonly samples: number
}

/** The mean and standard error of `value(a) − value(b)` over the worlds both were played in. */
export function pairedDifference(result: AiSearchResult, a: number, b: number): AiPairedDifference {
  const width = result.classes.length
  let count = 0
  let mean = 0
  let squares = 0
  for (let world = 0; world < result.worlds; world += 1) {
    const left = result.values[world * width + a]
    const right = result.values[world * width + b]
    if (Number.isNaN(left) || Number.isNaN(right)) continue
    count += 1
    const difference = left - right
    const delta = difference - mean
    mean += delta / count
    squares += delta * (difference - mean)
  }
  const standardError = count > 1 ? Math.sqrt(squares / (count - 1) / count) : 0
  return { mean: count === 0 ? 0 : mean, standardError, samples: count }
}

function statistics(
  key: string,
  action: GameAction,
  values: Float64Array,
  worlds: number,
  width: number,
  index: number,
  finalist: boolean,
  winsNow: boolean,
): AiClassStatistics {
  let count = 0
  let mean = 0
  let squares = 0
  for (let world = 0; world < worlds; world += 1) {
    const value = values[world * width + index]
    if (Number.isNaN(value)) continue
    count += 1
    const delta = value - mean
    mean += delta / count
    squares += delta * (value - mean)
  }
  const standardError = count > 1 ? Math.sqrt(squares / (count - 1) / count) : 0
  return { key, action, samples: count, mean, standardError, finalist, winsNow }
}

function oneOutcome(outcome: AiSearchOutcome, keys: readonly string[], actions: readonly GameAction[], wins: readonly boolean[], steps: number): AiSearchResult {
  return {
    outcome,
    classes: keys.map((key, index) => ({
      key,
      action: actions[index],
      samples: 0,
      mean: wins[index] ? 1 : 0,
      standardError: 0,
      finalist: outcome === 'single' || wins[index],
      winsNow: wins[index],
    })),
    worlds: 0,
    steps,
    values: new Float64Array(0),
  }
}

/** How many worlds each halving round gets before the finalists take the rest. */
function halvingRounds(classes: number, worlds: number): number {
  if (classes <= UNIFORM_CLASS_LIMIT) {
    return 0
  }
  return Math.min(Math.max(0, worlds - 1), Math.ceil(Math.log2(classes / FINALISTS)))
}

/**
 * Whether `action` wins for `actor` before the opponent can answer. A land
 * that leaves `actor` a target choice wins only once a target resolves,
 * because the engine checks the board then. A counter window is an answer.
 */
function winsAtOnce(meter: StepMeter, state: GameState, action: GameAction, actor: number): boolean {
  const next = searchStep(meter, state, action)
  if ((next.phase === 'plains_target' || next.phase === 'swamp_target') && activeActor(next) === actor) {
    return getLegalActions(next, actor).some((target) => searchStep(meter, next, target).winner === actor)
  }
  return next.winner === actor
}

/**
 * Estimates the value of every action class of `actor` in `state` from the
 * searching player's perspective. `actions` are the legal actions.
 */
export function searchActionValues(
  state: GameState,
  actor: number,
  actions: readonly GameAction[],
  options: AiSearchOptions,
): AiSearchResult {
  const classes = canonicalActionClasses(state, actions)
  const keys = classes.map((entry) => entry.key)
  const representatives = classes.map((entry) => entry.representative)
  const width = classes.length
  if (width <= 1) {
    return oneOutcome('single', keys, representatives, keys.map(() => false), 0)
  }

  const knowledge = projectKnowledge(state, actor === 1 ? 1 : 0, FULL_VISIBILITY)
  // Worlds sort every zone, and a counter spends the first Island in hand
  // without naming it, so each class is played as its representative in the
  // sorted root. The result reports the representative in `state`.
  const sortedClasses = new Map(
    canonicalActionClasses(knowledge.root, getLegalActions(knowledge.root, actor)).map((entry) => [entry.key, entry.representative]),
  )
  const worldActions = classes.map((entry) => sortedClasses.get(entry.key) ?? entry.representative)
  const meter: StepMeter = { steps: 0 }
  const wins = worldActions.map((action) => winsAtOnce(meter, knowledge.root, action, actor))
  if (wins.some(Boolean)) {
    return oneOutcome('win', keys, representatives, wins, meter.steps)
  }

  const { budget } = options
  const firstRolloutLimit = Math.max(MIN_ROLLOUT_STEPS, Math.floor(budget.maxEngineSteps / width))
  const values = new Float64Array(budget.determinizations * width).fill(Number.NaN)
  const totals = new Float64Array(width)
  let alive = representatives.map((_, index) => index)
  const rounds = halvingRounds(width, budget.determinizations)
  const worldsPerRound = rounds === 0 ? budget.determinizations : Math.max(1, Math.floor(budget.determinizations / (rounds + 1)))
  let roundWorlds = 0
  let rolloutSteps = 0
  let rollouts = 0
  const rng = createAiRng(options.searchSeed)
  let worlds = 0
  for (; worlds < budget.determinizations; worlds += 1) {
    let rolloutLimit = firstRolloutLimit
    if (worlds > 0) {
      const remaining = budget.maxEngineSteps - meter.steps
      if ((rolloutSteps / rollouts) * alive.length > remaining) break
      // Every class in the world gets the same limit, so a costly world ends
      // within the budget, give or take one rollout decision per class and
      // the counter window and target choice it may leave.
      rolloutLimit = Math.max(1, Math.min(firstRolloutLimit, Math.floor(remaining / alive.length) - 1))
    }
    const settings: RolloutSettings = {
      root: actor,
      rootWeights: options.rootWeights,
      opponentWeights: options.opponentWeights,
      opponentSeesHand: options.opponentSeesHand,
      epsilon: budget.rolloutEpsilon,
      turns: budget.rolloutTurns,
      maxRolloutSteps: rolloutLimit,
    }
    const world = determinize(knowledge, rng)
    const rolloutSeed = rng.nextUint32()
    for (const index of alive) {
      const before = meter.steps
      const next = searchStep(meter, world, worldActions[index])
      const value = playRollout(meter, settings, next, state.turn, createAiRng(rolloutSeed))
      values[worlds * width + index] = value
      totals[index] += value
      rolloutSteps += meter.steps - before
      rollouts += 1
    }
    roundWorlds += 1
    if (alive.length > FINALISTS && rounds > 0 && roundWorlds >= worldsPerRound) {
      // Survivors were all played in the same worlds, so totals compare fairly.
      const keep = Math.max(FINALISTS, Math.ceil(alive.length / 2))
      alive = [...alive].sort((left, right) => totals[right] - totals[left] || left - right).slice(0, keep).sort((left, right) => left - right)
      roundWorlds = 0
    }
  }

  const finalists = new Set(alive)
  return {
    outcome: 'searched',
    classes: keys.map((key, index) =>
      statistics(key, representatives[index], values, worlds, width, index, finalists.has(index), false),
    ),
    worlds,
    steps: meter.steps,
    values: values.subarray(0, worlds * width),
  }
}

/** The finalist with the highest mean, ties going to the first in key order; −1 if there are none. */
export function bestClassIndex(result: AiSearchResult): number {
  let best = -1
  for (let index = 0; index < result.classes.length; index += 1) {
    const entry = result.classes[index]
    if (!entry.finalist) continue
    if (best < 0 || entry.mean > result.classes[best].mean) {
      best = index
    }
  }
  return best
}
