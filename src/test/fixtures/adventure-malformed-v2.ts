import {
  ADVENTURE_SCHEMA_VERSION,
  ADVENTURE_TIER_COUNT,
  adventureEncounterLaunch,
  adventureNodeId,
  buildAdventureLineup,
  chooseAdventureRunReward,
  cloneAdventureRun,
  createAdventureRun,
  isAdventureRunState,
  openAdventureMap,
  pauseAdventureRun,
  resolveAdventureEncounterResult,
  skipAdventureRunReward,
  startAdventureEncounter,
  type AdventureEncounterOutcome,
  type AdventureRunState,
} from '../../app/adventure'
import { generateBranchingAdventureMap, linearAdventureTiers, type AdventureMapKind } from '../../app/adventure-map'
import {
  adventureRewardOfferId,
  eligibleAdventureRewardIds,
  type AdventureRewardId,
  type AdventureRewardOffer,
} from '../../app/adventure-rewards'
import type { AdventureEncounterSetup } from '../../app/adventure-setup'
import { applyAction, canAct, createInitialGame, getLegalActions } from '../../game/engine'
import type { GameState } from '../../game/types'
import { deepFreeze } from '../helpers/deep-freeze'

// Schema version 2 runs for the malformed-save tests and the fuzzer. Every
// base is reached from a fixed seed by run transitions, so it passes the
// strict guard; each case then breaks one rule on a writable copy. Bases are
// built on first use and deeply frozen.

export const FIXTURE_RUN_ID = '0123456789abcdef0123456789abcdef'
export const FIXTURE_SEED = 1_770_000_000_000

export const MALFORMED_BASE_NAMES = [
  'map',
  'encounter',
  'reward',
  'relicEncounter',
  'passiveReward',
  'stocked',
  'forkRetry',
  'restartMap',
  'pausedEncounter',
  'bossEncounter',
  'completed',
  'failed',
  'linearEncounter',
  'legacyMap',
] as const

export type MalformedBaseName = (typeof MALFORMED_BASE_NAMES)[number]

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

function pendingOffer(run: AdventureRunState): AdventureRewardOffer {
  if (!run.pendingReward) throw new Error('Expected a pending reward.')
  return run.pendingReward
}

function skipped(run: AdventureRunState): AdventureRunState {
  const next = skipAdventureRunReward(run, pendingOffer(run).offerId)
  if (!next) throw new Error('Expected the reward to be skipped.')
  return next
}

/**
 * Takes `rewardId` from the pending offer, whatever the seed offered: the
 * offer is first shown with `rewardId` and two other eligible rewards.
 */
export function claimed(run: AdventureRunState, rewardId: AdventureRewardId): AdventureRunState {
  const offer = pendingOffer(run)
  const others = eligibleAdventureRewardIds(run).filter((id) => id !== rewardId).slice(0, 2)
  const offered: AdventureRunState = { ...cloneAdventureRun(run), pendingReward: { ...offer, choices: [rewardId, ...others] } }
  if (!isAdventureRunState(offered)) throw new Error(`${rewardId} cannot be offered to this run.`)
  const next = chooseAdventureRunReward(offered, offer.offerId, rewardId)
  if (!next) throw new Error(`Expected ${rewardId} to be chosen.`)
  return next
}

/** A new run whose map holds the seed's lineup as one `center` node per tier. */
function linearRun(kind: Exclude<AdventureMapKind, 'branching'>): AdventureRunState {
  return {
    ...createAdventureRun(FIXTURE_SEED, FIXTURE_RUN_ID),
    map: { kind, tiers: linearAdventureTiers(buildAdventureLineup(FIXTURE_SEED)) },
  }
}

/** The first seed from `FIXTURE_SEED` whose branching map forks on tier 1. */
function firstTierForkSeed(): number {
  for (let seed = FIXTURE_SEED; seed < FIXTURE_SEED + 400; seed += 1) {
    if (generateBranchingAdventureMap(seed).tiers[0].nodes.length === 2) return seed
  }
  throw new Error('Expected a seed whose map forks on tier 1.')
}

