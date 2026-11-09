import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { AI_FEATURE_COUNT, AI_FEATURE_NAMES, featureDifferences, sigmoid } from '../../game/ai-features'
import { createAiRng } from '../../game/ai-random'
import { activeActor, applyAction, createInitialGame, getLegalActions } from '../../game/engine'
import type { GameState } from '../../game/types'
import { resolveEntrant } from '../helpers/ai-entrants'
import type { TournamentPolicy } from '../helpers/ai-tournament'
import { TEST_DECK_KINDS, deckOfKind } from '../helpers/seeded-games'

// Opt-in evaluator tuning: `npm run ai:tune`. It is not part of
// `npm run test`. It plays seeded self-play games, records each turn's start
// (scored for the player to act) and end (scored for the next player, before
// the draw), and fits the logistic weights of `src/game/ai-features.ts` to the
// final results with L2-regularized Newton steps. A fifth of the games,
// spread across deck kinds, is held out. Settings come from environment
// variables:
//
//   AI_TUNE_GAMES       games to play (default 4000)
//   AI_TUNE_SEED_START  first seed (default 100000, away from tournament seeds)
//   AI_TUNE_POLICIES    comma-separated entrant specs; each seat of each game
//                       draws one (see src/test/helpers/ai-entrants.ts)
//   AI_TUNE_L2          L2 penalty on the summed log-loss (default 5)
//   AI_TUNE_OUT         file for the report and the weights

const DEFAULT_POLICIES = 'advanced,advanced@0.2,legacy-hard@0.1,one-ply,one-ply@0.2'
const MAX_STEPS = 5000

interface Dataset {
  features: Float64Array
  labels: Float64Array
  games: Int32Array
  count: number
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}".`)
  }
  return value
}

function createDataset(capacity: number): Dataset {
  return {
    features: new Float64Array(capacity * AI_FEATURE_COUNT),
    labels: new Float64Array(capacity),
    games: new Int32Array(capacity),
    count: 0,
  }
}

function grow(dataset: Dataset): Dataset {
  const bigger = createDataset(dataset.labels.length * 2)
  bigger.features.set(dataset.features)
  bigger.labels.set(dataset.labels)
  bigger.games.set(dataset.games)
  bigger.count = dataset.count
  return bigger
}

/** Plays one game and returns its positions as (state, player to move) pairs with the winner. */
function playRecordedGame(seed: number, kindIndex: number, policies: [TournamentPolicy, TournamentPolicy]) {
  const kind = TEST_DECK_KINDS[kindIndex % TEST_DECK_KINDS.length]
  let state: GameState = createInitialGame(seed, [undefined, deckOfKind(kind, seed)])
  state = { ...state, log: [], events: [] }
  const positions: Array<{ state: GameState; toMove: number }> = []
  for (let step = 0; step < MAX_STEPS && state.phase !== 'gameOver'; step += 1) {
    const actor = activeActor(state)
    const legal = getLegalActions(state, actor)
    if (state.phase === 'main' && state.players[state.currentPlayer].landsPlayedThisTurn === 0) {
      positions.push({ state, toMove: state.currentPlayer })
    }
    const action = legal.length === 1 ? legal[0] : policies[actor](state, actor, seed)
    if (!action) {
      throw new Error(`No action in tuning game ${seed}.`)
    }
    if (action.type === 'end_turn') {
      positions.push({ state, toMove: state.currentPlayer === 0 ? 1 : 0 })
    }
    const next = applyAction(state, action)
    state = { ...next, log: [], events: [] }
  }
  return { positions, winner: state.winner }
}

function solve(matrix: Float64Array, vector: Float64Array, size: number): Float64Array {
  // Cholesky decomposition of a symmetric positive-definite matrix.
  const lower = new Float64Array(size * size)
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = matrix[row * size + column]
      for (let k = 0; k < column; k += 1) {
        sum -= lower[row * size + k] * lower[column * size + k]
      }
      lower[row * size + column] = row === column ? Math.sqrt(Math.max(sum, 1e-12)) : sum / lower[column * size + column]
    }
  }
  const forward = new Float64Array(size)
  for (let row = 0; row < size; row += 1) {
    let sum = vector[row]
    for (let k = 0; k < row; k += 1) sum -= lower[row * size + k] * forward[k]
    forward[row] = sum / lower[row * size + row]
  }
  const result = new Float64Array(size)
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = forward[row]
    for (let k = row + 1; k < size; k += 1) sum -= lower[k * size + row] * result[k]
    result[row] = sum / lower[row * size + row]
  }
  return result
}

function predict(dataset: Dataset, row: number, weights: Float64Array): number {
  let logit = 0
  const offset = row * AI_FEATURE_COUNT
  for (let index = 0; index < AI_FEATURE_COUNT; index += 1) {
    logit += weights[index] * dataset.features[offset + index]
  }
  return sigmoid(logit)
}

function fit(dataset: Dataset, isTraining: (row: number) => boolean, l2: number): Float64Array {
  const size = AI_FEATURE_COUNT
  const weights = new Float64Array(size)
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const gradient = new Float64Array(size)
    const hessian = new Float64Array(size * size)
    for (let row = 0; row < dataset.count; row += 1) {
      if (!isTraining(row)) continue
      const p = predict(dataset, row, weights)
      const error = p - dataset.labels[row]
      const curvature = Math.max(p * (1 - p), 1e-6)
      const offset = row * size
      for (let i = 0; i < size; i += 1) {
        const xi = dataset.features[offset + i]
        if (xi === 0) continue
        gradient[i] += error * xi
        for (let j = 0; j <= i; j += 1) {
          hessian[i * size + j] += curvature * xi * dataset.features[offset + j]
        }
      }
    }
    for (let i = 0; i < size; i += 1) {
      gradient[i] += l2 * weights[i]
      hessian[i * size + i] += l2
      for (let j = 0; j < i; j += 1) hessian[j * size + i] = hessian[i * size + j]
    }
    const step = solve(hessian, gradient, size)
    let largest = 0
    for (let i = 0; i < size; i += 1) {
      weights[i] -= step[i]
      largest = Math.max(largest, Math.abs(step[i]))
    }
    if (largest < 1e-7) break
  }
  return weights
}

