import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../game/engine'
import { BASIC_LANDS, type BasicLand, type PlayerState } from '../game/types'
import {
  ADVENTURE_TIER_COUNT,
  adventureEncounterLaunch,
  adventureNodeId,
  adventureRouteNodes,
  backfillPreRewardAdventureRun,
  chooseAdventureRunReward,
  cloneAdventureRun,
  computeAdventureScore,
  createAdventureRun,
  deckPairForAdventureGame,
  isAdventureRunState,
  normalizeAdventureRun,
  openAdventureMap,
  pauseAdventureRun,
  resolveAdventureEncounterResult,
  skipAdventureRunReward,
  startAdventureEncounter,
  type AdventureEncounterOutcome,
  type AdventureNodeLane,
  type AdventureRunState,
} from '../app/adventure'
import { ADVENTURE_FORK_PATTERNS, generateBranchingAdventureMap } from '../app/adventure-map'
import {
  ADVENTURE_REWARD_IDS,
  adventureRewardOfferId,
  eligibleAdventureRewardIds,
  generateAdventureRewardOffer,
  type AdventurePassiveRelicId,
  type AdventureRelic,
  type AdventureRewardId,
  type AdventureRewardOffer,
} from '../app/adventure-rewards'
import type { AdventureEncounterSetup } from '../app/adventure-setup'
import { deepFreeze } from './helpers/deep-freeze'

// Run-level reward rules: offers after wins, choosing and skipping, relic
// effects at encounter setup and on losses, the score shadow, and runs saved
// before rewards existed. The reward and setup leaf modules have their own
// tests; these check how `adventure.ts` combines them.

const RUN_ID = '0123456789abcdef0123456789abcdef'
const SEED = 1_770_000_000_000
const DEFAULT_SETUP: AdventureEncounterSetup = { playerOpeningHandSize: 5, guaranteedCreatures: [] }

function newRun(seed = SEED): AdventureRunState {
  return createAdventureRun(seed, RUN_ID)
}

/** Starts the kept node, or else the current tier's first node (left at a fork). */
function started(
  run: AdventureRunState,
  nodeId = run.selectedNodeId ?? run.map.tiers[run.currentTierIndex].nodes[0].id,
): AdventureRunState {
  const next = startAdventureEncounter(run, nodeId)
  if (!next) throw new Error(`Expected ${nodeId} to start.`)
  return next
}

function finished(run: AdventureRunState, outcome: AdventureEncounterOutcome): AdventureRunState {
  return resolveAdventureEncounterResult(run, outcome).run
}

function pending(run: AdventureRunState): AdventureRewardOffer {
  if (!run.pendingReward) throw new Error('Expected a pending reward.')
  return run.pendingReward
}

function skipped(run: AdventureRunState): AdventureRunState {
  const next = skipAdventureRunReward(run, pending(run).offerId)
  if (!next) throw new Error('Expected the reward to be skipped.')
  return next
}

function chosen(run: AdventureRunState, rewardId: AdventureRewardId): AdventureRunState {
  const next = chooseAdventureRunReward(run, pending(run).offerId, rewardId)
  if (!next) throw new Error(`Expected ${rewardId} to be chosen.`)
  return next
}

/** The run with its pending offer showing `rewardId` first, then two other eligible rewards. */
function offering(run: AdventureRunState, rewardId: AdventureRewardId): AdventureRunState {
  const others = eligibleAdventureRewardIds(run).filter((id) => id !== rewardId).slice(0, 2)
  const next: AdventureRunState = { ...cloneAdventureRun(run), pendingReward: { ...pending(run), choices: [rewardId, ...others] } }
  if (!isAdventureRunState(next)) throw new Error(`${rewardId} cannot be offered to this run.`)
  return next
}

/** Takes `rewardId`, whatever the seed offered. */
function claimed(run: AdventureRunState, rewardId: AdventureRewardId): AdventureRunState {
  return chosen(offering(run, rewardId), rewardId)
}

/** Tier 1 won: the first offer waits, with 3 chances and a win streak of 1. */
function firstReward(seed = SEED): AdventureRunState {
  return finished(started(newRun(seed)), 'win')
}

/** Wins every tier on its first node, skipping each reward. */
function bossWon(): AdventureRunState {
  let run = started(newRun())
  while (run.currentTierIndex < ADVENTURE_TIER_COUNT - 1) {
    run = started(skipped(finished(run, 'win')))
  }
  return finished(run, 'win')
}

function without(run: AdventureRunState, ...keys: Array<keyof AdventureRunState>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...run }
  for (const key of keys) delete copy[key]
  return copy
}

function cardIds(player: PlayerState): string[] {
  return [...player.hand, ...player.deck].map((card) => card.id).sort()
}

/** The game the run's committed attempt deals, checked against its setup. */
function launchedGame(run: AdventureRunState) {
  const setup = run.encounterSetup
  if (!setup) throw new Error('Expected an encounter setup.')
  const launch = adventureEncounterLaunch(run)
  const game = createInitialGame(launch.seed, launch.decks, launch.options)
  const [player, opponent] = game.players
  expect(launch.options.openingHandSizes).toEqual([setup.playerOpeningHandSize, 5])
  expect(player.hand).toHaveLength(setup.playerOpeningHandSize)
  expect(opponent.hand).toHaveLength(5)
  for (const land of setup.guaranteedCreatures) {
    expect(player.hand.map((card) => card.name)).toContain(land)
  }
  expect(new Set(cardIds(player)).size).toBe(50)
  return game
}

