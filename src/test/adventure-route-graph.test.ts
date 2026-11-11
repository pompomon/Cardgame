import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyAdventureEncounterResult,
  createAdventureRun,
  createInactiveAdventureState,
  skipAdventureRunReward,
  startAdventureEncounter,
  type AdventureRunState,
} from '../app/adventure'
import {
  ADVENTURE_FORK_PATTERNS,
  generateBranchingAdventureMap,
  type AdventureNodeLane,
  type AdventureNodeStatus,
} from '../app/adventure-map'
import {
  adventureRouteEdgeState,
  adventureRouteGraph,
  adventureRouteLaneX,
  type AdventureRouteGraphRow,
} from '../app/adventure-route-graph'
import type { AdventureOpponentSummary, AdventureTierSummary, AppState } from '../app/types'
import { buildViewModel } from '../app/view-model'
import { deepFreeze } from './helpers/deep-freeze'

const RUN_ID = '0123456789abcdef0123456789abcdef'
const OPPONENT: AdventureOpponentSummary = { id: 'standard', label: 'Balanced roster (10 of each creature)', kind: 'standard', lands: [] }

/** A frozen route with one tier per argument: one status is a center node, two are a left/right fork. */
function route(...tiers: Array<readonly AdventureNodeStatus[]>): readonly AdventureTierSummary[] {
  return deepFreeze(tiers.map((statuses, tierIndex): AdventureTierSummary => {
    const lanes: readonly AdventureNodeLane[] = statuses.length === 2 ? ['left', 'right'] : ['center']
    return {
      tierIndex,
      nodes: statuses.map((status, index) => ({
        id: `tier-${tierIndex + 1}-${lanes[index]}`,
        tierIndex,
        lane: lanes[index],
        status,
        boss: tierIndex === tiers.length - 1,
        opponent: OPPONENT,
      })),
    }
  }))
}

/** Each tier's incoming lines as "from>to state", with "start" for the start dot. */
function lines(rows: readonly AdventureRouteGraphRow[]): string[][] {
  return rows.map((row) => row.incoming.map((line) => `${line.fromNodeId ?? 'start'}>${line.toNodeId} ${line.state}`))
}

function stems(rows: readonly AdventureRouteGraphRow[]): Array<Array<string | null>> {
  return rows.map((row) => row.nodes.map((node) => node.stem))
}

const forkPatternSeeds = new Map<string, number>()

/** A clock value whose branching map forks at the given 0-based tiers. */
function seedForForkPattern(pattern: readonly number[]): number {
  const key = pattern.join(',')
  for (let seed = forkPatternSeeds.get(key) ?? 1_770_000_000_000; seed < 1_770_000_001_000; seed += 1) {
    const forks = generateBranchingAdventureMap(seed).tiers.flatMap((tier, index) => (tier.nodes.length === 2 ? [index] : []))
    if (forks.join(',') === key) {
      forkPatternSeeds.set(key, seed)
      return seed
    }
  }
  throw new Error(`No seed found for fork pattern ${key}.`)
}

/** The run's route as the view model projects it for the hub. */
function projectedTiers(run: AdventureRunState): readonly AdventureTierSummary[] {
  const state: AppState = {
    mode: 'adventure-hvai',
    game: null,
    controllers: ['human', 'ai'],
    seed: run.baseSeed,
    offer: '',
    answer: '',
    status: '',
    recording: null,
    replay: null,
    hasSavedRecording: false,
    aiLevel: 'basic',
    cardVisualStyle: 'classic',
    monochromeCards: false,
    animationSpeed: 'normal',
    boardTheme: 'classic',
    renderQualityPreference: 'auto',
    p2pStarted: false,
    pendingP2PStartSeed: null,
    pendingRematchSeed: null,
    adventure: { ...createInactiveAdventureState(0, true), run },
  }
  return buildViewModel(state, false).adventure.tiers
}

function started(run: AdventureRunState, nodeId: string): AdventureRunState {
  const next = startAdventureEncounter(run, nodeId)
  if (!next) throw new Error(`Expected ${nodeId} to start.`)
  return next
}

/** Wins `nodeId` and skips any reward, back at the map. */
function won(run: AdventureRunState, nodeId: string): AdventureRunState {
  const next = applyAdventureEncounterResult(started(run, nodeId), 'win')
  return skipAdventureRunReward(next, next.pendingReward?.offerId) ?? next
}

describe('adventure route lanes and lines', () => {
  it('places the left, center and right lanes at 25, 50 and 75, and an unknown lane in the center', () => {
    expect((['left', 'center', 'right'] as const).map((lane) => adventureRouteLaneX(lane))).toEqual([25, 50, 75])
    expect(adventureRouteLaneX('middle' as never)).toBe(50)
  })

  // Columns are the status at the line's lower end.
  const TO = ['completed', 'current', 'available', 'bypassed', 'locked', 'unknown'] as const
  const LINE_STATES = {
    start: 'traveled next next bypassed future future',
    completed: 'traveled next next bypassed future future',
    current: 'future future future bypassed future future',
    available: 'future future future bypassed future future',
    bypassed: 'bypassed bypassed bypassed bypassed bypassed bypassed',
    locked: 'future future future bypassed future future',
    unknown: 'future future future bypassed future future',
  }

  it.each(Object.entries(LINE_STATES))('styles every line out of %s', (from, expected) => {
    expect(TO.map((to) => adventureRouteEdgeState(from as never, to as never)).join(' ')).toBe(expected)
  })
})

