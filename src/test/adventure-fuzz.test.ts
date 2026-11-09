import { describe, expect, it } from 'vitest'
import {
  ADVENTURE_GAME_STORAGE_KEY,
  ADVENTURE_HIGH_SCORE_STORAGE_KEY,
  computeAdventureScore,
  isAdventureRunState,
  normalizeAdventureRun,
  type AdventureRunState,
} from '../app/adventure'
import { ADVENTURE_RUN_STORAGE_KEY, readStoredAdventureRun } from '../app/adventure-persistence'
import { ADVENTURE_REWARD_IDS, adventureRewardOfferId } from '../app/adventure-rewards'
import { AppController } from '../app/controller'
import { actionableAdventureNodes } from '../app/lobby-presentation'
import { lcg } from '../game/cards'
import { BASIC_LANDS, type GameState } from '../game/types'
import {
  ACCEPTED_RUN_VARIANTS,
  FIXTURE_RUN_ID,
  MALFORMED_BASE_NAMES,
  MALFORMED_RUN_CASES,
  adventureEnvelopeFor,
  launchedAdventureGame,
  malformedBase,
  malformedRun,
  playedAdventureGame,
  type MalformedBaseName,
} from './fixtures/adventure-malformed-v2'
import { installFakeTimerHooks } from './helpers/timers'
import { installTrackedStorage, type TrackedStorage } from './helpers/tracked-storage'

// Malformed schema version 2 saves at the storage boundary. Curated cases
// break one rule each; the seeded fuzzers then edit valid runs and mid-game
// saves at random. Reading must never throw or write, and the controller
// must either refuse a save or play it through its next transitions.

const RUN_KEY = ADVENTURE_RUN_STORAGE_KEY
const GAME_KEY = ADVENTURE_GAME_STORAGE_KEY
const HIGH_SCORE_KEY = ADVENTURE_HIGH_SCORE_STORAGE_KEY
const OTHER_RUN_ID = 'fedcba9876543210fedcba9876543210'
const NO_PAUSED_RUN = 'No paused adventure run found.'
const RUN_FUZZ_SEED = 0x5eed_0006
const RUN_FUZZ_CASES = 2000
const ENVELOPE_FUZZ_SEED = 0x5eed_0007
const ENVELOPE_FUZZ_CASES = 400

/** Structural equality for JSON-shaped values, so problems can be collected instead of thrown. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key)
      && sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  )
}

// The mid-game base holds Guardian Sigil, so the restart also keeps its charge.
function recoveryMessage(tier: number): string {
  return `Adventure resumed at Tier ${tier}. The saved game could not be restored, so the encounter restarts without using a chance or a relic charge.`
}

/** Writes and removals of the Adventure run and mid-game keys. */
function adventureCalls(storage: TrackedStorage): string[] {
  return storage.calls.filter((call) => call.endsWith(`:${RUN_KEY}`) || call.endsWith(`:${GAME_KEY}`))
}

interface ControllerInternals {
  state: { game: GameState | null }
  onAdventureGameFinished: (previous: GameState) => void
}

/** Ends the live encounter the way the engine does: game over with a winner. */
function finishEncounter(controller: AppController, winner: 0 | 1 | 'draw'): void {
  const internals = controller as unknown as ControllerInternals
  const game = internals.state.game
  if (!game) throw new Error('Expected a live Adventure game.')
  const previous = structuredClone(game)
  game.winner = winner
  game.phase = 'gameOver'
  internals.onAdventureGameFinished(previous)
}

/**
 * Loads a stored run that the reader accepted and plays its next steps:
 * Resume, the first offered reward, the first actionable node and a result.
 * Returns what went wrong; a throw is reported too.
 */