function forkTierIndexes(seed: number): number[] {
  return generateBranchingAdventureMap(seed).tiers.flatMap((tier, index) => (tier.nodes.length === 2 ? [index] : []))
}

function seedForForkPattern(pattern: readonly number[]): number {
  for (let seed = SEED; seed < SEED + 1_000; seed += 1) {
    if (forkTierIndexes(seed).join(',') === pattern.join(',')) return seed
  }
  throw new Error(`No seed found for fork pattern ${pattern.join(',')}.`)
}

const PRE_REWARD_SCENARIOS = [
  'mapNewRun',
  'encounterClosedMidGame',
  'encounterPausedMidGame',
  'mapRetryAfterLoss',
  'mapPausedRetryAfterDraw',
  'mapPausedAfterWin',
] as const
type PreRewardScenario = (typeof PRE_REWARD_SCENARIOS)[number]

function readPreRewardFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'adventure-v2-pre-reward-saves.json'), 'utf8')) as Record<
    string,
    unknown
  >
}

/** The run exactly as the Milestone 4 controller saved it. */
function preRewardRun(name: PreRewardScenario): Record<string, unknown> {
  const scenario = readPreRewardFixture()[name] as Record<string, string>
  return JSON.parse(scenario['cardgame.adventure-run']) as Record<string, unknown>
}

function backfilledRun(name: PreRewardScenario): AdventureRunState {
  const run = normalizeAdventureRun(backfillPreRewardAdventureRun(preRewardRun(name)))
  if (!run) throw new Error(`Expected the ${name} save to load.`)
  return run
}

interface LossSummary {
  remainingChances: number
  winStreak: number
  relics: AdventureRelic[]
  chanceLossPrevented: boolean
  streakResetPrevented: boolean
}

interface RewardEffectCase {
  id: AdventureRewardId
  /** Chances right after choosing, from 3. */
  chances: number
  /** Relics right after choosing. */
  chosenRelics: AdventureRelic[]
  /** Relics once the next encounter starts. */
  startRelics: AdventureRelic[]
  setup: AdventureEncounterSetup
  /** That encounter lost, from a win streak of 1. */
  loss: LossSummary
}

const SKIPPED_LOSS: LossSummary = {
  remainingChances: 2,
  winStreak: 0,
  relics: [],
  chanceLossPrevented: false,
  streakResetPrevented: false,
}

function charmCase(id: AdventurePassiveRelicId, land: BasicLand): RewardEffectCase {
  const relics: AdventureRelic[] = [{ id }]
  return {
    id,
    chances: 3,
    chosenRelics: relics,
    startRelics: relics,
    setup: { playerOpeningHandSize: 5, guaranteedCreatures: [land] },
    loss: { ...SKIPPED_LOSS, relics },
  }
}

const REWARD_EFFECTS: readonly RewardEffectCase[] = [
  {
    id: 'second-wind',
    chances: 4,
    chosenRelics: [],
    startRelics: [],
    setup: DEFAULT_SETUP,
    loss: { ...SKIPPED_LOSS, remainingChances: 3 },
  },
  {
    id: 'guardian-sigil',
    chances: 3,
    chosenRelics: [{ id: 'guardian-sigil', charges: 1 }],
    startRelics: [{ id: 'guardian-sigil', charges: 1 }],
    setup: DEFAULT_SETUP,
    loss: { ...SKIPPED_LOSS, remainingChances: 3, chanceLossPrevented: true },
  },
  {
    id: 'streak-anchor',
    chances: 3,
    chosenRelics: [{ id: 'streak-anchor', charges: 1 }],
    startRelics: [{ id: 'streak-anchor', charges: 1 }],
    setup: DEFAULT_SETUP,
    loss: { ...SKIPPED_LOSS, winStreak: 1, streakResetPrevented: true },
  },
  {
    id: 'prepared-pack',
    chances: 3,
    chosenRelics: [{ id: 'prepared-pack' }],
    startRelics: [{ id: 'prepared-pack' }],
    setup: { playerOpeningHandSize: 6, guaranteedCreatures: [] },
    loss: { ...SKIPPED_LOSS, relics: [{ id: 'prepared-pack' }] },
  },
  // Its only charge is used as the next encounter starts.
  {
    id: 'scout-cache',
    chances: 3,
    chosenRelics: [{ id: 'scout-cache', charges: 1 }],
    startRelics: [],
    setup: { playerOpeningHandSize: 7, guaranteedCreatures: [] },
    loss: SKIPPED_LOSS,
  },
  charmCase('gravebloom-charm', 'Forest'),
  charmCase('signal-charm', 'Island'),
  charmCase('rooftop-charm', 'Mountain'),
  charmCase('echo-charm', 'Plains'),
  charmCase('memory-charm', 'Swamp'),
]

