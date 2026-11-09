import { readFileSync } from 'node:fs'
import { AI_FEATURE_NAMES, FULL_VIEW, weightVector, type AiFeatureName, type AiWeights } from '../../game/ai-features'
import { AI_RANDOM_STREAM, createAiRng, decisionFingerprint, deriveAiSeed } from '../../game/ai-random'
import { chooseByValue } from '../../game/ai-rollout'
import { bestClassIndex, resolveSearchBudget, searchActionValues, type AiSearchResult } from '../../game/ai-search'
import { HARD_AI_WEIGHTS } from '../../game/ai-weights'
import { getLegalActions } from '../../game/engine'
import type { GameState } from '../../game/types'
import { ADVANCED, BASIC, HARD, LEGACY_HARD } from './ai-baselines'
import type { TournamentEntrant, TournamentPolicy } from './ai-tournament'

// Entrants for the opt-in AI tools, named by a spec:
//
//   name[+key=value...][@epsilon]
//
// `@epsilon` replaces that share of decisions with a uniformly random legal
// action. Keys are entrant-specific numeric settings, such as search budgets.
// Entrants named `*-candidate` use the weights of the `npm run ai:tune` report
// at the path in AI_CANDIDATE_WEIGHTS instead of the frozen ones.

const PHASE_CODES: Readonly<Record<GameState['phase'], number>> = {
  main: 0,
  respond: 1,
  plains_target: 2,
  swamp_target: 3,
  gameOver: 4,
}

/** A seed that differs between the decisions of a game but repeats on replay. */
function decisionNoiseSeed(state: GameState, actor: number, gameSeed: number): number {
  return deriveAiSeed(
    gameSeed,
    state.turn,
    actor,
    state.nextInstanceId,
    state.players[0].hand.length,
    state.players[1].hand.length,
    PHASE_CODES[state.phase] ?? 5,
    0x6e6f6973,
  )
}

export const RANDOM_POLICY: TournamentPolicy = (state, actor, seed) => {
  const legal = getLegalActions(state, actor)
  return legal.length === 0 ? null : legal[createAiRng(decisionNoiseSeed(state, actor, seed)).nextInt(legal.length)]
}

export function withNoise(policy: TournamentPolicy, epsilon: number): TournamentPolicy {
  return (state, actor, seed) => {
    const rng = createAiRng(decisionNoiseSeed(state, actor, seed))
    if (rng.next() < epsilon) {
      const legal = getLegalActions(state, actor)
      return legal.length === 0 ? null : legal[rng.nextInt(legal.length)]
    }
    return policy(state, actor, seed)
  }
}

/** One-step argmax of the evaluator, the search's rollout policy without noise. */
export function onePlyPolicy(weights: AiWeights = HARD_AI_WEIGHTS): TournamentPolicy {
  const vector = weightVector(weights)
  return (state, actor) => chooseByValue({ steps: 0 }, state, actor, vector, FULL_VIEW, 0, null)
}

function isFeatureName(name: string): name is AiFeatureName {
  return (AI_FEATURE_NAMES as readonly string[]).includes(name)
}

/** Reads the weights block of an `npm run ai:tune` report. */
export function parseWeightsReport(text: string): AiWeights {
  const block = /```ts\n([\s\S]*?)```/.exec(text)
  if (!block) {
    throw new Error('The report has no weights block.')
  }
  const weights = new Map<AiFeatureName, number>()
  for (const line of block[1].split('\n')) {
    const match = /^\s*(\w+):\s*(\S+?),?\s*$/.exec(line)
    if (!match) continue
    const [, name, valueText] = match
    const value = Number(valueText)
    if (!isFeatureName(name) || !Number.isFinite(value)) {
      throw new Error(`Bad weight line "${line.trim()}".`)
    }
    weights.set(name, value)
  }
  const missing = AI_FEATURE_NAMES.filter((name) => !weights.has(name))
  if (missing.length > 0) {
    throw new Error(`The report has no weights for ${missing.join(', ')}.`)
  }
  return Object.freeze(Object.fromEntries(weights) as Record<AiFeatureName, number>)
}