function playStoredRun(raw: string, run: AdventureRunState, winner: 0 | 1 | 'draw'): string[] {
  const problems: string[] = []
  try {
    const storage = installTrackedStorage({ [RUN_KEY]: raw })
    const controller = new AppController()
    let view = controller.getViewModel()
    const finished = run.status === 'completed' || run.status === 'failed'
    if (!finished && !view.adventure.hasSavedRun) problems.push('the lobby shows no saved run')
    if (storage.calls.length > 0) problems.push(`loading wrote ${storage.calls.join(', ')}`)
    controller.resumeAdventure()
    view = controller.getViewModel()
    if (finished) {
      if (view.mode !== null || view.status !== NO_PAUSED_RUN) problems.push(`a finished run resumed: ${view.status}`)
      return problems
    }
    if (view.mode !== 'adventure-hvai') problems.push(`Resume left mode ${String(view.mode)}: ${view.status}`)
    const projection = JSON.stringify(view.adventure)
    if (projection.includes('"deck"') || projection.includes('"type":"land"')) problems.push('the hub projects opponent cards')
    if (view.adventure.stage === 'reward') {
      const offer = view.adventure.pendingReward
      if (!offer) return [...problems, 'the reward stage shows no offer']
      controller.chooseAdventureReward(offer.offerId, offer.choices[0].id)
      view = controller.getViewModel()
      if (view.adventure.stage !== 'map') problems.push(`choosing a reward left stage ${String(view.adventure.stage)}: ${view.status}`)
    }
    const node = actionableAdventureNodes(view.adventure)[0]
    if (!node) return [...problems, `the map offers no encounter: ${view.status}`]
    controller.startAdventureNode(node.id)
    view = controller.getViewModel()
    if (view.adventure.stage !== 'encounter' || view.game === null) {
      return [...problems, `the encounter did not start: ${view.status}`]
    }
    finishEncounter(controller, winner)
    view = controller.getViewModel()
    if (view.adventure.pendingCompletion !== null || view.game !== null) problems.push(`the result was not saved: ${view.status}`)
    if (!Number.isFinite(view.adventure.highScore)) problems.push(`the high score is ${view.adventure.highScore}`)
    const stored = storage.data.get(RUN_KEY)
    if (view.adventure.hasSavedRun) {
      if (stored === undefined || readStoredAdventureRun() === null) problems.push('the result left no readable run')
    } else if (stored !== undefined || !/^\d+$/.test(storage.data.get(HIGH_SCORE_KEY) ?? '')) {
      problems.push('the finished run was not cleared with a high score')
    }
  } catch (error) {
    problems.push(`threw ${String(error)}`)
  }
  return problems
}

describe('malformed schema version 2 run fixtures', () => {
  installFakeTimerHooks()

  it.each(MALFORMED_BASE_NAMES)('the %s base is a valid run that the controller plays on', (name) => {
    const run = malformedBase(name)
    const raw = JSON.stringify(run)

    expect(isAdventureRunState(run)).toBe(true)
    installTrackedStorage({ [RUN_KEY]: raw })
    expect(readStoredAdventureRun()).toEqual(run)
    expect(playStoredRun(raw, run, 0)).toEqual([])
  })

  it('covers every category with distinct labels', () => {
    const labels = MALFORMED_RUN_CASES.map((entry) => entry.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(new Set(MALFORMED_RUN_CASES.map((entry) => entry.category))).toEqual(
      new Set(['map', 'offer', 'relic', 'history', 'attempt', 'counter']),
    )
  })

  it.each(MALFORMED_RUN_CASES.map((entry) => [entry.category, entry.label, entry] as const))(
    'rejects %s: %s, without writing',
    (_category, _label, entry) => {
      const raw = JSON.stringify(malformedRun(entry))
      expect(isAdventureRunState(JSON.parse(raw))).toBe(false)

      const storage = installTrackedStorage({ [RUN_KEY]: raw })
      expect(readStoredAdventureRun()).toBeNull()
      const controller = new AppController()
      expect(controller.getViewModel().adventure.hasSavedRun).toBe(false)
      controller.resumeAdventure()

      const view = controller.getViewModel()
      expect(view.status).toBe(NO_PAUSED_RUN)
      expect(view.mode).toBeNull()
      expect(view.adventure.runId).toBeNull()
      expect(storage.calls).toEqual([])
      expect(storage.data.get(RUN_KEY)).toBe(raw)
    },
  )

  it.each(ACCEPTED_RUN_VARIANTS.map((entry) => [entry.label, entry] as const))('accepts %s', (_label, entry) => {
    const run = malformedRun(entry)
    const raw = JSON.stringify(run)
    const storage = installTrackedStorage({ [RUN_KEY]: raw })

    expect(readStoredAdventureRun()).toEqual(entry.reads === 'base' ? malformedBase(entry.base) : run)
    expect(storage.calls).toEqual([])
    expect(playStoredRun(raw, run, 1)).toEqual([])
  })
})

type Container = Record<string, unknown> | unknown[]
type Key = string | number

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null
}

function keysOf(value: Container): Key[] {
  return Array.isArray(value) ? value.map((_entry, index) => index) : Object.keys(value)
}