function lossSummary(result: ReturnType<typeof resolveAdventureEncounterResult>): LossSummary {
  return {
    remainingChances: result.run.remainingChances,
    winStreak: result.run.winStreak,
    relics: result.run.relics,
    chanceLossPrevented: result.chanceLossPrevented,
    streakResetPrevented: result.streakResetPrevented,
  }
}

function withoutRewardFields(run: AdventureRunState): Record<string, unknown> {
  return without(run, 'remainingChances', 'relics', 'rewardHistory')
}

describe('Adventure reward effects', () => {
  it('covers every reward in catalog order', () => {
    expect(REWARD_EFFECTS.map((effect) => effect.id)).toEqual([...ADVENTURE_REWARD_IDS])
  })

  it.each(REWARD_EFFECTS)('$id changes only what its rules text says, compared with skipping the same offer', (effect) => {
    const waiting = deepFreeze(offering(firstReward(), effect.id))
    const source = pending(waiting).sourceNodeId
    const taken = chosen(waiting, effect.id)
    const passed = skipped(waiting)

    expect(taken.remainingChances).toBe(effect.chances)
    expect(taken.relics).toEqual(effect.chosenRelics)
    expect(taken.rewardHistory).toEqual([{ sourceNodeId: source, rewardId: effect.id }])
    expect(passed.rewardHistory).toEqual([{ sourceNodeId: source, rewardId: null }])
    expect(passed).toMatchObject({ remainingChances: 3, relics: [], stage: 'map', status: 'active', pendingReward: null })
    // Nothing else differs, and a reward never adds a score-eligible chance.
    expect(withoutRewardFields(taken)).toEqual(withoutRewardFields(passed))
    expect(taken.scoreEligibleChances).toBe(3)

    const takenStart = started(taken)
    const passedStart = started(passed)
    expect(takenStart.encounterSetup).toEqual(effect.setup)
    expect(takenStart.relics).toEqual(effect.startRelics)
    expect(passedStart.encounterSetup).toEqual(DEFAULT_SETUP)
    expect(takenStart.attemptSeed).toBe(passedStart.attemptSeed)

    // Relics arrange the player's own 50 cards; the opponent's deal is unchanged.
    const game = launchedGame(takenStart)
    const plain = launchedGame(passedStart)
    expect(cardIds(game.players[0])).toEqual(cardIds(plain.players[0]))
    expect(game.players[1]).toEqual(plain.players[1])

    const takenLoss = resolveAdventureEncounterResult(takenStart, 'loss')
    const passedLoss = resolveAdventureEncounterResult(passedStart, 'loss')
    expect(lossSummary(takenLoss)).toEqual(effect.loss)
    expect(lossSummary(passedLoss)).toEqual(SKIPPED_LOSS)
    // Relics never protect the score.
    expect(takenLoss.run.scoreEligibleChances).toBe(passedLoss.run.scoreEligibleChances)
    expect(takenLoss.run.scoreEligibleWinStreak).toBe(passedLoss.run.scoreEligibleWinStreak)
    expect(computeAdventureScore(takenLoss.run)).toBe(computeAdventureScore(passedLoss.run))

    // Wins and draws use no charge.
    for (const outcome of ['win', 'draw'] as const) {
      const result = resolveAdventureEncounterResult(takenStart, outcome)
      expect(result.run.relics, outcome).toEqual(effect.startRelics)
      expect([result.chanceLossPrevented, result.streakResetPrevented], outcome).toEqual([false, false])
    }
  })

  it('guarantees a charm creature that the default deal leaves out', () => {
    const hand = launchedGame(started(skipped(firstReward()))).players[0].hand.map((card) => card.name)
    const charmLands = REWARD_EFFECTS.flatMap((effect) => effect.setup.guaranteedCreatures)

    expect(charmLands).toEqual([...BASIC_LANDS])
    expect(charmLands.filter((land) => !hand.includes(land))).not.toEqual([])
  })
})