const BASE_BUILDERS: Record<MalformedBaseName, () => AdventureRunState> = {
  // A new run at tier 1, before any node is chosen.
  map: () => createAdventureRun(FIXTURE_SEED, FIXTURE_RUN_ID),
  // Tier 1 started with the default setup.
  encounter: () => started(malformedBase('map')),
  // Tier 1 won: the first offer waits.
  reward: () => finished(malformedBase('encounter'), 'win'),
  // Guardian Sigil (one charge) taken from the first offer, then tier 2 started.
  relicEncounter: () => started(claimed(malformedBase('reward'), 'guardian-sigil')),
  // Prepared Pack taken from the first offer, then tier 2 won: the second offer waits.
  passiveReward: () => finished(started(claimed(malformedBase('reward'), 'prepared-pack')), 'win'),
  // Tiers 1-6 won, taking Second Wind, Scout's Cache (used by tier 3),
  // Second Wind, Streak Anchor and Echo Charm: the last offer waits.
  stocked: () => {
    let run = malformedBase('reward')
    for (const rewardId of ['second-wind', 'scout-cache', 'second-wind', 'streak-anchor', 'echo-charm'] as const) {
      run = finished(started(claimed(run, rewardId)), 'win')
    }
    return run
  },
  // Lost on the right node of a tier 1 fork: the node, attempt 1 and its
  // seed are kept for the retry.
  forkRetry: () => {
    const run = createAdventureRun(firstTierForkSeed(), FIXTURE_RUN_ID)
    return finished(started(run, adventureNodeId(0, 'right')), 'loss')
  },
  // Paused on the map after leaving a started encounter: node, seed and
  // setup are kept, so the restart deals the same opening.
  restartMap: () => pauseAdventureRun(openAdventureMap(malformedBase('encounter'))),
  // Paused mid-encounter with a charged relic, as Pause saves it.
  pausedEncounter: () => pauseAdventureRun(malformedBase('relicEncounter')),
  // Tiers 1-6 won with every reward skipped, then the boss started.
  bossEncounter: () => {
    let run = malformedBase('encounter')
    while (run.currentTierIndex < ADVENTURE_TIER_COUNT - 1) {
      run = started(skipped(finished(run, 'win')))
    }
    return run
  },
  completed: () => finished(malformedBase('bossEncounter'), 'win'),
  // Three losses on tier 1 use every starting chance.
  failed: () => finished(started(finished(started(finished(malformedBase('encounter'), 'loss')), 'loss')), 'loss'),
  // A Milestone 2 linear map, started at tier 1.
  linearEncounter: () => started(linearRun('linear')),
  // A converted version 1 map: tier 1 won and its reward skipped.
  legacyMap: () => skipped(finished(started(linearRun('legacy-linear')), 'win')),
}

const builtBases = new Map<MalformedBaseName, AdventureRunState>()

/** The named base run, deeply frozen. Copy it before changing it. */
export function malformedBase(name: MalformedBaseName): AdventureRunState {
  let run = builtBases.get(name)
  if (!run) {
    run = deepFreeze(BASE_BUILDERS[name]())
    builtBases.set(name, run)
  }
  return run
}

/** `counter` covers the run's counters and its base and attempt seeds. */
export type MalformedCategory = 'map' | 'offer' | 'relic' | 'history' | 'attempt' | 'counter'

export interface MalformedRunCase {
  readonly label: string
  readonly category: MalformedCategory
  readonly base: MalformedBaseName
  /** Edits a writable copy of the base, as a hand-edited save could. */
  readonly mutate: (run: AdventureRunState) => void
}

/** Sets a field to a value its type does not allow. */
function put(target: object, key: string | number, value: unknown): void {
  ;(target as Record<string | number, unknown>)[key] = value
}

/** Removes a field its type requires. */
function drop(target: object, key: string): void {
  delete (target as Record<string, unknown>)[key]
}

function setupOf(run: AdventureRunState): AdventureEncounterSetup {
  if (!run.encounterSetup) throw new Error('Expected an encounter setup.')
  return run.encounterSetup
}