function getAt(container: Container, key: Key): unknown {
  return (container as Record<Key, unknown>)[key]
}

function setAt(container: Container, key: Key, value: unknown): void {
  ;(container as Record<Key, unknown>)[key] = value
}

function removeAt(container: Container, key: Key): void {
  if (Array.isArray(container)) {
    container.splice(Number(key), 1)
  } else {
    delete container[key]
  }
}

function valueAtPath(root: unknown, path: readonly Key[]): { found: boolean; value: unknown } {
  let value = root
  for (const key of path) {
    if (!isContainer(value) || !(key in value)) return { found: false, value: undefined }
    value = getAt(value, key)
  }
  return { found: true, value }
}

function describeValue(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 40 ? `${text.slice(0, 37)}...` : text
}

/** Values a hand-edited save could hold: valid ones in the wrong place, near misses and junk. */
function fuzzVocabulary(): readonly unknown[] {
  const map = malformedBase('map').map
  const nodeIds = map.tiers.flatMap((tier) => tier.nodes.map((node) => node.id))
  return [
    0, 1, 2, 3, 5, 6, 7, 8, 9, -1, 0.5, 1.5, 2 ** 32, 2 ** 53 - 1, 2 ** 53, 1e308, -1e308,
    '', 'x', '0', '2',
    ...nodeIds, 'tier-0-center', 'tier-8-center', 'tier-2-middle',
    ...ADVENTURE_REWARD_IDS, 'lucky-coin', 'Second-Wind',
    adventureRewardOfferId(nodeIds[0], 0), adventureRewardOfferId(nodeIds[2], 1),
    'active', 'paused', 'completed', 'failed', 'won',
    'map', 'reward', 'encounter', 'shop',
    'linear', 'legacy-linear', 'branching', 'spiral',
    'standard', 'dual', 'mono', 'random',
    'center', 'left', 'right', 'middle',
    ...BASIC_LANDS, 'Wastes', 'land',
    FIXTURE_RUN_ID, OTHER_RUN_ID,
    null, true, false, {}, [],
    { id: 'guardian-sigil', charges: 1 },
    { id: 'streak-anchor', charges: 2 },
    { id: 'scout-cache', charges: 1 },
    { id: 'prepared-pack' },
    { id: 'gravebloom-charm' },
    { id: 'memory-charm' },
    { sourceNodeId: nodeIds[0], rewardId: null },
    { sourceNodeId: nodeIds[1], rewardId: 'second-wind' },
    { sourceNodeId: nodeIds[3], rewardId: 'echo-charm' },
    { playerOpeningHandSize: 6, guaranteedCreatures: ['Forest'] },
    { playerOpeningHandSize: 8, guaranteedCreatures: [] },
    { id: 'fuzz-card', name: 'Forest', type: 'land' },
    [{ id: 'prepared-pack' }],
    ['Forest', 'Island'],
  ]
}

const FUZZ_OPS = ['delete', 'replace', 'nudge', 'duplicate', 'swap', 'truncate', 'clear', 'splice'] as const
const DESCEND_PROBABILITY = 0.6

interface FuzzContext {
  random: () => number
  vocabulary: readonly unknown[]
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]
}

function nudged(random: () => number, value: unknown): unknown {
  if (typeof value === 'number') {
    return pick(random, [value + 1, value - 1, value * 2, -value, value + 0.5, value + 2 ** 32, 1e308])
  }
  if (typeof value === 'string') {
    return pick(random, [
      `${value}x`,
      value.toUpperCase(),
      '',
      value.slice(1),
      value.replace(/\d/, (digit) => String((Number(digit) + 1) % 10)),
    ])
  }
  if (typeof value === 'boolean') return !value
  return 0
}