describe('adventureRouteGraph', () => {
  it('joins every node to every node of the next tier', () => {
    const rows = adventureRouteGraph(route(
      ['completed'],
      ['completed', 'bypassed'],
      ['available', 'available'],
      ['locked'],
      ['locked'],
    ))

    expect(rows.map((row) => row.tierIndex)).toEqual([0, 1, 2, 3, 4])
    expect(rows.map((row) => row.nodes.map((node) => node.x))).toEqual([[50], [25, 75], [25, 75], [50], [50]])
    expect(rows.map((row) => row.incoming.length)).toEqual([1, 2, 4, 2, 1])
    expect(rows[2].incoming.map((line) => [line.fromNodeId, line.toNodeId, line.fromX, line.toX, line.state])).toEqual([
      ['tier-2-left', 'tier-3-left', 25, 25, 'next'],
      ['tier-2-left', 'tier-3-right', 25, 75, 'next'],
      ['tier-2-right', 'tier-3-left', 75, 25, 'bypassed'],
      ['tier-2-right', 'tier-3-right', 75, 75, 'bypassed'],
    ])
    expect(stems(rows)).toEqual([['traveled'], ['next', 'bypassed'], ['future', 'future'], ['future'], [null]])
  })

  it('starts tier 1 at the start dot and leaves no stem on the last tier or before an empty tier', () => {
    const rows = adventureRouteGraph(route(['available', 'available'], ['locked'], [], ['locked']))

    expect(rows[0].incoming).toEqual([
      { fromNodeId: null, toNodeId: 'tier-1-left', fromX: 50, toX: 25, state: 'next' },
      { fromNodeId: null, toNodeId: 'tier-1-right', fromX: 50, toX: 75, state: 'next' },
    ])
    expect(rows.map((row) => row.incoming.length)).toEqual([2, 2, 0, 0])
    expect(stems(rows)).toEqual([['future', 'future'], [null], [], [null]])
  })

  it('draws nothing for an empty route', () => {
    const rows = adventureRouteGraph([])

    expect(rows).toEqual([])
    expect(Object.isFrozen(rows)).toBe(true)
  })

  // Fork tiers (1-based) and the number of lines entering each tier.
  const FORK_ROUTES = [
    ['1,3,5', [2, 2, 2, 2, 2, 2, 1]],
    ['1,3,6', [2, 2, 2, 2, 1, 2, 2]],
    ['1,4,6', [2, 2, 1, 2, 2, 2, 2]],
    ['2,4,6', [1, 2, 2, 2, 2, 2, 2]],
  ] as const

  it('covers every fork pattern', () => {
    expect(ADVENTURE_FORK_PATTERNS.map((pattern) => pattern.map((tierIndex) => tierIndex + 1).join(',')))
      .toEqual(FORK_ROUTES.map(([forks]) => forks))
  })

  it.each(FORK_ROUTES)('lays out a new run with forks at tiers %s', (forks, lineCounts) => {
    const pattern = forks.split(',').map((tier) => Number(tier) - 1)
    const rows = adventureRouteGraph(projectedTiers(createAdventureRun(seedForForkPattern(pattern), RUN_ID)))

    expect(rows.map((row) => row.nodes.map((node) => node.x)))
      .toEqual(rows.map((_, tierIndex) => (pattern.includes(tierIndex) ? [25, 75] : [50])))
    expect(rows.map((row) => row.incoming.length)).toEqual(lineCounts)
    expect(rows[0].incoming.every((line) => line.fromNodeId === null && line.state === 'next')).toBe(true)
    expect(new Set(rows.slice(1).flatMap((row) => row.incoming.map((line) => line.state)))).toEqual(new Set(['future']))
    expect(stems(rows)).toEqual(rows.map((row) => row.nodes.map(() => (row.tierIndex === 6 ? null : 'future'))))
  })

  describe('for a seeded run with forks at tiers 2, 4 and 6', () => {
    const seed = seedForForkPattern([1, 3, 5])
    const atFork = won(createAdventureRun(seed, RUN_ID), 'tier-1-center')

    it('shows the route taken, the next step at an open fork, and the route ahead', () => {
      const rows = adventureRouteGraph(projectedTiers(atFork))

      expect(lines(rows)).toEqual([
        ['start>tier-1-center traveled'],
        ['tier-1-center>tier-2-left next', 'tier-1-center>tier-2-right next'],
        ['tier-2-left>tier-3-center future', 'tier-2-right>tier-3-center future'],
        ['tier-3-center>tier-4-left future', 'tier-3-center>tier-4-right future'],
        ['tier-4-left>tier-5-center future', 'tier-4-right>tier-5-center future'],
        ['tier-5-center>tier-6-left future', 'tier-5-center>tier-6-right future'],
        ['tier-6-left>tier-7-center future', 'tier-6-right>tier-7-center future'],
      ])
      expect(stems(rows)).toEqual([['next'], ['future', 'future'], ['future'], ['future', 'future'], ['future'], ['future', 'future'], [null]])
    })

    it('marks the branch not taken once a fork is committed, and keeps it on a retry', () => {
      const committed = started(atFork, 'tier-2-right')
      const retry = applyAdventureEncounterResult(committed, 'loss')
      const committedRows = adventureRouteGraph(projectedTiers(committed))
      const retryRows = adventureRouteGraph(projectedTiers(retry))

      expect(lines(committedRows).slice(1, 3)).toEqual([
        ['tier-1-center>tier-2-left bypassed', 'tier-1-center>tier-2-right next'],
        ['tier-2-left>tier-3-center bypassed', 'tier-2-right>tier-3-center future'],
      ])
      expect(stems(committedRows).slice(0, 3)).toEqual([['next'], ['bypassed', 'future'], ['future']])
      expect(retry).toMatchObject({ status: 'active', stage: 'map', attemptOrdinal: 1, selectedNodeId: 'tier-2-right' })
      expect(retryRows).not.toBe(committedRows)
      expect(retryRows).toEqual(committedRows)
    })

    it('traces a completed run along the chosen nodes', () => {
      let run = atFork
      for (const nodeId of ['tier-2-left', 'tier-3-center', 'tier-4-right', 'tier-5-center', 'tier-6-left', 'tier-7-center']) {
        run = won(run, nodeId)
      }
      expect(run.status).toBe('completed')
      const rows = adventureRouteGraph(projectedTiers(run))

      expect(lines(rows)).toEqual([
        ['start>tier-1-center traveled'],
        ['tier-1-center>tier-2-left traveled', 'tier-1-center>tier-2-right bypassed'],
        ['tier-2-left>tier-3-center traveled', 'tier-2-right>tier-3-center bypassed'],
        ['tier-3-center>tier-4-left bypassed', 'tier-3-center>tier-4-right traveled'],
        ['tier-4-left>tier-5-center bypassed', 'tier-4-right>tier-5-center traveled'],
        ['tier-5-center>tier-6-left traveled', 'tier-5-center>tier-6-right bypassed'],
        ['tier-6-left>tier-7-center traveled', 'tier-6-right>tier-7-center bypassed'],
      ])
      expect(stems(rows)).toEqual([
        ['traveled'],
        ['traveled', 'bypassed'],
        ['traveled'],
        ['bypassed', 'traveled'],
        ['traveled'],
        ['traveled', 'bypassed'],
        [null],
      ])
    })

    it('offers no next step on a failed run', () => {
      let run = atFork
      for (let loss = 0; loss < 3; loss += 1) {
        run = applyAdventureEncounterResult(started(run, 'tier-2-right'), 'loss')
      }
      expect(run.status).toBe('failed')
      const rows = adventureRouteGraph(projectedTiers(run))

      expect(lines(rows)[0]).toEqual(['start>tier-1-center traveled'])
      expect(new Set(rows.slice(1).flatMap((row) => row.incoming.map((line) => line.state)))).toEqual(new Set(['future']))
      expect(stems(rows)[0]).toEqual(['future'])
    })

    it('returns a frozen graph, reused for the same tier array', () => {
      const tiers = projectedTiers(atFork)
      const rows = adventureRouteGraph(tiers)

      expect(projectedTiers(atFork)).toBe(tiers)
      expect(adventureRouteGraph(projectedTiers(atFork))).toBe(rows)
      const copied = adventureRouteGraph([...tiers])
      expect(copied).not.toBe(rows)
      expect(copied).toEqual(rows)
      for (const value of [rows, ...rows, ...rows.flatMap((row) => [row.nodes, row.incoming, ...row.nodes, ...row.incoming])]) {
        expect(Object.isFrozen(value)).toBe(true)
      }
    })
  })
})

describe('adventure route graph module boundary', () => {
  const source = readFileSync(resolve(__dirname, '..', 'app', 'adventure-route-graph.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('has only type imports, from the map rules and the app types', () => {
    const specifiers = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
    const imports = [...code.matchAll(/\bimport\b[^;'"]*['"]/g)].map((match) => match[0])

    expect(new Set(specifiers)).toEqual(new Set(['./adventure-map', './types']))
    expect(imports).toHaveLength(2)
    for (const statement of imports) {
      expect(statement).toMatch(/^import type\s/)
    }
  })

  it('reads no randomness, clock, storage or DOM', () => {
    for (const forbidden of [
      /\bMath\.random\b/,
      /\bDate\b/,
      /\bperformance\b/,
      /\bcrypto\b/,
      /\blocalStorage\b/,
      /\bdocument\b/,
      /\bwindow\b/,
    ]) {
      expect(code).not.toMatch(forbidden)
    }
  })
})
