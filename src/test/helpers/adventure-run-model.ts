import { ADVENTURE_DECK_BANDS } from '../../app/adventure-difficulty'
import {
  buildAdventureOpponentPools,
  generateBranchingAdventureMap,
  type AdventureDeckBands,
  type AdventureMap,
  type AdventureMapNode,
} from '../../app/adventure-map'
import { AI_LEVELS, isAiLevel, type AiLevel } from '../../game/ai-levels'
import {
  ADVENTURE_SIM_DECK_IDS,
  compareAdventureSimDeckIds,
  isAdventureSimDeckId,
  mergeAdventureSimCells,
  type AdventureSimCell,
} from './adventure-deck-sim'
import { formatPercent } from './ai-tournament'

// Whole-run estimates for docs/research/adventure-deck-strength.md: where
// `generateBranchingAdventureMap` places each deck at each AI level, how
// often a player clears a run, given their per-game win rate against each
// deck, and on which tier runs end. The opt-in tool
// `src/test/tools/adventure-decks.tool.ts` runs it with `ADVENTURE_SIM_MAPS`.

// The chance rules of `resolveAdventureEncounterResult` in src/app/adventure.ts:
// a run starts with three chances, every third consecutive win adds one, and
// a loss costs one and resets the streak. A draw retries the node and changes
// neither, so the model uses decisive games only. Relics are ignored.
const STARTING_CHANCES = 3
const WINS_PER_CHANCE = 3

/** Map seeds look like the clock values new runs use: 2026-01-01 UTC, then every 7,919 ms. */
export const ADVENTURE_RUN_MODEL_SEED_START = Date.UTC(2026, 0, 1)
export const ADVENTURE_RUN_MODEL_SEED_STEP = 7_919

/**
 * `informed` routing takes the fork with the better clear chance; `blind`
 * routing takes either fork with equal probability.
 */
export type AdventureRouting = 'informed' | 'blind'

/** The player's decisive-game win rate against a pool deck on a tier, from 0 for tier 1. */
export type AdventureRunWinRate = (deckId: string, tierIndex: number) => number

/**
 * `level` orders each map by the bands of the run's AI level, as new runs
 * are. `shuffled` puts every deck in one band, which deals the same decks to
 * the same tiers as maps before level ordering; only fork lanes can differ.
 */
export const ADVENTURE_RUN_MAP_ORDERS = ['level', 'shuffled'] as const
export type AdventureRunMapOrder = (typeof ADVENTURE_RUN_MAP_ORDERS)[number]

export function isAdventureRunMapOrder(value: string): value is AdventureRunMapOrder {
  return (ADVENTURE_RUN_MAP_ORDERS as readonly string[]).includes(value)
}

const SHUFFLED_ORDER_BANDS: AdventureDeckBands = Object.freeze(
  Object.fromEntries(buildAdventureOpponentPools(0).nonBoss.map((opponent) => [opponent.id, 'even'] as const)),
)

/** The bands that order a run's maps at an AI level. */
export function adventureRunMapBands(order: AdventureRunMapOrder, level: AiLevel): AdventureDeckBands {
  switch (order) {
    case 'level':
      return ADVENTURE_DECK_BANDS[level]
    case 'shuffled':
      return SHUFFLED_ORDER_BANDS
    default:
      throw new Error(`Unknown map order "${String(order)}".`)
  }
}

/** The pool deck id of a generated node, whose opponent id is `adventure-opponent-<tier>-<deck id>`. */
export function adventureMapNodeDeckId(node: AdventureMapNode, tierIndex: number): string {
  const prefix = `adventure-opponent-${tierIndex + 1}-`
  const deckId = node.opponent.id.startsWith(prefix) ? node.opponent.id.slice(prefix.length) : ''
  if (!isAdventureSimDeckId(deckId)) {
    throw new Error(`Unexpected Adventure opponent id "${node.opponent.id}".`)
  }
  return deckId
}

/** Clear chance by chances left (index 0 is a failed run) and win streak modulo three. */
type ClearTable = number[][]

function clearTable(maxChances: number, value: (chances: number) => number): ClearTable {
  return Array.from({ length: maxChances + 1 }, (_, chances) => Array.from({ length: WINS_PER_CHANCE }, () => value(chances)))
}

/** The clear chance from one node on: win it at once, or lose 1 to `chances - 1` times and then win. */
function nodeClearChance(winRate: number, chances: number, streak: number, after: ClearTable): number {
  const streakAfterWin = (streak + 1) % WINS_PER_CHANCE
  // Only states a run cannot reach go past the table; clamp them.
  const chancesAfterWin = Math.min(after.length - 1, chances + (streakAfterWin === 0 ? 1 : 0))
  let total = winRate * after[chancesAfterWin][streakAfterWin]
  let lostSoFar = 1 - winRate
  for (let losses = 1; losses < chances; losses += 1) {
    total += lostSoFar * winRate * after[chances - losses][1]
    lostSoFar *= 1 - winRate
  }
  return total
}