function firstForkTierIndex(run: AdventureRunState): number {
  const tierIndex = run.map.tiers.findIndex((tier) => tier.nodes.length === 2)
  if (tierIndex < 0) throw new Error('Expected a fork.')
  return tierIndex
}

/** Each case breaks one rule of a valid base; every one must be rejected. */
export const MALFORMED_RUN_CASES: readonly MalformedRunCase[] = Object.freeze([
  {
    label: 'a branching map that repeats an opponent',
    category: 'map',
    base: 'map',
    mutate: (run) => put(run.map.tiers[1].nodes[0].opponent, 'id', run.map.tiers[0].nodes[0].opponent.id),
  },
  {
    label: 'a mono opponent before the boss',
    category: 'map',
    base: 'map',
    mutate: (run) => put(run.map.tiers[0].nodes[0].opponent, 'kind', 'mono'),
  },
  {
    label: 'a boss that is not mono',
    category: 'map',
    base: 'bossEncounter',
    mutate: (run) => put(run.map.tiers[ADVENTURE_TIER_COUNT - 1].nodes[0].opponent, 'kind', 'dual'),
  },
  {
    label: 'a fork merged into one node, off the fork patterns',
    category: 'map',
    base: 'map',
    mutate: (run) => {
      const tierIndex = firstForkTierIndex(run)
      const tier = run.map.tiers[tierIndex]
      put(tier, 'nodes', [{ ...tier.nodes[0], id: adventureNodeId(tierIndex, 'center'), lane: 'center' }])
    },
  },
  {
    label: 'a fork with its lanes swapped',
    category: 'map',
    base: 'map',
    mutate: (run) => run.map.tiers[firstForkTierIndex(run)].nodes.reverse(),
  },
  {
    label: 'a map with six tiers',
    category: 'map',
    base: 'map',
    mutate: (run) => run.map.tiers.pop(),
  },
  {
    label: 'a map of an unknown kind',
    category: 'map',
    base: 'map',
    mutate: (run) => put(run.map, 'kind', 'spiral'),
  },
  {
    label: 'an opponent deck of 51 cards',
    category: 'map',
    base: 'encounter',
    mutate: (run) => run.map.tiers[0].nodes[0].opponent.deck.push({ id: 'extra-card', name: 'Forest', type: 'land' }),
  },
  {
    label: 'an opponent deck that repeats a card ID',
    category: 'map',
    base: 'encounter',
    mutate: (run) => {
      const deck = run.map.tiers[0].nodes[0].opponent.deck
      put(deck[1], 'id', deck[0].id)
    },
  },
  {
    label: 'an opponent with an unknown land',
    category: 'map',
    base: 'linearEncounter',
    mutate: (run) => put(run.map.tiers[2].nodes[0].opponent, 'lands', ['Wastes']),
  },
  {
    label: 'an offer from a node the run did not win',
    category: 'offer',
    base: 'reward',
    mutate: (run) => {
      const sourceNodeId = run.map.tiers[1].nodes[0].id
      put(run, 'pendingReward', { ...pendingOffer(run), sourceNodeId, offerId: adventureRewardOfferId(sourceNodeId, 0) })
    },
  },
  {
    label: 'an offer ordinal behind the history',
    category: 'offer',
    base: 'passiveReward',
    mutate: (run) => {
      const offer = pendingOffer(run)
      put(run, 'pendingReward', { ...offer, rewardOrdinal: 0, offerId: adventureRewardOfferId(offer.sourceNodeId, 0) })
    },
  },
  {
    label: 'an offer from reward rules version 0',
    category: 'offer',
    base: 'reward',
    mutate: (run) => put(pendingOffer(run), 'rulesVersion', 0),
  },
  {
    label: 'an offer with four choices',
    category: 'offer',
    base: 'reward',
    mutate: (run) => {
      const offer = pendingOffer(run)
      const extra = eligibleAdventureRewardIds(run).find((id) => !offer.choices.includes(id))
      put(offer, 'choices', [...offer.choices, extra])
    },
  },
  {
    label: 'an offer of an owned unique relic',
    category: 'offer',
    base: 'passiveReward',
    mutate: (run) => {
      const offer = pendingOffer(run)
      put(offer, 'choices', ['prepared-pack', ...offer.choices.filter((id) => id !== 'prepared-pack').slice(0, 2)])
    },
  },
  {
    label: 'an offer of Second Wind after two picks',
    category: 'offer',
    base: 'stocked',
    mutate: (run) => put(pendingOffer(run).choices, 0, 'second-wind'),
  },
  {
    label: 'an offer with a misspelt reward',
    category: 'offer',
    base: 'reward',
    mutate: (run) => put(pendingOffer(run).choices, 0, 'Second-Wind'),
  },
  {
    label: 'an offer whose choices are not a list',
    category: 'offer',
    base: 'reward',
    mutate: (run) => put(pendingOffer(run), 'choices', 'second-wind'),
  },
  {
    label: 'an offer without its ID',
    category: 'offer',
    base: 'stocked',
    mutate: (run) => drop(pendingOffer(run), 'offerId'),
  },
  {
    label: 'a relic nobody chose',
    category: 'relic',
    base: 'map',
    mutate: (run) => put(run, 'relics', [{ id: 'prepared-pack' }]),
  },
  {
    label: 'more charges than picks',
    category: 'relic',
    base: 'stocked',
    mutate: (run) => put(run.relics[0], 'charges', 2),
  },
  {
    label: 'a charged relic with no charges left',
    category: 'relic',
    base: 'relicEncounter',
    mutate: (run) => put(run.relics[0], 'charges', 0),
  },
  {
    label: 'a fractional charge',
    category: 'relic',
    base: 'relicEncounter',
    mutate: (run) => put(run.relics[0], 'charges', 0.5),
  },
  {
    label: 'a charged relic without charges',
    category: 'relic',
    base: 'relicEncounter',
    mutate: (run) => drop(run.relics[0], 'charges'),
  },
  {
    label: 'a passive relic with charges',
    category: 'relic',
    base: 'passiveReward',
    mutate: (run) => put(run.relics[0], 'charges', 1),
  },
  {
    label: 'relics out of catalog order',
    category: 'relic',
    base: 'stocked',
    mutate: (run) => run.relics.reverse(),
  },
  {
    label: 'a repeated relic',
    category: 'relic',
    base: 'passiveReward',
    mutate: (run) => run.relics.push({ ...run.relics[0] }),
  },
  {
    label: 'a chosen charm no longer owned',
    category: 'relic',
    base: 'stocked',
    mutate: (run) => put(run, 'relics', run.relics.filter((relic) => relic.id !== 'echo-charm')),
  },
  {
    label: 'an unknown relic',
    category: 'relic',
    base: 'relicEncounter',
    mutate: (run) => put(run.relics[0], 'id', 'lucky-coin'),
  },
  {
    label: 'Second Wind held as a relic',
    category: 'relic',
    base: 'stocked',
    mutate: (run) => put(run, 'relics', [{ id: 'second-wind' }, ...run.relics]),
  },
  {
    label: 'relics that are not a list',
    category: 'relic',
    base: 'relicEncounter',
    mutate: (run) => put(run, 'relics', { 'guardian-sigil': 1 }),
  },
  {
    label: 'a history entry for a tier not yet won',
    category: 'history',
    base: 'map',
    mutate: (run) => run.rewardHistory.push({ sourceNodeId: run.map.tiers[0].nodes[0].id, rewardId: null }),
  },
  {
    label: 'Second Wind picked three times',
    category: 'history',
    base: 'bossEncounter',
    mutate: (run) => {
      for (const index of [0, 1, 2]) put(run.rewardHistory[index], 'rewardId', 'second-wind')
    },
  },
  {
    label: 'a unique relic picked twice',
    category: 'history',
    base: 'bossEncounter',
    mutate: (run) => {
      put(run, 'relics', [{ id: 'prepared-pack' }])
      for (const index of [0, 1]) put(run.rewardHistory[index], 'rewardId', 'prepared-pack')
    },
  },
  {
    label: 'history entries out of route order',
    category: 'history',
    base: 'stocked',
    mutate: (run) => {
      const [first, second] = run.rewardHistory
      run.rewardHistory[0] = second
      run.rewardHistory[1] = first
    },
  },
  {
    label: 'a history entry with an unknown reward',
    category: 'history',
    base: 'stocked',
    mutate: (run) => put(run.rewardHistory[0], 'rewardId', 'lucky-coin'),
  },
  {
    label: 'a history entry without its source',
    category: 'history',
    base: 'stocked',
    mutate: (run) => drop(run.rewardHistory[1], 'sourceNodeId'),
  },
  {
    label: 'a history entry that is not an object',
    category: 'history',
    base: 'passiveReward',
    mutate: (run) => put(run.rewardHistory, 0, 'prepared-pack'),
  },
  {
    label: 'a history that is not a list',
    category: 'history',
    base: 'reward',
    mutate: (run) => put(run, 'rewardHistory', null),
  },
  {
    label: 'an encounter on a node of another tier',
    category: 'attempt',
    base: 'encounter',
    mutate: (run) => put(run, 'selectedNodeId', run.map.tiers[1].nodes[0].id),
  },
  {
    label: 'an encounter without an attempt seed',
    category: 'attempt',
    base: 'encounter',
    mutate: (run) => put(run, 'attemptSeed', null),
  },
  {
    label: 'an encounter without its setup',
    category: 'attempt',
    base: 'relicEncounter',
    mutate: (run) => put(run, 'encounterSetup', null),
  },
  {
    label: 'a kept setup without its node',
    category: 'attempt',
    base: 'restartMap',
    mutate: (run) => put(run, 'selectedNodeId', null),
  },
  {
    label: 'a kept setup without its seed',
    category: 'attempt',
    base: 'restartMap',
    mutate: (run) => put(run, 'attemptSeed', null),
  },
  {
    label: 'a nine-card opening hand',
    category: 'attempt',
    base: 'encounter',
    mutate: (run) => put(setupOf(run), 'playerOpeningHandSize', 9),
  },
  {
    label: 'a repeated guaranteed creature',
    category: 'attempt',
    base: 'encounter',
    mutate: (run) => put(setupOf(run), 'guaranteedCreatures', ['Forest', 'Forest']),
  },
  {
    label: 'an attempt number past the safe integers',
    category: 'attempt',
    base: 'forkRetry',
    mutate: (run) => put(run, 'attemptOrdinal', 2 ** 53),
  },
  {
    label: 'a negative attempt number',
    category: 'attempt',
    base: 'forkRetry',
    mutate: (run) => put(run, 'attemptOrdinal', -1),
  },
  {
    label: 'a fractional attempt number',
    category: 'attempt',
    base: 'forkRetry',
    mutate: (run) => put(run, 'attemptOrdinal', 1.5),
  },
  {
    label: 'a reward stage keeping a seed',
    category: 'attempt',
    base: 'reward',
    mutate: (run) => put(run, 'attemptSeed', 7),
  },
  {
    label: 'a completed run keeping the boss node',
    category: 'attempt',
    base: 'completed',
    mutate: (run) => put(run, 'selectedNodeId', run.completedNodeIds[ADVENTURE_TIER_COUNT - 1]),
  },
  {
    label: 'a failed run keeping its seed',
    category: 'attempt',
    base: 'failed',
    mutate: (run) => put(run, 'attemptSeed', 7),
  },
  {
    label: 'score-eligible chances past the safe integers',
    category: 'counter',
    base: 'bossEncounter',
    mutate: (run) => put(run, 'scoreEligibleChances', 2 ** 53),
  },
  {
    label: 'a round count too large to add to',
    category: 'counter',
    base: 'reward',
    mutate: (run) => put(run, 'totalRoundsPlayed', 1e308),
  },
  {
    label: 'a negative card count',
    category: 'counter',
    base: 'encounter',
    mutate: (run) => put(run, 'totalCardsPlayed', -1),
  },
  {
    label: 'a fractional win streak',
    category: 'counter',
    base: 'stocked',
    mutate: (run) => put(run, 'winStreak', 2.5),
  },
  {
    label: 'chances stored as text',
    category: 'counter',
    base: 'map',
    mutate: (run) => put(run, 'remainingChances', '3'),
  },
  {
    label: 'a missing score-eligible streak',
    category: 'counter',
    base: 'passiveReward',
    mutate: (run) => drop(run, 'scoreEligibleWinStreak'),
  },
  {
    label: 'a base seed past the safe integers',
    category: 'counter',
    base: 'map',
    mutate: (run) => put(run, 'baseSeed', 2 ** 53),
  },
  {
    label: 'an attempt seed past the safe integers',
    category: 'counter',
    base: 'encounter',
    mutate: (run) => put(run, 'attemptSeed', 2 ** 53 + 2),
  },
])