/** Applies one random edit somewhere inside `root` and describes it. */
function mutateOnce(context: FuzzContext, root: Container): string {
  const { random } = context
  let parent = root
  const path: Key[] = []
  for (;;) {
    const keys = keysOf(parent)
    const key = pick(random, keys)
    const child = getAt(parent, key)
    path.push(key)
    if (isContainer(child) && keysOf(child).length > 0 && random() < DESCEND_PROBABILITY) {
      parent = child
      continue
    }
    break
  }
  const key = path[path.length - 1]
  const value = getAt(parent, key)
  const where = path.join('.')
  const op = pick(random, FUZZ_OPS)
  switch (op) {
    case 'delete':
      removeAt(parent, key)
      return `delete ${where}`
    case 'nudge':
      if (!isContainer(value)) {
        const next = nudged(random, value)
        setAt(parent, key, next)
        return `nudge ${where} to ${describeValue(next)}`
      }
      break
    case 'duplicate':
      if (Array.isArray(parent)) {
        parent.splice(Number(key) + 1, 0, structuredClone(value))
        return `duplicate ${where}`
      }
      break
    case 'swap': {
      const others = keysOf(parent).filter((other) => other !== key)
      if (others.length > 0) {
        const other = pick(random, others)
        const otherValue = getAt(parent, other)
        setAt(parent, other, value)
        setAt(parent, key, otherValue)
        return `swap ${where} with ${String(other)}`
      }
      break
    }
    case 'truncate':
      if (Array.isArray(value) && value.length > 0) {
        value.length = Math.floor(random() * value.length)
        return `truncate ${where} to ${value.length}`
      }
      if (typeof value === 'string' && value.length > 0) {
        setAt(parent, key, value.slice(0, Math.floor(random() * value.length)))
        return `truncate ${where}`
      }
      break
    case 'clear':
      setAt(parent, key, Array.isArray(value) ? [] : isContainer(value) ? {} : null)
      return `clear ${where}`
    case 'splice': {
      const donor = pick(random, MALFORMED_BASE_NAMES)
      const found = valueAtPath(malformedBase(donor), path)
      if (found.found) {
        setAt(parent, key, structuredClone(found.value))
        return `splice ${where} from ${donor}`
      }
      break
    }
    default:
      break
  }
  const replacement = structuredClone(pick(random, context.vocabulary))
  setAt(parent, key, replacement)
  return `replace ${where} with ${describeValue(replacement)}`
}

describe('fuzzed schema version 2 runs', () => {
  installFakeTimerHooks()

  it(`reads ${RUN_FUZZ_CASES} edited runs without throwing or writing, and plays every accepted one`, () => {
    const context: FuzzContext = { random: lcg(RUN_FUZZ_SEED), vocabulary: fuzzVocabulary() }
    const { random } = context
    const problems: string[] = []
    const acceptedStages = new Set<string>()
    let accepted = 0
    for (let index = 0; index < RUN_FUZZ_CASES; index += 1) {
      const baseName: MalformedBaseName = pick(random, MALFORMED_BASE_NAMES)
      const edited = structuredClone(malformedBase(baseName)) as unknown as Container
      const roll = random()
      const editCount = roll < 0.6 ? 1 : roll < 0.9 ? 2 : 3
      const edits = Array.from({ length: editCount }, () => mutateOnce(context, edited))
      const winner = pick(random, [0, 1, 'draw'] as const)
      const label = `case ${index} from ${baseName} (${edits.join('; ')})`
      const raw = JSON.stringify(edited)

      const storage = installTrackedStorage({ [RUN_KEY]: raw })
      let run: AdventureRunState | null
      try {
        run = readStoredAdventureRun()
      } catch (error) {
        problems.push(`${label}: reading threw ${String(error)}`)
        continue
      }
      if (storage.calls.length > 0 || storage.data.get(RUN_KEY) !== raw) problems.push(`${label}: reading changed storage`)
      if (run === null) continue

      accepted += 1
      acceptedStages.add(run.stage ?? run.status)
      if (!isAdventureRunState(run)) problems.push(`${label}: the read run fails the guard`)
      if (!sameValue(normalizeAdventureRun(JSON.parse(JSON.stringify(run))), run)) {
        problems.push(`${label}: the read run does not survive a round trip`)
      }
      if (!Number.isFinite(computeAdventureScore(run))) problems.push(`${label}: the score is ${computeAdventureScore(run)}`)
      problems.push(...playStoredRun(raw, run, winner).map((problem) => `${label}: ${problem}`))
    }

    expect(problems).toEqual([])
    // The strict guard rejects most edits; enough survive to play every stage.
    expect(accepted).toBeGreaterThan(RUN_FUZZ_CASES * 0.05)
    expect(RUN_FUZZ_CASES - accepted).toBeGreaterThan(RUN_FUZZ_CASES * 0.5)
    expect(acceptedStages).toEqual(new Set(['map', 'reward', 'encounter', 'completed', 'failed']))
  })
})

const DELETED = Symbol('deleted')
const IDENTITY_FIELDS = ['schemaVersion', 'runId', 'nodeId', 'attemptOrdinal', 'attemptSeed'] as const