interface RunSolution {
  /** The clear chance on entering each tier, then after the boss. */
  readonly values: ClearTable[]
  /** The player's win rate against each node, by tier. */
  readonly rates: number[][]
}

function solveRun(map: AdventureMap, winRate: AdventureRunWinRate, routing: AdventureRouting): RunSolution {
  // Every third win before the boss can add a chance.
  const maxChances = STARTING_CHANCES + Math.floor((map.tiers.length - 1) / WINS_PER_CHANCE)
  const rates = map.tiers.map((tier, tierIndex) => tier.nodes.map((node) => winRate(adventureMapNodeDeckId(node, tierIndex), tierIndex)))
  const values: ClearTable[] = [clearTable(maxChances, (chances) => (chances === 0 ? 0 : 1))]
  for (let tierIndex = map.tiers.length - 1; tierIndex >= 0; tierIndex -= 1) {
    const next = values[0]
    const table = clearTable(maxChances, () => 0)
    for (let chances = 1; chances <= maxChances; chances += 1) {
      for (let streak = 0; streak < WINS_PER_CHANCE; streak += 1) {
        const nodeValues = rates[tierIndex].map((rate) => nodeClearChance(rate, chances, streak, next))
        table[chances][streak] = routing === 'informed' ? Math.max(...nodeValues) : mean(nodeValues)
      }
    }
    values.unshift(table)
  }
  return { values, rates }
}

/** The win rate of each node the player may take, with the chance of taking it. */
function routeChoices(rates: readonly number[], chances: number, streak: number, after: ClearTable, routing: AdventureRouting): [number, number][] {
  if (routing === 'blind') {
    return rates.map((rate) => [rate, 1 / rates.length])
  }
  const values = rates.map((rate) => nodeClearChance(rate, chances, streak, after))
  return [[rates[values.indexOf(Math.max(...values))], 1]]
}

/** Follows runs forward from a new run: the chance to fail on each tier, then to clear. */
function runOutcomes(solution: RunSolution, routing: AdventureRouting): number[] {
  const maxChances = solution.values[0].length - 1
  let reach = clearTable(maxChances, () => 0)
  reach[STARTING_CHANCES][0] = 1
  const outcomes: number[] = []
  solution.rates.forEach((rates, tierIndex) => {
    const next = clearTable(maxChances, () => 0)
    let failed = 0
    for (let chances = 1; chances <= maxChances; chances += 1) {
      for (let streak = 0; streak < WINS_PER_CHANCE; streak += 1) {
        if (reach[chances][streak] === 0) {
          continue
        }
        for (const [rate, weight] of routeChoices(rates, chances, streak, solution.values[tierIndex + 1], routing)) {
          const share = reach[chances][streak] * weight
          const streakAfterWin = (streak + 1) % WINS_PER_CHANCE
          next[Math.min(maxChances, chances + (streakAfterWin === 0 ? 1 : 0))][streakAfterWin] += share * rate
          let lostSoFar = 1 - rate
          for (let losses = 1; losses < chances; losses += 1) {
            next[chances - losses][1] += share * lostSoFar * rate
            lostSoFar *= 1 - rate
          }
          failed += share * lostSoFar
        }
      }
    }
    outcomes.push(failed)
    reach = next
  })
  outcomes.push(reach.flat().reduce((sum, value) => sum + value, 0))
  return outcomes
}

/**
 * The chance that a player clears `map` from a new run, where `winRate`
 * gives the player's chance to win a decisive game against a pool deck on a
 * tier. A loss retries the same node, as in the game.
 */
export function adventureRunClearChance(map: AdventureMap, winRate: AdventureRunWinRate, routing: AdventureRouting): number {
  return solveRun(map, winRate, routing).values[0][STARTING_CHANCES][0]
}

/**
 * Where runs on `map` end: the chance to fail on each tier, from tier 1,
 * then the chance to clear the run. The entries sum to one.
 */
export function adventureRunOutcomes(map: AdventureMap, winRate: AdventureRunWinRate, routing: AdventureRouting): number[] {
  return runOutcomes(solveRun(map, winRate, routing), routing)
}

/**
 * The player's decisive-game win rate against every deck, by matchup, from
 * the `adventure` seating, where the standard deck moves first as the player
 * does. A matchup missing a deck, or with no decisive game against one, is
 * listed in `skipped` instead.
 */