export interface AcceptedRunVariant {
  readonly label: string
  readonly base: MalformedBaseName
  readonly mutate: (run: AdventureRunState) => void
  /** The run the reader returns: the base itself, or else the edited copy. */
  readonly reads: 'base' | 'edited'
}

/** Edits the strict guard accepts on purpose. */
export const ACCEPTED_RUN_VARIANTS: readonly AcceptedRunVariant[] = Object.freeze([
  {
    label: 'unknown keys, which the reader drops',
    base: 'stocked',
    reads: 'base',
    mutate: (run) => {
      for (const target of [run, run.map, run.map.tiers[0], run.map.tiers[0].nodes[0], run.map.tiers[0].nodes[0].opponent,
        run.map.tiers[0].nodes[0].opponent.deck[0], run.relics[0], run.rewardHistory[0], pendingOffer(run)]) {
        put(target, 'note', 'hand-edited')
      }
    },
  },
  {
    label: 'a history missing its earliest entries, as before rewards existed',
    base: 'bossEncounter',
    reads: 'edited',
    mutate: (run) => run.rewardHistory.splice(0, 2),
  },
  {
    label: 'a used-up charged relic that only the history names',
    base: 'relicEncounter',
    reads: 'edited',
    mutate: (run) => run.relics.splice(0),
  },
  {
    label: 'a reward-free encounter saved without the reward fields',
    base: 'encounter',
    reads: 'base',
    mutate: (run) => {
      drop(run, 'pendingReward')
      drop(run, 'encounterSetup')
    },
  },
])