function candidateWeights(): AiWeights {
  const path = process.env.AI_CANDIDATE_WEIGHTS
  if (!path) {
    throw new Error('Set AI_CANDIDATE_WEIGHTS to the path of an `npm run ai:tune` report.')
  }
  return parseWeightsReport(readFileSync(path, 'utf8'))
}

/** Search statistics of the latest decision of every search entrant, for tools. */
export const searchTelemetry = { decisions: 0, steps: [] as number[], worlds: [] as number[] }

/**
 * Determinized search choosing the best mean. Settings: `d` worlds, `t`
 * rollout turns, `e` rollout noise, `s` step cap, and `see=1` for an
 * opponent model that sees the searching player's hand.
 */
export function searchArgmaxPolicy(params: ReadonlyMap<string, number>, weights: AiWeights = HARD_AI_WEIGHTS): TournamentPolicy {
  const budget = resolveSearchBudget({
    determinizations: params.get('d'),
    rolloutTurns: params.get('t'),
    rolloutEpsilon: params.get('e'),
    maxEngineSteps: params.get('s'),
  })
  const vector = weightVector(weights)
  const opponentSeesHand = params.get('see') === 1
  return (state, actor, seed) => {
    const actions = getLegalActions(state, actor)
    if (actions.length === 0) return null
    const result: AiSearchResult = searchActionValues(state, actor, actions, {
      searchSeed: deriveAiSeed(seed, decisionFingerprint(state, actor), actor, AI_RANDOM_STREAM.search),
      budget,
      rootWeights: vector,
      opponentWeights: vector,
      opponentSeesHand,
    })
    if (result.outcome === 'searched') {
      searchTelemetry.decisions += 1
      searchTelemetry.steps.push(result.steps)
      searchTelemetry.worlds.push(result.worlds)
    }
    return result.classes[bestClassIndex(result)]?.action ?? null
  }
}

export type EntrantFactory = (params: ReadonlyMap<string, number>) => TournamentPolicy

const FACTORIES = new Map<string, EntrantFactory>([
  ['hard', () => HARD.policy],
  ['legacy-hard', () => LEGACY_HARD.policy],
  ['advanced', () => ADVANCED.policy],
  ['basic', () => BASIC.policy],
  ['random', () => RANDOM_POLICY],
  ['one-ply', () => onePlyPolicy()],
  ['one-ply-candidate', () => onePlyPolicy(candidateWeights())],
  ['search', (params) => searchArgmaxPolicy(params)],
  ['search-candidate', (params) => searchArgmaxPolicy(params, candidateWeights())],
])

/** Adds or replaces an entrant factory, for tools that test candidate policies. */
export function registerEntrant(name: string, factory: EntrantFactory): void {
  FACTORIES.set(name, factory)
}

export function resolveEntrant(spec: string): TournamentEntrant {
  const [body, epsilonText] = spec.split('@')
  const [name, ...settings] = body.split('+')
  const factory = FACTORIES.get(name)
  if (!factory) {
    throw new Error(`Unknown entrant "${name}". Known: ${[...FACTORIES.keys()].join(', ')}`)
  }
  const params = new Map<string, number>()
  for (const setting of settings) {
    const [key, valueText] = setting.split('=')
    const value = Number(valueText)
    if (!key || !Number.isFinite(value)) {
      throw new Error(`Entrant setting "${setting}" in "${spec}" must be key=number.`)
    }
    params.set(key, value)
  }
  let policy = factory(params)
  if (epsilonText !== undefined) {
    const epsilon = Number(epsilonText)
    if (!(epsilon >= 0 && epsilon <= 1)) {
      throw new Error(`Noise in "${spec}" must be from 0 to 1.`)
    }
    policy = withNoise(policy, epsilon)
  }
  return { name: spec, policy }
}
