import { readFileSync, writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { ADVENTURE_TIER_COUNT } from '../../app/adventure-map'
import { resolveEntrant } from '../helpers/ai-entrants'
import { drainYielding } from '../helpers/ai-tournament'
import {
  ADVENTURE_SIM_DECK_IDS,
  ADVENTURE_SIM_SEATINGS,
  adventureSimCellSteps,
  formatAdventureSimReport,
  isAdventureSimDeckId,
  isAdventureSimSeating,
  parseAdventureSimCells,
  serializeAdventureSimCells,
  type AdventureSimCell,
} from '../helpers/adventure-deck-sim'
import {
  ADVENTURE_RUN_MAP_ORDERS,
  adventureRunModelPlans,
  adventureRunModelSteps,
  adventureRunModelWinRates,
  formatAdventureRunModelReport,
  isAdventureRunMapOrder,
} from '../helpers/adventure-run-model'

// Opt-in Adventure deck measurement: `npm run ai:adventure-decks`. It is not
// part of `npm run test`. Every Adventure opponent deck plays best-of-three
// series against the standard deck (ten of each land). Settings come from
// environment variables:
//
//   ADVENTURE_SIM_SERIES      series per deck, matchup and seating (default 100)
//   ADVENTURE_SIM_SEED_START  first series number (default 1); series seed
//                             their games through `adventureSimGameSeed`
//   ADVENTURE_SIM_MATCHUPS    comma-separated `adventure:standard` entrant
//                             specs (default `basic:basic,advanced:advanced,hard:hard`;
//                             see src/test/helpers/ai-entrants.ts); a spec
//                             without `:` plays both decks
//   ADVENTURE_SIM_DECKS       comma-separated deck ids (default all seventeen);
//                             `mix-<Land><count>-…` ids, counts summing to 50
//                             in BASIC_LANDS order, add candidate decks
//   ADVENTURE_SIM_SEATINGS    `adventure` (the standard deck moves first, as the
//                             player does in Adventure) and `swapped`
//                             (default both)
//   ADVENTURE_SIM_JSON        file for the raw results, rewritten after every
//                             deck, so shards can be merged later
//   ADVENTURE_SIM_MERGE       comma-separated result files: report their sum
//                             and play nothing
//   ADVENTURE_SIM_MAPS        maps for the map placement and run model
//                             sections (default 0: none); the run model uses
//                             every matchup with all seventeen decks in the
//                             `adventure` seating whose opponents play at an
//                             AI level, on maps ordered for that level
//   ADVENTURE_SIM_RAMP_TIERS  comma-separated tier counts (default none); each
//                             adds a ramped run per matchup, whose first tiers
//                             play the level below, when that level was
//                             measured against the same player
//   ADVENTURE_SIM_MAP_ORDER   `level` (default) orders each map for its AI
//                             level, as new runs are; `shuffled` deals the
//                             decks in shuffled order, as before level ordering
//   ADVENTURE_SIM_OUT         file for the markdown report
//
// On one core of a two-core cloud machine, 500 series of every deck in both
// seatings took about two minutes at Basic and five at Advanced, while Hard
// took about seven minutes per 100 series of every deck in one seating.
// Split long runs by deck or by matchup, one process per CPU, and merge their
// result files.

const DEFAULT_MATCHUPS = 'basic:basic,advanced:advanced,hard:hard'

function envInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}, got "${raw}".`)
  }
  return value
}

function envList(name: string, fallback: string): string[] {
  return (process.env[name] || fallback).split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
}

async function playCells(): Promise<{ cells: AdventureSimCell[]; header: string }> {
  const start = envInteger('ADVENTURE_SIM_SEED_START', 1, 0, 2 ** 40)
  const count = envInteger('ADVENTURE_SIM_SERIES', 100, 1, 100_000)
  const series = Array.from({ length: count }, (_, index) => start + index)
  const matchups = envList('ADVENTURE_SIM_MATCHUPS', DEFAULT_MATCHUPS).map((matchup) => {
    const [adventure, standard] = matchup.split(':')
    return [resolveEntrant(adventure), resolveEntrant(standard ?? adventure)] as const
  })
  const deckIds = envList('ADVENTURE_SIM_DECKS', ADVENTURE_SIM_DECK_IDS.join(',')).map((deckId) => {
    if (!isAdventureSimDeckId(deckId)) {
      throw new Error(`Unknown deck "${deckId}". Known: ${ADVENTURE_SIM_DECK_IDS.join(', ')} and mix-<Land><count>-… candidates`)
    }
    return deckId
  })
  const seatings = envList('ADVENTURE_SIM_SEATINGS', ADVENTURE_SIM_SEATINGS.join(',')).map((seating) => {
    if (!isAdventureSimSeating(seating)) {
      throw new Error(`Unknown seating "${seating}". Known: ${ADVENTURE_SIM_SEATINGS.join(', ')}`)
    }
    return seating
  })
  const json = process.env.ADVENTURE_SIM_JSON
  const cells: AdventureSimCell[] = []
  for (const [adventure, standard] of matchups) {
    for (const seating of seatings) {
      for (const deckId of deckIds) {
        const begun = performance.now()
        const cell = await drainYielding(adventureSimCellSteps({ deckId, adventure, standard, seating, series }))
        cells.push(cell)
        if (json) {
          writeFileSync(json, serializeAdventureSimCells(cells))
        }
        const seconds = ((performance.now() - begun) / 1000).toFixed(1)
        console.log(`${cell.matchup}, ${seating}, ${deckId}: series ${cell.series.wins}-${cell.series.losses}-${cell.series.draws} in ${seconds} s`)
      }
    }
  }
  return { cells, header: `Series ${start}–${start + count - 1}, best of three.` }
}

describe('Adventure deck strength', () => {
  it('plays every deck against the standard deck', async () => {
    const merge = envList('ADVENTURE_SIM_MERGE', '')
    const maps = envInteger('ADVENTURE_SIM_MAPS', 0, 0, 1_000_000)
    const { cells, header } = merge.length > 0
      ? { cells: merge.flatMap((path) => parseAdventureSimCells(readFileSync(path, 'utf8'))), header: `Merged from ${merge.join(', ')}.` }
      : await playCells()
    let report = `${header}\n${formatAdventureSimReport(cells)}`
    if (maps > 0) {
      const rampTiers = envList('ADVENTURE_SIM_RAMP_TIERS', '').map((entry) => {
        const tiers = Number(entry)
        if (!Number.isSafeInteger(tiers) || tiers < 1 || tiers >= ADVENTURE_TIER_COUNT) {
          throw new Error(`ADVENTURE_SIM_RAMP_TIERS entries must be integers from 1 to ${ADVENTURE_TIER_COUNT - 1}, got "${entry}".`)
        }
        return tiers
      })
      const order = process.env.ADVENTURE_SIM_MAP_ORDER || 'level'
      if (!isAdventureRunMapOrder(order)) {
        throw new Error(`Unknown map order "${order}". Known: ${ADVENTURE_RUN_MAP_ORDERS.join(', ')}`)
      }
      const { rates, skipped } = adventureRunModelWinRates(cells)
      const plans = adventureRunModelPlans(rates, rampTiers)
      const model = await drainYielding(adventureRunModelSteps(plans.plans, maps, order))
      report += `\n\n${formatAdventureRunModelReport(model, [...skipped, ...plans.skipped])}`
    }
    console.log(report)
    const out = process.env.ADVENTURE_SIM_OUT
    if (out) {
      writeFileSync(out, `${report}\n`)
    }
  })
})