/** A writable copy of the base with the case applied. */
export function malformedRun(entry: Pick<MalformedRunCase, 'base' | 'mutate'>): AdventureRunState {
  const run = structuredClone(malformedBase(entry.base))
  entry.mutate(run)
  return run
}

/** An identity-bound mid-game save of the run's committed attempt. */
export function adventureEnvelopeFor(run: AdventureRunState, game: unknown): Record<string, unknown> {
  return {
    schemaVersion: ADVENTURE_SCHEMA_VERSION,
    runId: run.runId,
    nodeId: run.selectedNodeId,
    attemptOrdinal: run.attemptOrdinal,
    attemptSeed: run.attemptSeed,
    game,
  }
}

/** A new game of the run's committed attempt. */
export function launchedAdventureGame(run: AdventureRunState): GameState {
  const launch = adventureEncounterLaunch(run)
  return createInitialGame(launch.seed, launch.decks, launch.options)
}

/**
 * A game of the run's committed attempt after a few deterministic legal
 * actions: each step plays a land when it can, otherwise the first legal
 * action. Throws unless the game is still in progress.
 */
export function playedAdventureGame(run: AdventureRunState, steps = 12): GameState {
  let game = launchedAdventureGame(run)
  for (let step = 0; step < steps; step += 1) {
    const actor = canAct(game, 0) ? 0 : canAct(game, 1) ? 1 : null
    if (actor === null) break
    const legal = getLegalActions(game, actor)
    const action = legal.find((candidate) => candidate.type === 'play_land') ?? legal[0]
    if (!action) break
    game = applyAction(game, action)
  }
  if (game.phase === 'gameOver') throw new Error('Expected the fixture game to stay in progress.')
  return game
}