describe('Adventure reward offers', () => {
  it('offers one reward after a non-boss win, the same way every time', () => {
    const encounter = deepFreeze(started(newRun()))
    const nodeId = encounter.selectedNodeId as string
    const result = resolveAdventureEncounterResult(encounter, 'win')

    expect(result.run).toMatchObject({
      status: 'active',
      stage: 'reward',
      currentTierIndex: 1,
      completedNodeIds: [nodeId],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
      encounterSetup: null,
      totalRoundsPlayed: 1,
      winStreak: 1,
    })
    expect(result.run.pendingReward).toEqual(generateAdventureRewardOffer(SEED, nodeId, { relics: [], rewardHistory: [] }))
    expect(result.run.pendingReward).toMatchObject({ offerId: adventureRewardOfferId(nodeId, 0), sourceNodeId: nodeId, rewardOrdinal: 0 })
    expect([result.chanceLossPrevented, result.streakResetPrevented]).toEqual([false, false])
    expect(resolveAdventureEncounterResult(encounter, 'win')).toEqual(result)
  })

  it('offers nothing after a loss, a draw, a final loss or the boss', () => {
    const encounter = deepFreeze(started(newRun()))
    for (const outcome of ['loss', 'draw'] as const) {
      expect(finished(encounter, outcome), outcome).toMatchObject({
        stage: 'map',
        selectedNodeId: encounter.selectedNodeId,
        attemptOrdinal: 1,
        pendingReward: null,
        encounterSetup: null,
        rewardHistory: [],
      })
    }
    expect(finished({ ...encounter, remainingChances: 1 }, 'loss')).toMatchObject({
      status: 'failed',
      stage: null,
      pendingReward: null,
      encounterSetup: null,
    })

    const completed = bossWon()
    expect(completed).toMatchObject({ status: 'completed', stage: null, pendingReward: null, encounterSetup: null })
    expect(completed.rewardHistory.map((entry) => entry.sourceNodeId)).toEqual(completed.completedNodeIds.slice(0, ADVENTURE_TIER_COUNT - 1))
  })

  it('keeps the offer through a save, a pause and a reopen, and starts no node until it is resolved', () => {
    const waiting = deepFreeze(firstReward())
    const paused = pauseAdventureRun(waiting)

    expect(normalizeAdventureRun(JSON.parse(JSON.stringify(waiting)))).toEqual(waiting)
    expect(paused).toEqual({ ...waiting, status: 'paused' })
    expect(openAdventureMap(paused)).toEqual(waiting)
    // The next tier already shows its choices, but they wait for the reward.
    expect(adventureRouteNodes(waiting)[1].every((node) => node.status === 'current' || node.status === 'available')).toBe(true)
    for (const run of [waiting, paused]) {
      for (const node of run.map.tiers.flatMap((tier) => tier.nodes)) {
        expect(startAdventureEncounter(run, node.id), `${run.status} ${node.id}`).toBeNull()
      }
    }
  })
})

describe('Adventure reward choices', () => {
  it('resolves an offer once, by a choice or a skip, also from a paused run', () => {
    const waiting = deepFreeze(firstReward())
    const offer = pending(waiting)
    const taken = chosen(waiting, offer.choices[0])
    const passed = skipped(waiting)

    expect(chosen(pauseAdventureRun(waiting), offer.choices[0])).toEqual(taken)
    expect(skipped(pauseAdventureRun(waiting))).toEqual(passed)
    for (const run of [taken, passed]) {
      expect(run).toMatchObject({ status: 'active', stage: 'map', currentTierIndex: 1, pendingReward: null })
      expect(chooseAdventureRunReward(run, offer.offerId, offer.choices[1])).toBeNull()
      expect(skipAdventureRunReward(run, offer.offerId)).toBeNull()
    }
  })

  it('rejects tampered offer and reward IDs without changing the run', () => {
    const waiting = deepFreeze(firstReward())
    const offer = pending(waiting)
    const choice = offer.choices[0]
    const notOffered = eligibleAdventureRewardIds(waiting).find((id) => !offer.choices.includes(id))
    const nextTierNode = waiting.map.tiers[1].nodes[0].id
    const badOfferIds: unknown[] = [
      undefined,
      null,
      '',
      42,
      { offerId: offer.offerId },
      [offer.offerId],
      offer.offerId.toUpperCase(),
      ` ${offer.offerId}`,
      `${offer.offerId} `,
      adventureRewardOfferId(offer.sourceNodeId, 1),
      adventureRewardOfferId(nextTierNode, 0),
    ]
    const badRewardIds: unknown[] = [
      undefined,
      null,
      '',
      'unknown-relic',
      notOffered,
      choice.toUpperCase(),
      ` ${choice}`,
      [choice],
      { id: choice },
      '__proto__',
      'constructor',
      'toString',
    ]

    expect(notOffered).toBeDefined()
    for (const offerId of badOfferIds) {
      expect(chooseAdventureRunReward(waiting, offerId, choice), String(offerId)).toBeNull()
      expect(skipAdventureRunReward(waiting, offerId), String(offerId)).toBeNull()
    }
    for (const rewardId of badRewardIds) {
      expect(chooseAdventureRunReward(waiting, offer.offerId, rewardId), String(rewardId)).toBeNull()
    }
  })

  it('refuses rewards outside the reward stage', () => {
    const waiting = firstReward()
    const offer = pending(waiting)
    const atMap = skipped(waiting)
    const states: Array<[string, AdventureRunState]> = [
      ['the next map', atMap],
      ['the next encounter', started(atMap)],
      ['a failed run', finished({ ...started(atMap), remainingChances: 1 }, 'loss')],
      ['a completed run', bossWon()],
      // Hand-built states that still hold the offer.
      ['a map holding the offer', { ...waiting, stage: 'map' }],
      ['an encounter holding the offer', { ...waiting, stage: 'encounter' }],
      ['a failed run holding the offer', { ...waiting, status: 'failed', stage: null }],
      ['a completed run holding the offer', { ...waiting, status: 'completed', stage: null }],
    ]
    for (const [label, run] of states) {
      deepFreeze(run)
      expect(chooseAdventureRunReward(run, offer.offerId, offer.choices[0]), label).toBeNull()
      expect(skipAdventureRunReward(run, offer.offerId), label).toBeNull()
    }
  })
})

