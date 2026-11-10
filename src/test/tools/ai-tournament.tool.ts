import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { HARD_AI_DEFAULT_SELECTION, decisionCriticality } from '../../game/ai-selection'
import { resolveEntrant } from '../helpers/ai-entrants'
import {
  BEHAVIOUR_TABLE_HEADER,
  BLUNDER_TABLE_HEADER,
  SEED_TABLE_HEADER,
  behaviourDiagnostics,
  blunderDiagnosticSteps,
  formatBehaviourDiagnostics,
  formatBlunderDiagnostics,
  formatSeedDiagnostics,
  seedDiagnosticSteps,
} from '../helpers/ai-diagnostics'
import {
  MATCH_TABLE_HEADER,
  drainYielding,
  formatMatchRow,
  matchGames,
  seedRange,
  type DeckPair,
} from '../helpers/ai-tournament'
import { TEST_DECK_KINDS, deckOfKind, type TestDeckKind } from '../helpers/seeded-games'

// Opt-in AI tournament: `npm run ai:tournament`. It is not part of
// `npm run test`. Settings come from environment variables:
//
//   AI_TOURNAMENT_SEEDS        seeds per match (default 200; mirrored games are twice that)
//   AI_TOURNAMENT_SEED_START   first seed (default 1); tuning uses seeds from 100000
//   AI_TOURNAMENT_PAIRS        comma-separated `first:second` entrant specs
//                              (see src/test/helpers/ai-entrants.ts)
//   AI_TOURNAMENT_DECKS        comma-separated deck kinds (default `starter`)
//   AI_TOURNAMENT_SEATING      `mirrored` (default) or `adventure`: the first
//                              entrant always plays seat 1 with the deck kind
//                              against the second on the starter deck
//   AI_TOURNAMENT_DIAGNOSTICS  `1` adds behaviour diagnostics, seed variety in
//                              calm and critical positions, and a blunder
//                              audit against a search with four times
//                              Hard's budget
//   AI_TOURNAMENT_OUT          file for the markdown report

const DEFAULT_PAIRS = 'hard:legacy-hard,hard:advanced,hard:basic,legacy-hard:advanced,legacy-hard:basic'

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

function isDeckKind(value: string): value is TestDeckKind {
  return (TEST_DECK_KINDS as readonly string[]).includes(value)
}

describe('AI tournament', () => {
  it('plays the configured matches', async () => {
    const seeds = seedRange(
      envInteger('AI_TOURNAMENT_SEED_START', 1, 0, 2 ** 40),
      envInteger('AI_TOURNAMENT_SEEDS', 200, 1, 100_000),
    )
    const pairs = envList('AI_TOURNAMENT_PAIRS', DEFAULT_PAIRS).map((pair) => {
      const [first, second] = pair.split(':')
      return [resolveEntrant(first), resolveEntrant(second ?? '')] as const
    })
    const decks = envList('AI_TOURNAMENT_DECKS', 'starter').map((kind) => {
      if (!isDeckKind(kind)) {
        throw new Error(`Unknown deck kind "${kind}". Known: ${TEST_DECK_KINDS.join(', ')}`)
      }
      return kind
    })
    const seating = process.env.AI_TOURNAMENT_SEATING === 'adventure' ? 'first-as-seat-1' : 'mirrored'
    const diagnostics = process.env.AI_TOURNAMENT_DIAGNOSTICS === '1'

    const matchRows: string[] = []
    const behaviourRows: string[] = []
    const seedRows: string[] = []
    const blunderRows: string[] = []
    const critical = (state: Parameters<typeof decisionCriticality>[0]) =>
      decisionCriticality(state) >= HARD_AI_DEFAULT_SELECTION.criticalThreshold
    for (const kind of decks) {
      // A fixed kind cycles its mono or dual variants evenly over the seeds.
      const decksFor = (seed: number): DeckPair => [undefined, deckOfKind(kind, seed, seed)]
      for (const [first, second] of pairs) {
        const label = `${first.name} vs ${second.name} (${kind})`
        const result = await drainYielding(matchGames(first, second, { seeds, decksFor, seating, recordDecisions: diagnostics }))
        matchRows.push(formatMatchRow(label, result))
        if (diagnostics) {
          behaviourRows.push(formatBehaviourDiagnostics(label, behaviourDiagnostics(result.decisions)))
          const calm = await drainYielding(seedDiagnosticSteps(first.policy, result.decisions, { stride: 4, include: (state) => !critical(state) }))
          const tense = await drainYielding(seedDiagnosticSteps(first.policy, result.decisions, { stride: 4, include: critical }))
          seedRows.push(formatSeedDiagnostics(`${label}, calm`, calm), formatSeedDiagnostics(`${label}, critical`, tense))
          blunderRows.push(formatBlunderDiagnostics(label, await drainYielding(blunderDiagnosticSteps(result.decisions, { stride: 4 }))))
        }
      }
    }

    const sections = [
      `Seeds ${seeds[0]}–${seeds[seeds.length - 1]}, seating ${seating}. Scores and latency are for the first entrant.`,
      '',
      MATCH_TABLE_HEADER,
      ...matchRows,
    ]
    if (diagnostics) {
      sections.push('', BEHAVIOUR_TABLE_HEADER, ...behaviourRows, '', SEED_TABLE_HEADER, ...seedRows, '', BLUNDER_TABLE_HEADER, ...blunderRows)
    }
    const report = sections.join('\n')
    console.log(report)
    const out = process.env.AI_TOURNAMENT_OUT
    if (out) {
      writeFileSync(out, `${report}\n`)
    }
  })
})
