import {
  generateBranchingAdventureMap,
  type AdventureMap,
  type AdventureMapNode,
} from '../../app/adventure-map'
import { ADVENTURE_SIM_DECK_IDS, isAdventureSimDeckId, mergeAdventureSimCells, type AdventureSimCell } from './adventure-deck-sim'
import { formatPercent } from './ai-tournament'

// Whole-run estimates for docs/research/adventure-deck-strength.md: where
// `generateBranchingAdventureMap` places each deck, and how often a player
// clears a run, given their per-game win rate against each deck. The opt-in
// tool `src/test/tools/adventure-decks.tool.ts` runs it with
// `ADVENTURE_SIM_MAPS`.

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

/**
 * The chance that a player clears `map` from a new run, where `winRate`
 * gives the player's chance to win a decisive game against a pool deck. A
 * loss retries the same node, as in the game.
 */
export function adventureRunClearChance(map: AdventureMap, winRate: (deckId: string) => number, routing: AdventureRouting): number {
  // Every third win before the boss can add a chance.
  const maxChances = STARTING_CHANCES + Math.floor((map.tiers.length - 1) / WINS_PER_CHANCE)
  let after = clearTable(maxChances, (chances) => (chances === 0 ? 0 : 1))
  for (let tierIndex = map.tiers.length - 1; tierIndex >= 0; tierIndex -= 1) {
    const rates = map.tiers[tierIndex].nodes.map((node) => winRate(adventureMapNodeDeckId(node, tierIndex)))
    const next = after
    after = clearTable(maxChances, () => 0)
    for (let chances = 1; chances <= maxChances; chances += 1) {
      for (let streak = 0; streak < WINS_PER_CHANCE; streak += 1) {
        const values = rates.map((rate) => nodeClearChance(rate, chances, streak, next))
        after[chances][streak] = routing === 'informed'
          ? Math.max(...values)
          : values.reduce((sum, value) => sum + value, 0) / values.length
      }
    }
  }
  return after[STARTING_CHANCES][0]
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

export interface AdventureRunModelRow {
  /** Entrant names as `opponents vs player`. */
  readonly matchup: string
  readonly informed: number
  readonly blind: number
  /** Informed clear chance at the 10th and 90th percentile of maps. */
  readonly informedP10: number
  readonly informedP90: number
  /** Mean informed clear chance on maps with each boss, by boss deck id. */
  readonly informedByBoss: ReadonlyMap<string, number>
}

export interface AdventureRunModel {
  readonly maps: number
  /** Maps by fork tiers, 1-based, such as `1,3,5`. */
  readonly forkTiers: ReadonlyMap<string, number>
  /** Non-boss decks by deck id. */
  readonly placements: ReadonlyMap<string, AdventureDeckPlacement>
  /** Maps by boss deck id. */
  readonly bosses: ReadonlyMap<string, number>
  readonly rows: readonly AdventureRunModelRow[]
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

/**
 * Generates `maps` maps from clock-like seeds, tallies where each deck lands,
 * and averages the clear chance of every matchup in `winRates` over them.
 */
export function adventureRunModel(winRates: ReadonlyMap<string, ReadonlyMap<string, number>>, maps: number): AdventureRunModel {
  const forkTiers = new Map<string, number>()
  const placements = new Map<string, AdventureDeckPlacement>()
  const bosses = new Map<string, number>()
  const clears = [...winRates].map(([matchup, rates]) => ({
    matchup,
    winRate: (deckId: string): number => {
      const rate = rates.get(deckId)
      if (rate === undefined) {
        throw new Error(`No win rate for "${deckId}" in ${matchup}.`)
      }
      return rate
    },
    informed: [] as number[],
    blind: [] as number[],
    informedByBoss: new Map<string, number[]>(),
  }))
  for (let index = 0; index < maps; index += 1) {
    const map = generateBranchingAdventureMap(ADVENTURE_RUN_MODEL_SEED_START + index * ADVENTURE_RUN_MODEL_SEED_STEP)
    const bossTier = map.tiers.length - 1
    const bossId = adventureMapNodeDeckId(map.tiers[bossTier].nodes[0], bossTier)
    increment(bosses, bossId)
    increment(forkTiers, map.tiers.flatMap((tier, tierIndex) => (tier.nodes.length > 1 ? [tierIndex + 1] : [])).join(','))
    for (let tierIndex = 0; tierIndex < bossTier; tierIndex += 1) {
      const nodes = map.tiers[tierIndex].nodes
      for (const node of nodes) {
        const deckId = adventureMapNodeDeckId(node, tierIndex)
        const placement = placements.get(deckId) ?? { maps: 0, single: 0, fork: 0, tierSum: 0 }
        placement.maps += 1
        placement.single += nodes.length === 1 ? 1 : 0
        placement.fork += nodes.length > 1 ? 1 : 0
        placement.tierSum += tierIndex + 1
        placements.set(deckId, placement)
      }
    }
    for (const clear of clears) {
      const informed = adventureRunClearChance(map, clear.winRate, 'informed')
      clear.informed.push(informed)
      clear.blind.push(adventureRunClearChance(map, clear.winRate, 'blind'))
      const byBoss = clear.informedByBoss.get(bossId) ?? []
      byBoss.push(informed)
      clear.informedByBoss.set(bossId, byBoss)
    }
  }
  const rows = clears.map((clear): AdventureRunModelRow => {
    const sorted = [...clear.informed].sort((left, right) => left - right)
    return {
      matchup: clear.matchup,
      informed: mean(clear.informed),
      blind: mean(clear.blind),
      informedP10: percentile(sorted, 0.1),
      informedP90: percentile(sorted, 0.9),
      informedByBoss: new Map([...clear.informedByBoss].map(([bossId, values]) => [bossId, mean(values)])),
    }
  })
  return { maps, forkTiers, placements, bosses, rows }
}

function byPoolOrder<V>(entries: ReadonlyMap<string, V>): [string, V][] {
  return [...entries].sort(([left], [right]) => ADVENTURE_SIM_DECK_IDS.indexOf(left) - ADVENTURE_SIM_DECK_IDS.indexOf(right))
}

/** A markdown report of map placement and run clear chances. */
export function formatAdventureRunModelReport(model: AdventureRunModel, skipped: readonly string[] = []): string {
  const share = (count: number): string => formatPercent(model.maps === 0 ? 0 : count / model.maps)
  const bossIds = byPoolOrder(model.bosses).map(([bossId]) => bossId)
  const lines: string[] = [
    '### Map placement',
    '',
    `${model.maps} maps from \`generateBranchingAdventureMap\`; map i (from 0) has seed ${ADVENTURE_RUN_MODEL_SEED_START} + ${ADVENTURE_RUN_MODEL_SEED_STEP} × i.`,
    '',
    `Fork tiers: ${[...model.forkTiers].sort(([left], [right]) => left.localeCompare(right)).map(([tiers, count]) => `{${tiers}} ${share(count)}`).join(', ')}.`,
    `Bosses: ${byPoolOrder(model.bosses).map(([bossId, count]) => `${bossId} ${share(count)}`).join(', ')}.`,
    '',
    '| Deck | On map | Single-node tier | Fork | Mean tier |',
    '|---|---|---|---|---|',
    ...byPoolOrder(model.placements).map(([deckId, placement]) =>
      `| ${deckId} | ${share(placement.maps)} | ${share(placement.single)} | ${share(placement.fork)} | ${(placement.maps === 0 ? 0 : placement.tierSum / placement.maps).toFixed(2)} |`),
    '',
    '### Run model',
    '',
    'Chance to clear a whole run without relics, from each matchup\'s decisive games in the `adventure` seating. Informed routing takes the fork with the better clear chance; blind routing takes either. Boss columns are the informed mean on maps with that boss.',
    '',
    `| Opponents vs player | Informed | Blind | Informed p10 | Informed p90 | ${bossIds.join(' | ')} |`,
    `|---|---|---|---|---|${bossIds.map(() => '---').join('|')}|`,
    ...model.rows.map((row) =>
      `| ${row.matchup} | ${formatPercent(row.informed)} | ${formatPercent(row.blind)} | ${formatPercent(row.informedP10)} | ${formatPercent(row.informedP90)} | ${bossIds.map((bossId) => formatPercent(row.informedByBoss.get(bossId) ?? 0)).join(' | ')} |`),
  ]
  if (skipped.length > 0) {
    lines.push('', `Skipped, missing decks or decisive games: ${skipped.join(', ')}.`)
  }
  return lines.join('\n')
}