describe('Adventure loss protection', () => {
  it('uses one Guardian Sigil charge for each loss it keeps from costing a chance', () => {
    let run = claimed(firstReward(), 'guardian-sigil')
    run = claimed(finished(started(run), 'win'), 'guardian-sigil')
    expect(run.relics).toEqual([{ id: 'guardian-sigil', charges: 2 }])

    const losses: unknown[] = []
    for (let loss = 0; loss < 3; loss += 1) {
      const result = resolveAdventureEncounterResult(started(run), 'loss')
      run = result.run
      losses.push([result.chanceLossPrevented, run.remainingChances, run.scoreEligibleChances, run.relics])
    }

    expect(losses).toEqual([
      [true, 3, 2, [{ id: 'guardian-sigil', charges: 1 }]],
      [true, 3, 1, []],
      [false, 2, 0, []],
    ])
  })

  it('keeps the last chance with Guardian Sigil instead of failing the run', () => {
    const encounter = { ...started(claimed(firstReward(), 'guardian-sigil')), remainingChances: 1, scoreEligibleChances: 1 }
    expect(isAdventureRunState(encounter)).toBe(true)

    const result = resolveAdventureEncounterResult(encounter, 'loss')
    expect(result.chanceLossPrevented).toBe(true)
    expect(result.run).toMatchObject({ status: 'active', stage: 'map', remainingChances: 1, scoreEligibleChances: 0, relics: [] })
    // Without the sigil, the same loss ends the run.
    expect(finished({ ...encounter, relics: [] }, 'loss')).toMatchObject({ status: 'failed', remainingChances: 0 })
  })

  it('uses a Streak Anchor charge only while the win streak is above zero', () => {
    const encounter = started(claimed(firstReward(), 'streak-anchor'))
    const kept = resolveAdventureEncounterResult(encounter, 'loss')
    const noStreak = resolveAdventureEncounterResult({ ...encounter, winStreak: 0 }, 'loss')

    expect(kept.streakResetPrevented).toBe(true)
    expect(kept.run).toMatchObject({ winStreak: 1, scoreEligibleWinStreak: 0, relics: [] })
    expect(noStreak.streakResetPrevented).toBe(false)
    expect(noStreak.run).toMatchObject({ winStreak: 0, relics: [{ id: 'streak-anchor', charges: 1 }] })
  })

  it('gives a kept streak its bonus chance, but never a score-eligible one', () => {
    let run = claimed(firstReward(), 'streak-anchor')
    run = skipped(finished(started(run), 'win'))
    run = finished(started(run), 'loss')
    expect(run).toMatchObject({ winStreak: 2, scoreEligibleWinStreak: 0, remainingChances: 2, scoreEligibleChances: 2 })

    run = finished(started(run), 'win')
    expect(run).toMatchObject({ winStreak: 3, scoreEligibleWinStreak: 1, remainingChances: 3, scoreEligibleChances: 2 })
  })

  it('scores a run that claims every reward like one that skips them all', () => {
    const plan: AdventureEncounterOutcome[][] = [['win'], ['loss', 'win'], ['win'], ['draw', 'loss', 'win'], ['win'], ['win'], ['win']]
    const claims: AdventureRewardId[] = ['second-wind', 'guardian-sigil', 'streak-anchor', 'guardian-sigil', 'second-wind', 'streak-anchor']
    const play = (claim: boolean): AdventureRunState => {
      let run = newRun()
      plan.forEach((outcomes, tierIndex) => {
        for (const outcome of outcomes) run = finished(started(run), outcome)
        if (tierIndex < ADVENTURE_TIER_COUNT - 1) run = claim ? claimed(run, claims[tierIndex]) : skipped(run)
      })
      return run
    }
    const claimedAll = play(true)
    const skippedAll = play(false)

    expect([claimedAll.status, skippedAll.status]).toEqual(['completed', 'completed'])
    expect([claimedAll.remainingChances, skippedAll.remainingChances]).toEqual([6, 2])
    expect([claimedAll.winStreak, skippedAll.winStreak]).toEqual([6, 4])
    for (const key of ['scoreEligibleChances', 'scoreEligibleWinStreak', 'totalRoundsPlayed', 'totalCardsPlayed'] as const) {
      expect(claimedAll[key], key).toBe(skippedAll[key])
    }
    expect(computeAdventureScore(claimedAll)).toBe(computeAdventureScore(skippedAll))
    expect(computeAdventureScore(skippedAll)).toBe(2 * 100 + 10 * 5)
  })
})