function logLoss(dataset: Dataset, include: (row: number) => boolean, weights: Float64Array): { loss: number; rows: number } {
  let total = 0
  let rows = 0
  for (let row = 0; row < dataset.count; row += 1) {
    if (!include(row)) continue
    const p = Math.min(1 - 1e-9, Math.max(1e-9, predict(dataset, row, weights)))
    const y = dataset.labels[row]
    total -= y * Math.log(p) + (1 - y) * Math.log(1 - p)
    rows += 1
  }
  return { loss: rows === 0 ? 0 : total / rows, rows }
}

function calibration(dataset: Dataset, include: (row: number) => boolean, weights: Float64Array) {
  const buckets = Array.from({ length: 10 }, () => ({ count: 0, predicted: 0, observed: 0 }))
  let rows = 0
  for (let row = 0; row < dataset.count; row += 1) {
    if (!include(row)) continue
    const p = predict(dataset, row, weights)
    const bucket = buckets[Math.min(9, Math.floor(p * 10))]
    bucket.count += 1
    bucket.predicted += p
    bucket.observed += dataset.labels[row]
    rows += 1
  }
  let error = 0
  const lines = buckets.map((bucket, index) => {
    const predicted = bucket.count === 0 ? 0 : bucket.predicted / bucket.count
    const observed = bucket.count === 0 ? 0 : bucket.observed / bucket.count
    error += rows === 0 ? 0 : (bucket.count / rows) * Math.abs(predicted - observed)
    return `| ${(index / 10).toFixed(1)}–${((index + 1) / 10).toFixed(1)} | ${bucket.count} | ${predicted.toFixed(3)} | ${observed.toFixed(3)} |`
  })
  return { error, lines }
}

describe('AI evaluator tuning', () => {
  it('fits the evaluator weights to self-play results', () => {
    const games = envNumber('AI_TUNE_GAMES', 4000)
    const seedStart = envNumber('AI_TUNE_SEED_START', 100_000)
    const l2 = envNumber('AI_TUNE_L2', 5)
    const specs = (process.env.AI_TUNE_POLICIES || DEFAULT_POLICIES).split(',').map((spec) => spec.trim()).filter(Boolean)
    const policies = specs.map((spec) => resolveEntrant(spec).policy)

    let dataset = createDataset(1 << 16)
    const scratch = new Float64Array(AI_FEATURE_COUNT)
    const outcomes = { finished: 0, unfinished: 0 }
    for (let game = 0; game < games; game += 1) {
      const seed = seedStart + game
      const pick = createAiRng(seed)
      const seats: [TournamentPolicy, TournamentPolicy] = [
        policies[pick.nextInt(policies.length)],
        policies[pick.nextInt(policies.length)],
      ]
      const { positions, winner } = playRecordedGame(seed, game, seats)
      if (winner === null) {
        outcomes.unfinished += 1
        continue
      }
      outcomes.finished += 1
      const label = winner === 0 ? 1 : winner === 1 ? 0 : 0.5
      for (const position of positions) {
        if (dataset.count === dataset.labels.length) {
          dataset = grow(dataset)
        }
        featureDifferences(position.state, 0, position.toMove, scratch)
        dataset.features.set(scratch, dataset.count * AI_FEATURE_COUNT)
        dataset.labels[dataset.count] = label
        dataset.games[dataset.count] = game
        dataset.count += 1
      }
    }

    const final = dataset
    // Deck kinds cycle with the game index, so hold out every fifth cycle
    // rather than every fifth game to keep every kind on both sides.
    const isHoldout = (row: number) => Math.floor(final.games[row] / TEST_DECK_KINDS.length) % 5 === 4
    const weights = fit(final, (row) => !isHoldout(row), l2)
    const train = logLoss(final, (row) => !isHoldout(row), weights)
    const holdout = logLoss(final, isHoldout, weights)
    const calibrationReport = calibration(final, isHoldout, weights)

    const weightLines = AI_FEATURE_NAMES.map((name, index) => `  ${name}: ${Number(weights[index].toFixed(4))},`)
    const report = [
      `Games ${outcomes.finished} finished, ${outcomes.unfinished} unfinished; seeds ${seedStart}–${seedStart + games - 1}.`,
      `Policies: ${specs.join(', ')}. L2 ${l2}.`,
      `Positions: ${train.rows} training, ${holdout.rows} held out (a fifth of the games).`,
      `Log-loss: training ${train.loss.toFixed(4)}, held out ${holdout.loss.toFixed(4)} (coin flip ${Math.log(2).toFixed(4)}).`,
      `Held-out expected calibration error: ${calibrationReport.error.toFixed(4)}.`,
      '',
      '| Predicted | Positions | Mean predicted | Observed |',
      '|---|---|---|---|',
      ...calibrationReport.lines,
      '',
      '```ts',
      ...weightLines,
      '```',
    ].join('\n')
    console.log(report)
    const out = process.env.AI_TUNE_OUT
    if (out) {
      writeFileSync(out, `${report}\n`)
    }
  })
})