export function adventureRunModelWinRates(cells: readonly AdventureSimCell[]): {
  rates: Map<string, Map<string, number>>
  skipped: string[]
} {
  const byMatchup = new Map<string, Map<string, number>>()
  for (const cell of mergeAdventureSimCells(cells)) {
    if (cell.seating !== 'adventure') {
      continue
    }
    // The standard deck is the player, so its wins are the Adventure deck's losses.
    const decisive = cell.games.wins + cell.games.losses
    const rates = byMatchup.get(cell.matchup) ?? new Map<string, number>()
    rates.set(cell.deckId, decisive === 0 ? Number.NaN : cell.games.losses / decisive)
    byMatchup.set(cell.matchup, rates)
  }
  const rates = new Map<string, Map<string, number>>()
  const skipped: string[] = []
  for (const [matchup, deckRates] of byMatchup) {
    const complete = ADVENTURE_SIM_DECK_IDS.every((deckId) => Number.isFinite(deckRates.get(deckId)))
    if (complete) {
      rates.set(matchup, deckRates)
    } else {
      skipped.push(matchup)
    }
  }
  return { rates, skipped }
}

export interface AdventureDeckPlacement {
  /** Maps holding the deck, on a single-node tier, and at a fork. */
  maps: number
  single: number
  fork: number
  /** Sum of the deck's 1-based tiers, for the mean. */
  tierSum: number
}

/** One kind of run that the model averages over maps. */
export interface AdventureRunPlan {
  /** Entrant names as `opponents vs player`, then any ramp. */
  readonly name: string
  /** The AI level the run starts at, whose bands order its maps. */
  readonly level: AiLevel
  readonly winRate: AdventureRunWinRate
}

export interface AdventureRunModelRow {
  readonly name: string
  readonly level: AiLevel
  readonly informed: number
  readonly blind: number
  /** Informed clear chance at the 10th and 90th percentile of maps. */
  readonly informedP10: number
  readonly informedP90: number
  /** Mean informed clear chance on maps with each boss, by boss deck id. */
  readonly informedByBoss: ReadonlyMap<string, number>
  /** Mean informed chance to fail on each tier, from tier 1, then to clear. */
  readonly informedOutcomes: readonly number[]
}

export interface AdventureRunModel {
  readonly maps: number
  readonly order: AdventureRunMapOrder
  /** Maps by fork tiers, 1-based, such as `1,3,5`. */
  readonly forkTiers: ReadonlyMap<string, number>
  /** Non-boss decks by deck id, on the maps of each AI level. */
  readonly placements: ReadonlyMap<AiLevel, ReadonlyMap<string, AdventureDeckPlacement>>
  /** Maps by boss deck id. */
  readonly bosses: ReadonlyMap<string, number>
  readonly rows: readonly AdventureRunModelRow[]
}

const MATCHUP_SEPARATOR = ' vs '

function deckRate(rates: ReadonlyMap<string, number>, matchup: string, deckId: string): number {
  const rate = rates.get(deckId)
  if (rate === undefined) {
    throw new Error(`No win rate for "${deckId}" in ${matchup}.`)
  }
  return rate
}

/**
 * A run for every matchup in `winRates` whose opponents play at an AI level,
 * on maps ordered for that level; other matchups are listed in `skipped`.
 * For each count in `rampTiers`, a matchup also gets a ramped run, where its
 * first tiers play the level below, if that level was measured against the
 * same player.
 */
export function adventureRunModelPlans(
  winRates: ReadonlyMap<string, ReadonlyMap<string, number>>,
  rampTiers: readonly number[] = [],
): { plans: AdventureRunPlan[]; skipped: string[] } {
  const plans: AdventureRunPlan[] = []
  const skipped: string[] = []
  for (const [matchup, rates] of winRates) {
    const separator = matchup.indexOf(MATCHUP_SEPARATOR)
    const opponents = separator < 0 ? '' : matchup.slice(0, separator)
    if (!isAiLevel(opponents)) {
      skipped.push(matchup)
      continue
    }
    plans.push({ name: matchup, level: opponents, winRate: (deckId) => deckRate(rates, matchup, deckId) })
    const levelIndex = AI_LEVELS.indexOf(opponents)
    const lower = levelIndex > 0 ? AI_LEVELS[levelIndex - 1] : undefined
    const lowerMatchup = `${lower}${matchup.slice(separator)}`
    const lowerRates = lower === undefined ? undefined : winRates.get(lowerMatchup)
    if (lowerRates === undefined) {
      continue
    }
    for (const tiers of rampTiers) {
      plans.push({
        name: `${matchup}, ${tiers === 1 ? 'tier 1' : `tiers 1–${tiers}`} at ${lower}`,
        level: opponents,
        winRate: (deckId, tierIndex) =>
          (tierIndex < tiers ? deckRate(lowerRates, lowerMatchup, deckId) : deckRate(rates, matchup, deckId)),
      })
    }
  }
  return { plans, skipped }
}