describe('fuzzed mid-game saves', () => {
  installFakeTimerHooks()

  it(`restores ${ENVELOPE_FUZZ_CASES} edited saves only when their identity matches and the game can continue`, () => {
    const run = malformedBase('pausedEncounter')
    const tier = run.currentTierIndex + 1
    const nodeId = run.selectedNodeId
    const seed = run.attemptSeed
    if (nodeId === null || seed === null) throw new Error('Expected a committed attempt.')
    expect(run.relics.map((relic) => relic.id)).toEqual(['guardian-sigil'])
    const runRaw = JSON.stringify(run)
    const played = playedAdventureGame(run)
    const oversized = structuredClone(played)
    oversized.players[0].hand.push({ id: 'extra-card', name: 'Forest', type: 'land' })
    const games = [
      { label: 'the played game', value: played, restorable: true },
      { label: 'a new game', value: launchedAdventureGame(run), restorable: true },
      { label: 'a finished game', value: { ...played, phase: 'gameOver', winner: 1 }, restorable: false },
      { label: 'a game with a 51st card', value: oversized, restorable: false },
      { label: 'null', value: null, restorable: false },
      { label: 'an empty object', value: {}, restorable: false },
      { label: 'text', value: 'game', restorable: false },
    ] as const
    const wrongValues: Record<(typeof IDENTITY_FIELDS)[number], readonly unknown[]> = {
      schemaVersion: [1, 3, '2', null, DELETED],
      runId: [OTHER_RUN_ID, run.runId.toUpperCase(), '', null, DELETED],
      nodeId: [run.completedNodeIds[0], run.map.tiers[run.currentTierIndex + 1].nodes[0].id, 'tier-8-center', null, DELETED],
      attemptOrdinal: [run.attemptOrdinal + 1, -1, 0.5, String(run.attemptOrdinal), 2 ** 53, DELETED],
      attemptSeed: [seed + 1, seed + 2 ** 32, String(seed), null, -1, DELETED],
    }
    const random = lcg(ENVELOPE_FUZZ_SEED)
    const problems: string[] = []
    let restored = 0
    for (let index = 0; index < ENVELOPE_FUZZ_CASES; index += 1) {
      const envelope = adventureEnvelopeFor(run, null)
      const edits: string[] = []
      for (const field of IDENTITY_FIELDS) {
        if (random() < 0.25) {
          const wrong = pick(random, wrongValues[field])
          if (wrong === DELETED) {
            delete envelope[field]
          } else {
            envelope[field] = wrong
          }
          edits.push(`${field}=${wrong === DELETED ? 'deleted' : describeValue(wrong)}`)
        }
      }
      const roll = random()
      const game = roll < 0.6 ? games[0] : roll < 0.7 ? games[1] : pick(random, games.slice(2))
      envelope.game = game.value
      const restorable = edits.length === 0 && game.restorable
      const label = `case ${index} (${[...edits, game.label].join(', ')})`

      const storage = installTrackedStorage({ [RUN_KEY]: runRaw, [GAME_KEY]: JSON.stringify(envelope) })
      try {
        const controller = new AppController()
        controller.resumeAdventure()
        const view = controller.getViewModel()
        const calls = adventureCalls(storage)
        if (restorable) {
          restored += 1
          if (view.adventure.stage !== 'encounter' || view.game?.turn !== (game.value as GameState).turn) {
            problems.push(`${label}: not restored (${view.status})`)
          }
          if (view.status !== `Adventure resumed at Tier ${tier}.`) problems.push(`${label}: status ${view.status}`)
          if (!sameValue(calls, [`set:${RUN_KEY}`, `remove:${GAME_KEY}`])) problems.push(`${label}: wrote ${calls.join(', ')}`)
        } else {
          if (view.adventure.stage !== 'map' || view.game !== null) problems.push(`${label}: restored a stale save`)
          if (view.status !== recoveryMessage(tier)) problems.push(`${label}: status ${view.status}`)
          if (!sameValue(calls, [`remove:${GAME_KEY}`])) problems.push(`${label}: wrote ${calls.join(', ')}`)
        }
      } catch (error) {
        problems.push(`${label}: threw ${String(error)}`)
      }
    }

    expect(problems).toEqual([])
    expect(restored).toBeGreaterThan(ENVELOPE_FUZZ_CASES * 0.1)
    expect(ENVELOPE_FUZZ_CASES - restored).toBeGreaterThan(ENVELOPE_FUZZ_CASES * 0.5)
  })
})