describe('Adventure reward traversal', () => {
  it.each(ADVENTURE_FORK_PATTERNS.map((pattern) => pattern.join(',')))(
    'offers a reward after each non-boss win on all 8 routes of fork pattern %s',
    (label) => {
      const pattern = label.split(',').map(Number)
      const seed = seedForForkPattern(pattern)
      const routes = new Set<string>()
      for (let route = 0; route < 2 ** pattern.length; route += 1) {
        let run = newRun(seed)
        for (let tierIndex = 0; tierIndex < ADVENTURE_TIER_COUNT; tierIndex += 1) {
          const fork = pattern.indexOf(tierIndex)
          const lane: AdventureNodeLane = fork === -1 ? 'center' : (route >> fork) & 1 ? 'right' : 'left'
          const nodeId = adventureNodeId(tierIndex, lane)
          run = started(run, nodeId)
          launchedGame(run)
          const before = run
          run = finished(run, 'win')
          if (tierIndex === ADVENTURE_TIER_COUNT - 1) break

          expect(run).toMatchObject({ stage: 'reward', currentTierIndex: tierIndex + 1 })
          expect(pending(run)).toEqual(generateAdventureRewardOffer(seed, nodeId, before))
          expect(pending(run)).toMatchObject({ sourceNodeId: nodeId, rewardOrdinal: tierIndex })
          run = tierIndex % 2 === 0 ? chosen(run, pending(run).choices[0]) : skipped(run)
        }

        expect(run.status).toBe('completed')
        expect(run.rewardHistory.map((entry) => entry.sourceNodeId)).toEqual(run.completedNodeIds.slice(0, ADVENTURE_TIER_COUNT - 1))
        expect(run.rewardHistory.map((entry) => entry.rewardId === null)).toEqual([false, true, false, true, false, true])
        routes.add(run.completedNodeIds.join(','))
      }
      expect(routes.size).toBe(8)
    },
  )

  it('never offers a reward that would change nothing', () => {
    const hoarded: AdventureRewardId[] = ['second-wind', 'guardian-sigil', 'streak-anchor', 'scout-cache']
    const offered = new Set<AdventureRewardId>()
    for (let seed = SEED; seed < SEED + 12; seed += 1) {
      let run = newRun(seed)
      while (run.status === 'active') {
        run = finished(started(run), 'win')
        if (run.stage !== 'reward') continue
        const offer = pending(run)
        const passed = skipped(run)
        for (const choice of offer.choices) {
          offered.add(choice)
          const taken = chosen(run, choice)
          expect([taken.remainingChances, taken.relics], `${seed} ${offer.offerId} ${choice}`).not.toEqual([
            passed.remainingChances,
            passed.relics,
          ])
        }
        // Prefer rewards that can be taken again, to reach their limits.
        run = chosen(run, offer.choices.find((choice) => hoarded.includes(choice)) ?? offer.choices[0])
      }
      expect(run.status).toBe('completed')
      expect(run.rewardHistory.filter((entry) => entry.rewardId === 'second-wind').length).toBeLessThanOrEqual(2)
    }
    expect([...offered].sort()).toEqual([...ADVENTURE_REWARD_IDS].sort())
  })
})

describe("Adventure Scout's Cache", () => {
  it('keeps the setup of an attempt for its restarts, also after a reload', () => {
    const encounter = deepFreeze(started(claimed(firstReward(), 'scout-cache')))
    expect(encounter).toMatchObject({ relics: [], encounterSetup: { playerOpeningHandSize: 7, guaranteedCreatures: [] } })

    for (const reopened of [openAdventureMap(encounter), openAdventureMap(pauseAdventureRun(encounter))]) {
      expect(reopened).toMatchObject({
        stage: 'map',
        selectedNodeId: encounter.selectedNodeId,
        attemptSeed: encounter.attemptSeed,
        encounterSetup: encounter.encounterSetup,
        relics: [],
      })
      const reloaded = normalizeAdventureRun(JSON.parse(JSON.stringify(reopened)))
      expect(reloaded).toEqual(reopened)
      const restarted = started(reloaded as AdventureRunState)
      expect(restarted).toEqual(encounter)
      expect(launchedGame(restarted)).toEqual(launchedGame(encounter))
    }
  })

  it('spends no charge on a refused start', () => {
    const atMap = deepFreeze(claimed(firstReward(), 'scout-cache'))
    const refused = [undefined, '', 'tier-1-left', 'tier-1-right', 'tier-3-center', 'tier-9-center', atMap.map.tiers[1].nodes[0].id.toUpperCase()]
    for (const nodeId of refused) {
      expect(startAdventureEncounter(atMap, nodeId), String(nodeId)).toBeNull()
    }
    expect(atMap.relics).toEqual([{ id: 'scout-cache', charges: 1 }])
    expect(started(atMap).encounterSetup).toEqual({ playerOpeningHandSize: 7, guaranteedCreatures: [] })
  })

  it('does not refund a charge after a draw or a loss', () => {
    const encounter = started(claimed(firstReward(), 'scout-cache'))
    for (const outcome of ['draw', 'loss'] as const) {
      const retry = finished(encounter, outcome)
      expect(retry, outcome).toMatchObject({ stage: 'map', relics: [], encounterSetup: null, attemptOrdinal: 1 })
      expect(started(retry).encounterSetup, outcome).toEqual(DEFAULT_SETUP)
    }
  })

  it('uses one charge for each new attempt', () => {
    let run = claimed(firstReward(), 'scout-cache')
    run = claimed(finished(started(run), 'win'), 'scout-cache')
    // Each reward is followed by a start, so two charges are only held in a
    // hand-built run; the history allows them.
    run = { ...run, relics: [{ id: 'scout-cache', charges: 2 }] }
    expect(isAdventureRunState(run)).toBe(true)

    const hands: number[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      run = started(run)
      hands.push(launchedGame(run).players[0].hand.length)
      run = finished(run, 'draw')
    }
    expect(hands).toEqual([7, 7, 5])
    expect(run.relics).toEqual([])
  })
})