function increment<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.floor(fraction * (sorted.length - 1))]
}

function tallyPlacements(placements: Map<string, AdventureDeckPlacement>, map: AdventureMap): void {
  map.tiers.slice(0, -1).forEach((tier, tierIndex) => {
    for (const node of tier.nodes) {
      const deckId = adventureMapNodeDeckId(node, tierIndex)
      const placement = placements.get(deckId) ?? { maps: 0, single: 0, fork: 0, tierSum: 0 }
      placement.maps += 1
      placement.single += tier.nodes.length === 1 ? 1 : 0
      placement.fork += tier.nodes.length > 1 ? 1 : 0
      placement.tierSum += tierIndex + 1
      placements.set(deckId, placement)
    }
  })
}

/** The boss deck id and the 1-based fork tiers of a map. */
function mapShape(map: AdventureMap): { bossId: string; forkTiers: string } {
  const bossTier = map.tiers.length - 1
  return {
    bossId: adventureMapNodeDeckId(map.tiers[bossTier].nodes[0], bossTier),
    forkTiers: map.tiers.flatMap((tier, tierIndex) => (tier.nodes.length > 1 ? [tierIndex + 1] : [])).join(','),
  }
}

/**
 * Generates `maps` maps at every AI level from clock-like seeds, one seed
 * per step, tallies where each deck lands, and averages the clear chance and
 * outcomes of every plan over the maps of its level.
 */
export function* adventureRunModelSteps(
  plans: readonly AdventureRunPlan[],
  maps: number,
  order: AdventureRunMapOrder = 'level',
): Generator<void, AdventureRunModel> {
  const forkTiers = new Map<string, number>()
  const bosses = new Map<string, number>()
  const placements = new Map(AI_LEVELS.map((level) => [level, new Map<string, AdventureDeckPlacement>()]))
  const clears = plans.map((plan) => ({
    plan,
    informed: [] as number[],
    blind: [] as number[],
    informedByBoss: new Map<string, number[]>(),
    outcomeSums: [] as number[],
  }))
  for (let index = 0; index < maps; index += 1) {
    const seed = ADVENTURE_RUN_MODEL_SEED_START + index * ADVENTURE_RUN_MODEL_SEED_STEP
    const levelMaps = new Map(AI_LEVELS.map((level) => [level, generateBranchingAdventureMap(seed, adventureRunMapBands(order, level))]))
    const shapes = [...levelMaps.values()].map(mapShape)
    if (shapes.some((shape) => shape.bossId !== shapes[0].bossId || shape.forkTiers !== shapes[0].forkTiers)) {
      throw new Error(`Maps from seed ${seed} differ in boss or fork tiers across AI levels.`)
    }
    const { bossId } = shapes[0]
    increment(bosses, bossId)
    increment(forkTiers, shapes[0].forkTiers)
    for (const [level, map] of levelMaps) {
      tallyPlacements(placements.get(level) ?? new Map(), map)
    }
    for (const clear of clears) {
      const map = levelMaps.get(clear.plan.level)
      if (map === undefined) {
        throw new Error(`No map for AI level "${clear.plan.level}".`)
      }
      const solution = solveRun(map, clear.plan.winRate, 'informed')
      const informed = solution.values[0][STARTING_CHANCES][0]
      clear.informed.push(informed)
      clear.blind.push(adventureRunClearChance(map, clear.plan.winRate, 'blind'))
      const byBoss = clear.informedByBoss.get(bossId) ?? []
      byBoss.push(informed)
      clear.informedByBoss.set(bossId, byBoss)
      runOutcomes(solution, 'informed').forEach((chance, outcome) => {
        clear.outcomeSums[outcome] = (clear.outcomeSums[outcome] ?? 0) + chance
      })
    }
    yield
  }
  const rows = clears.map((clear): AdventureRunModelRow => {
    const sorted = [...clear.informed].sort((left, right) => left - right)
    return {
      name: clear.plan.name,
      level: clear.plan.level,
      informed: mean(clear.informed),
      blind: mean(clear.blind),
      informedP10: percentile(sorted, 0.1),
      informedP90: percentile(sorted, 0.9),
      informedByBoss: new Map([...clear.informedByBoss].map(([bossId, values]) => [bossId, mean(values)])),
      informedOutcomes: clear.outcomeSums.map((sum) => (maps === 0 ? 0 : sum / maps)),
    }
  })
  return { maps, order, forkTiers, placements, bosses, rows }
}