describe('adventureEncounterLaunch', () => {
  it('deals a relic-free encounter exactly like a plain game of the attempt', () => {
    const run = started(newRun())
    const launch = adventureEncounterLaunch(run)
    const seed = run.attemptSeed as number

    expect(launch.seed).toBe(seed)
    expect(launch.options).toEqual({ openingHandSizes: [5, 5] })
    expect(createInitialGame(launch.seed, launch.decks, launch.options)).toEqual(
      createInitialGame(seed, deckPairForAdventureGame(run, seed)),
    )
  })

  it('combines Prepared Pack and a charm in the player hand only', () => {
    let run = claimed(firstReward(), 'prepared-pack')
    run = claimed(finished(started(run), 'win'), 'echo-charm')
    run = started(run)

    expect(run.encounterSetup).toEqual({ playerOpeningHandSize: 6, guaranteedCreatures: ['Plains'] })
    const game = launchedGame(run)
    expect(game.players[0].hand).toHaveLength(6)
    expect(game.players[0].hand.map((card) => card.name)).toContain('Plains')
    expect(game.players[1].hand).toHaveLength(5)
  })

  it('throws without a committed attempt and its setup', () => {
    const encounter = started(newRun())
    const states: Array<[string, AdventureRunState]> = [
      ['the map', newRun()],
      ['the reward stage', firstReward()],
      ['a completed run', bossWon()],
      ['an encounter without a setup', { ...encounter, encounterSetup: null }],
      ['an encounter without a seed', { ...encounter, attemptSeed: null }],
    ]
    for (const [label, run] of states) {
      expect(() => adventureEncounterLaunch(run), label).toThrow()
    }
  })
})

describe('Adventure run guard with rewards', () => {
  const waiting = firstReward()
  const offer = pending(waiting)
  const atMap = skipped(waiting)
  const encounter = started(atMap)
  const second = finished(encounter, 'win')
  const atThirdMap = skipped(second)
  const history = atThirdMap.rewardHistory
  const completed = bossWon()
  const owned = finished(started(claimed(firstReward(), 'prepared-pack')), 'win')
  const sibling = adventureNodeId(0, 'right')
  const offerFrom = (sourceNodeId: string, rewardOrdinal = 0): AdventureRewardOffer => ({
    ...offer,
    sourceNodeId,
    rewardOrdinal,
    offerId: adventureRewardOfferId(sourceNodeId, rewardOrdinal),
  })
  const setupAt = (playerOpeningHandSize: unknown, guaranteedCreatures: unknown) => ({
    ...encounter,
    encounterSetup: { playerOpeningHandSize, guaranteedCreatures },
  })

  it.each<[string, AdventureRunState]>([
    ['the reward stage', waiting],
    ['a paused reward stage', pauseAdventureRun(waiting)],
    ['the map', atMap],
    ['an encounter', encounter],
    ['a later reward stage', second],
    ['a map keeping an attempt and its setup', openAdventureMap(encounter)],
    ['a run saved before rewards, then rewarded', skipped(finished(started(openAdventureMap(backfilledRun('mapPausedAfterWin'))), 'win'))],
    ['a completed run', completed],
    ['a failed run', finished({ ...encounter, remainingChances: 1 }, 'loss')],
  ])('accepts %s', (_label, run) => {
    expect(isAdventureRunState(run)).toBe(true)
    expect(normalizeAdventureRun(JSON.parse(JSON.stringify(run)))).toEqual(run)
  })

  it.each<[string, unknown]>([
    ['a reward stage without an offer', { ...waiting, pendingReward: null }],
    ['a map holding an offer', { ...waiting, stage: 'map' }],
    ['an encounter holding an offer', { ...encounter, pendingReward: offer }],
    ['a completed run holding an offer', { ...completed, pendingReward: offer }],
    ['an offer from the bypassed sibling', { ...waiting, pendingReward: offerFrom(sibling) }],
    ['an offer from the boss', { ...waiting, pendingReward: offerFrom(adventureNodeId(ADVENTURE_TIER_COUNT - 1, 'center')) }],
    ['an offer with a stale ordinal', { ...second, pendingReward: offerFrom(pending(second).sourceNodeId, 0) }],
    ['an offer with a mismatched ID', { ...waiting, pendingReward: { ...offer, offerId: `${offer.offerId}-x` } }],
    ['an offer of an owned unique relic', { ...owned, pendingReward: { ...pending(owned), choices: ['prepared-pack', ...pending(owned).choices.slice(1)] } }],
    ['an offer with two choices', { ...waiting, pendingReward: { ...offer, choices: offer.choices.slice(0, 2) } }],
    ['an offer with a repeated choice', { ...waiting, pendingReward: { ...offer, choices: [offer.choices[0], offer.choices[0], offer.choices[1]] } }],
    ['an offer with an unknown choice', { ...waiting, pendingReward: { ...offer, choices: [offer.choices[0], offer.choices[1], 'lucky-coin'] } }],
    ['an offer from other reward rules', { ...waiting, pendingReward: { ...offer, rulesVersion: 2 } }],
    ['a run without pendingReward', without(waiting, 'pendingReward')],
    ['a run without encounterSetup', without(encounter, 'encounterSetup')],
    ['an encounter without a setup', { ...encounter, encounterSetup: null }],
    ['a reward stage with a setup', { ...waiting, encounterSetup: DEFAULT_SETUP }],
    ['a map with a setup but no kept attempt', { ...atMap, encounterSetup: DEFAULT_SETUP }],
    ['a completed run with a setup', { ...completed, encounterSetup: DEFAULT_SETUP }],
    ['a setup with a 4-card hand', setupAt(4, [])],
    ['a setup with a 9-card hand', setupAt(9, [])],
    ['a setup with a fractional hand', setupAt(5.5, [])],
    ['a setup with a text hand', setupAt('5', [])],
    ['a setup with creatures out of order', setupAt(5, ['Swamp', 'Forest'])],
    ['a setup with a repeated creature', setupAt(5, ['Forest', 'Forest'])],
    ['a setup with an unknown creature', setupAt(5, ['Wastes'])],
    ['a setup without a creature list', setupAt(5, null)],
    ['a reward stage keeping a node', { ...waiting, selectedNodeId: waiting.map.tiers[1].nodes[0].id }],
    ['a reward stage on a retry', { ...waiting, attemptOrdinal: 1 }],
    ['a reward stage with a seed', { ...waiting, attemptSeed: 1 }],
    ['a reward stage before any win', { ...newRun(), stage: 'reward' }],
    ['history from the bypassed sibling', { ...atMap, rewardHistory: [{ sourceNodeId: sibling, rewardId: null }] }],
    ['history missing the latest resolved offer', { ...atThirdMap, rewardHistory: history.slice(0, 1) }],
    ['history out of route order', { ...atThirdMap, rewardHistory: [history[1], history[0]] }],
    ['history naming the pending source', { ...waiting, rewardHistory: [{ sourceNodeId: offer.sourceNodeId, rewardId: null }] }],
    ['history naming the boss', { ...completed, rewardHistory: [...completed.rewardHistory, { sourceNodeId: completed.completedNodeIds[6], rewardId: null }] }],
  ])('rejects %s', (_label, value) => {
    expect(isAdventureRunState(value)).toBe(false)
    expect(normalizeAdventureRun(value)).toBeNull()
  })
})

describe('runs saved before rewards', () => {
  it.each(PRE_REWARD_SCENARIOS)('fills in the missing fields of %s without changing the save', (name) => {
    const input = deepFreeze(preRewardRun(name))
    const before = JSON.stringify(input)
    const output = backfillPreRewardAdventureRun(input)

    expect(isAdventureRunState(input)).toBe(false)
    expect(output).toEqual({
      ...input,
      pendingReward: null,
      encounterSetup: input.stage === 'encounter' ? DEFAULT_SETUP : null,
    })
    expect(isAdventureRunState(output)).toBe(true)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('returns any other value unchanged for the strict guard', () => {
    const encounter = started(newRun())
    const values: Array<Record<string, unknown>> = [
      { ...encounter },
      without(encounter, 'pendingReward'),
      without(encounter, 'encounterSetup'),
      { ...preRewardRun('mapNewRun'), relics: [{ id: 'prepared-pack' }] },
      { ...preRewardRun('mapPausedAfterWin'), rewardHistory: [{ sourceNodeId: 'tier-1-left', rewardId: null }] },
      { ...preRewardRun('mapNewRun'), relics: null },
      {},
    ]
    for (const value of values) {
      expect(backfillPreRewardAdventureRun(value)).toBe(value)
    }
    expect(values.slice(1).map((value) => isAdventureRunState(value))).toEqual(values.slice(1).map(() => false))
  })

  it('restarts a pre-reward encounter with the same deal the earlier version gave it', () => {
    const scenario = readPreRewardFixture().encounterPausedMidGame as Record<string, string>
    const stored = JSON.parse(scenario['cardgame.adventure-game']) as { game: { players: PlayerState[] } }
    const run = started(openAdventureMap(backfilledRun('encounterClosedMidGame')))
    const seed = run.attemptSeed as number
    const game = launchedGame(run)
    const [player, opponent] = stored.game.players

    expect(game).toEqual(createInitialGame(seed, deckPairForAdventureGame(run, seed)))
    expect(game.players[1]).toEqual(opponent)
    expect(game.players[0].deck).toEqual(player.deck)
    expect(game.players[0].hand.map((card) => card.id).sort()).toEqual(
      [...player.hand, ...player.battlefield.map((entry) => entry.card)].map((card) => card.id).sort(),
    )
  })

  it('offers a reward for each later non-boss win of a run saved after a win', () => {
    let run = openAdventureMap(backfilledRun('mapPausedAfterWin'))
    const offers: AdventureRewardOffer[] = []
    while (run.status === 'active') {
      run = finished(started(run), 'win')
      if (run.stage === 'reward') {
        offers.push(pending(run))
        run = skipped(run)
      }
    }

    expect(run.status).toBe('completed')
    expect(offers.map((entry) => entry.rewardOrdinal)).toEqual([0, 1, 2, 3, 4])
    expect(offers.map((entry) => entry.sourceNodeId)).toEqual(run.completedNodeIds.slice(1, ADVENTURE_TIER_COUNT - 1))
    expect(run.rewardHistory.map((entry) => entry.sourceNodeId)).toEqual(run.completedNodeIds.slice(1, ADVENTURE_TIER_COUNT - 1))
  })
})