function byPoolOrder<V>(entries: ReadonlyMap<string, V>): [string, V][] {
  return [...entries].sort(([left], [right]) => compareAdventureSimDeckIds(left, right))
}

const LEVEL_LABELS: Readonly<Record<AiLevel, string>> = { basic: 'Basic', advanced: 'Advanced', hard: 'Hard' }

const ORDER_TEXT: Readonly<Record<AdventureRunMapOrder, { maps: string; runs: string }>> = {
  level: { maps: 'ordered by the bands of that level', runs: 'on maps ordered for the opponents\' level' },
  shuffled: {
    maps: 'with every deck in one band, which deals the decks in shuffled order, as before level ordering',
    runs: 'on shuffled maps',
  },
}

/** A markdown report of map placement, run clear chances and where runs end. */
export function formatAdventureRunModelReport(model: AdventureRunModel, skipped: readonly string[] = []): string {
  const share = (count: number): string => formatPercent(model.maps === 0 ? 0 : count / model.maps)
  const bossIds = byPoolOrder(model.bosses).map(([bossId]) => bossId)
  const lines: string[] = [
    '### Map placement',
    '',
    `${model.maps} maps from \`generateBranchingAdventureMap\` at each AI level, ${ORDER_TEXT[model.order].maps}; map i (from 0) has seed ${ADVENTURE_RUN_MODEL_SEED_START} + ${ADVENTURE_RUN_MODEL_SEED_STEP} × i. The levels share each map's fork tiers and boss.`,
    '',
    `Fork tiers: ${[...model.forkTiers].sort(([left], [right]) => left.localeCompare(right)).map(([tiers, count]) => `{${tiers}} ${share(count)}`).join(', ')}.`,
    `Bosses: ${byPoolOrder(model.bosses).map(([bossId, count]) => `${bossId} ${share(count)}`).join(', ')}.`,
  ]
  for (const [level, placements] of model.placements) {
    lines.push(
      '',
      `${LEVEL_LABELS[level]} maps:`,
      '',
      '| Deck | Band | On map | Single-node tier | Fork | Mean tier |',
      '|---|---|---|---|---|---|',
      ...byPoolOrder(placements).map(([deckId, placement]) =>
        `| ${deckId} | ${ADVENTURE_DECK_BANDS[level][deckId] ?? '?'} | ${share(placement.maps)} | ${share(placement.single)} | ${share(placement.fork)} | ${(placement.maps === 0 ? 0 : placement.tierSum / placement.maps).toFixed(2)} |`),
    )
  }
  lines.push(
    '',
    '### Run model',
    '',
    `Chance to clear a whole run without relics, from each matchup's decisive games in the \`adventure\` seating, ${ORDER_TEXT[model.order].runs}. A ramped run plays its first tiers at the level below. Informed routing takes the fork with the better clear chance; blind routing takes either. Boss columns are the informed mean on maps with that boss.`,
    '',
    `| Run | Informed | Blind | Informed p10 | Informed p90 | ${bossIds.join(' | ')} |`,
    `|---|---|---|---|---|${bossIds.map(() => '---').join('|')}|`,
    ...model.rows.map((row) =>
      `| ${row.name} | ${formatPercent(row.informed)} | ${formatPercent(row.blind)} | ${formatPercent(row.informedP10)} | ${formatPercent(row.informedP90)} | ${bossIds.map((bossId) => formatPercent(row.informedByBoss.get(bossId) ?? 0)).join(' | ')} |`),
  )
  const tiers = model.rows[0]?.informedOutcomes.length ?? 0
  if (tiers > 1) {
    const tierLabels = Array.from({ length: tiers - 1 }, (_, tierIndex) => (tierIndex === tiers - 2 ? 'Boss' : `Tier ${tierIndex + 1}`))
    lines.push(
      '',
      '### Where runs end',
      '',
      'Chance that an informed run fails on each tier, or clears.',
      '',
      `| Run | ${tierLabels.join(' | ')} | Clear |`,
      `|---|${tierLabels.map(() => '---').join('|')}|---|`,
      ...model.rows.map((row) => `| ${row.name} | ${row.informedOutcomes.map((chance) => formatPercent(chance)).join(' | ')} |`),
    )
  }
  if (skipped.length > 0) {
    lines.push('', `Skipped, missing decks or decisive games, or opponents not at an AI level: ${skipped.join(', ')}.`)
  }
  return lines.join('\n')
}
