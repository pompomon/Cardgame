import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shuffle } from '../game/cards'
import { BASIC_LANDS } from '../game/types'
import { adventureNodeId, adventureRewardSeed, type AdventureEncounterOutcome, type AdventureNodeLane } from '../app/adventure-map'
import {
  ADVENTURE_MAX_RELIC_CHARGES,
  ADVENTURE_MAX_REWARDS,
  ADVENTURE_REWARD_CATALOG,
  ADVENTURE_REWARD_IDS,
  ADVENTURE_REWARD_OFFER_SIZE,
  ADVENTURE_REWARD_RULES_VERSION,
  ADVENTURE_SECOND_WIND_LIMIT,
  adventureRewardCatalogEntry,
  adventureRewardOfferId,
  applyAdventureLossProtection,
  chooseAdventureReward,
  cloneAdventureRelics,
  cloneAdventureRewardHistory,
  cloneAdventureRewardOffer,
  consumeAdventureRelicCharge,
  eligibleAdventureRewardIds,
  generateAdventureRewardOffer,
  isAdventureChargedRelicId,
  isAdventureRelicId,
  isAdventureRelicInventory,
  isAdventureRewardHistory,
  isAdventureRewardHoldings,
  isAdventureRewardId,
  isAdventureRewardOffer,
  skipAdventureReward,
  type AdventureChargedRelicId,
  type AdventureLossProtectionState,
  type AdventureRelic,
  type AdventureRewardHistoryEntry,
  type AdventureRewardHoldings,
  type AdventureRewardId,
  type AdventureRewardOffer,
  type AdventureRewardProgress,
  type AdventureRewardState,
} from '../app/adventure-rewards'
import { displayCardName } from '../app/card-catalog'
import { deepFreeze } from './helpers/deep-freeze'

const CLOCK_SEED = 1_760_000_000_000
const EDGE_SEEDS = [
  0,
  1,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 31 + 1,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 32 + 1,
  Number.MAX_SAFE_INTEGER,
  CLOCK_SEED,
]
const SEED_TABLE = [
  ...EDGE_SEEDS,
  ...Array.from({ length: 96 }, (_, index) => 1_000 + index),
  ...Array.from({ length: 96 }, (_, index) => CLOCK_SEED + index * 997),
]
const LANES: readonly AdventureNodeLane[] = ['center', 'left', 'right']
/** Every non-boss node with each reward ordinal it can earn. */
const REWARD_SLOTS = Array.from({ length: ADVENTURE_MAX_REWARDS }, (_, tierIndex) => LANES.flatMap((lane) =>
  Array.from({ length: tierIndex + 1 }, (_, rewardOrdinal) => ({
    tierIndex,
    lane,
    sourceNodeId: adventureNodeId(tierIndex, lane),
    rewardOrdinal,
  })))).flat()

const NON_ID_VALUES: unknown[] = [
  '',
  ' second-wind',
  'second-wind ',
  'Second-Wind',
  'SECOND-WIND',
  'second_wind',
  'secondwind',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  0,
  1,
  Number.NaN,
  true,
  null,
  undefined,
  {},
  [],
  ['second-wind'],
  { toString: () => 'second-wind' },
]

function history(...entries: Array<[string, AdventureRewardId | null]>): AdventureRewardHistoryEntry[] {
  return entries.map(([sourceNodeId, rewardId]) => ({ sourceNodeId, rewardId }))
}

function holdings(relics: AdventureRelic[], rewardHistory: AdventureRewardHistoryEntry[]): AdventureRewardHoldings {
  return { relics, rewardHistory }
}

function offer(sourceNodeId: string, rewardOrdinal: number, choices: readonly AdventureRewardId[]): AdventureRewardOffer {
  return {
    rulesVersion: ADVENTURE_REWARD_RULES_VERSION,
    offerId: adventureRewardOfferId(sourceNodeId, rewardOrdinal),
    sourceNodeId,
    rewardOrdinal,
    choices,
  }
}

/** A history that skipped the first `count` tiers' offers, so every reward stays eligible. */
function skippedHistory(count: number): AdventureRewardHistoryEntry[] {
  return history(...Array.from({ length: count }, (_, tierIndex): [string, null] => [adventureNodeId(tierIndex, 'center'), null]))
}

/** A successful choose or skip result, frozen so later steps cannot change it. */
function expectProgress(result: AdventureRewardProgress | null): AdventureRewardProgress {
  expect(result).not.toBeNull()
  return deepFreeze(result as AdventureRewardProgress)
}

describe('Adventure reward catalog', () => {
  it('lists ten stable reward IDs in roadmap order', () => {
    expect(ADVENTURE_REWARD_IDS).toEqual([
      'second-wind',
      'guardian-sigil',
      'streak-anchor',
      'prepared-pack',
      'scout-cache',
      'gravebloom-charm',
      'signal-charm',
      'rooftop-charm',
      'echo-charm',
      'memory-charm',
    ])
    expect(ADVENTURE_REWARD_CATALOG.map((entry) => entry.id)).toEqual(ADVENTURE_REWARD_IDS)
    for (const entry of ADVENTURE_REWARD_CATALOG) {
      expect(adventureRewardCatalogEntry(entry.id)).toBe(entry)
    }
  })

  it('pins the rules version and limits', () => {
    expect(ADVENTURE_REWARD_RULES_VERSION).toBe(1)
    expect(ADVENTURE_REWARD_OFFER_SIZE).toBe(3)
    expect(ADVENTURE_MAX_REWARDS).toBe(6)
    expect(ADVENTURE_MAX_RELIC_CHARGES).toBe(2)
    expect(ADVENTURE_SECOND_WIND_LIMIT).toBe(2)
  })

  it('matches the roadmap names, kinds, caps and effects', () => {
    expect(ADVENTURE_REWARD_CATALOG.map(({ id, name, acquisition, effect }) => ({ id, name, acquisition, effect }))).toEqual([
      { id: 'second-wind', name: 'Second Wind', acquisition: { kind: 'boon', maxPicks: 2 }, effect: { kind: 'gain-chance' } },
      {
        id: 'guardian-sigil',
        name: 'Guardian Sigil',
        acquisition: { kind: 'charged-relic', maxCharges: 2 },
        effect: { kind: 'prevent-chance-loss' },
      },
      {
        id: 'streak-anchor',
        name: 'Streak Anchor',
        acquisition: { kind: 'charged-relic', maxCharges: 2 },
        effect: { kind: 'prevent-streak-reset' },
      },
      {
        id: 'prepared-pack',
        name: 'Prepared Pack',
        acquisition: { kind: 'unique-relic' },
        effect: { kind: 'opening-hand-bonus', cards: 1, scope: 'every-encounter' },
      },
      {
        id: 'scout-cache',
        name: "Scout's Cache",
        acquisition: { kind: 'charged-relic', maxCharges: 2 },
        effect: { kind: 'opening-hand-bonus', cards: 2, scope: 'next-encounter' },
      },
      {
        id: 'gravebloom-charm',
        name: 'Gravebloom Charm',
        acquisition: { kind: 'unique-relic' },
        effect: { kind: 'guarantee-creature', land: 'Forest' },
      },
      {
        id: 'signal-charm',
        name: 'Signal Charm',
        acquisition: { kind: 'unique-relic' },
        effect: { kind: 'guarantee-creature', land: 'Island' },
      },
      {
        id: 'rooftop-charm',
        name: 'Rooftop Charm',
        acquisition: { kind: 'unique-relic' },
        effect: { kind: 'guarantee-creature', land: 'Mountain' },
      },
      {
        id: 'echo-charm',
        name: 'Echo Charm',
        acquisition: { kind: 'unique-relic' },
        effect: { kind: 'guarantee-creature', land: 'Plains' },
      },
      {
        id: 'memory-charm',
        name: 'Memory Charm',
        acquisition: { kind: 'unique-relic' },
        effect: { kind: 'guarantee-creature', land: 'Swamp' },
      },
    ])
  })

  it('maps one charm to each creature in canonical land order and names it from the card catalog', () => {
    const charms = ADVENTURE_REWARD_CATALOG.flatMap((entry) => entry.effect.kind === 'guarantee-creature'
      ? [{ entry, land: entry.effect.land }]
      : [])
    expect(charms.map(({ land }) => land)).toEqual(BASIC_LANDS)
    for (const { entry, land } of charms) {
      expect(entry.rulesText).toContain(displayCardName(land))
    }
  })

  it('has unique, non-empty player-facing copy that never names a mechanical land key', () => {
    expect(new Set(ADVENTURE_REWARD_CATALOG.map((entry) => entry.name)).size).toBe(ADVENTURE_REWARD_CATALOG.length)
    for (const entry of ADVENTURE_REWARD_CATALOG) {
      for (const text of [entry.name, entry.rulesText]) {
        expect(text.trim()).toBe(text)
        expect(text.length).toBeGreaterThan(0)
        expect(text).not.toMatch(/\b(?:Forest|Island|Mountain|Plains|Swamp)\b/)
      }
    }
  })

  it('is deeply frozen', () => {
    expect(Object.isFrozen(ADVENTURE_REWARD_IDS)).toBe(true)
    expect(Object.isFrozen(ADVENTURE_REWARD_CATALOG)).toBe(true)
    for (const entry of ADVENTURE_REWARD_CATALOG) {
      expect(Object.isFrozen(entry), entry.id).toBe(true)
      expect(Object.isFrozen(entry.acquisition), entry.id).toBe(true)
      expect(Object.isFrozen(entry.effect), entry.id).toBe(true)
    }
  })
})

describe('Adventure reward ID guards', () => {
  it('accepts exactly the catalog IDs', () => {
    for (const id of ADVENTURE_REWARD_IDS) {
      expect(isAdventureRewardId(id), id).toBe(true)
    }
    for (const value of NON_ID_VALUES) {
      expect(isAdventureRewardId(value), String(value)).toBe(false)
      expect(isAdventureRelicId(value), String(value)).toBe(false)
      expect(isAdventureChargedRelicId(value), String(value)).toBe(false)
    }
  })

  it('classifies relics and charged relics from the catalog', () => {
    expect(ADVENTURE_REWARD_IDS.filter((id) => isAdventureRelicId(id))).toEqual(
      ADVENTURE_REWARD_CATALOG.filter((entry) => entry.acquisition.kind !== 'boon').map((entry) => entry.id),
    )
    expect(ADVENTURE_REWARD_IDS.filter((id) => isAdventureChargedRelicId(id))).toEqual([
      'guardian-sigil',
      'streak-anchor',
      'scout-cache',
    ])
    expect(isAdventureRelicId('second-wind')).toBe(false)
  })
})

describe('Adventure relic inventory guard', () => {
  const allRelics: AdventureRelic[] = [
    { id: 'guardian-sigil', charges: 2 },
    { id: 'streak-anchor', charges: 1 },
    { id: 'prepared-pack' },
    { id: 'scout-cache', charges: 2 },
    { id: 'gravebloom-charm' },
    { id: 'signal-charm' },
    { id: 'rooftop-charm' },
    { id: 'echo-charm' },
    { id: 'memory-charm' },
  ]

  it('accepts known relics in catalog order with valid charges', () => {
    expect(isAdventureRelicInventory([])).toBe(true)
    expect(isAdventureRelicInventory(allRelics)).toBe(true)
    expect(isAdventureRelicInventory([{ id: 'scout-cache', charges: 1 }, { id: 'memory-charm' }])).toBe(true)
    expect(isAdventureRelicInventory([{ id: 'prepared-pack', note: 'ignored' }])).toBe(true)
  })

  it('rejects unknown, duplicate, unordered and badly charged relics', () => {
    const rejected: unknown[] = [
      null,
      {},
      'guardian-sigil',
      [...allRelics, { id: 'memory-charm' }],
      [null],
      [[]],
      [{}],
      [{ id: 'second-wind' }],
      [{ id: 'unknown-relic' }],
      [{ id: 'Prepared-Pack' }],
      [{ id: '__proto__' }],
      [{ id: 'prepared-pack' }, { id: 'prepared-pack' }],
      [{ id: 'memory-charm' }, { id: 'prepared-pack' }],
      [{ id: 'scout-cache', charges: 1 }, { id: 'guardian-sigil', charges: 1 }],
      [{ id: 'guardian-sigil' }],
      [{ id: 'guardian-sigil', charges: 0 }],
      [{ id: 'guardian-sigil', charges: 3 }],
      [{ id: 'guardian-sigil', charges: 1.5 }],
      [{ id: 'guardian-sigil', charges: -1 }],
      [{ id: 'guardian-sigil', charges: Number.NaN }],
      [{ id: 'guardian-sigil', charges: Number.POSITIVE_INFINITY }],
      [{ id: 'guardian-sigil', charges: '1' }],
      [{ id: 'guardian-sigil', charges: null }],
      [{ id: 'prepared-pack', charges: 1 }],
      [{ id: 'prepared-pack', charges: undefined }],
      // A sparse slot reads as undefined.
      new Array(1),
    ]
    for (const value of rejected) {
      expect(isAdventureRelicInventory(value), JSON.stringify(value)).toBe(false)
    }
  })
})

describe('Adventure reward history guard', () => {
  it('accepts one entry per non-boss tier in tier order, including skips and gaps', () => {
    expect(isAdventureRewardHistory([])).toBe(true)
    expect(isAdventureRewardHistory(history(
      ['tier-1-center', 'second-wind'],
      ['tier-2-left', null],
      ['tier-3-center', 'guardian-sigil'],
      ['tier-4-right', 'guardian-sigil'],
      ['tier-5-center', 'second-wind'],
      ['tier-6-left', 'memory-charm'],
    ))).toBe(true)
    // A run migrated mid-route resolves offers only from later tiers.
    expect(isAdventureRewardHistory(history(['tier-3-center', 'prepared-pack'], ['tier-5-right', null]))).toBe(true)
    expect(isAdventureRewardHistory([{ sourceNodeId: 'tier-1-center', rewardId: null, note: 'ignored' }])).toBe(true)
  })

  it('lets a charged relic return once its charges are used', () => {
    const picks = ['tier-1-center', 'tier-2-center', 'tier-3-center', 'tier-4-center', 'tier-5-center', 'tier-6-center']
      .map((sourceNodeId): [string, AdventureRewardId] => [sourceNodeId, 'streak-anchor'])
    expect(isAdventureRewardHistory(history(...picks))).toBe(true)
  })

  it('rejects malformed entries, boss or repeated tiers, and capped rewards', () => {
    const rejected: unknown[] = [
      null,
      {},
      [null],
      ['tier-1-center'],
      [{ sourceNodeId: 'tier-1-center' }],
      [{ sourceNodeId: 'tier-1-center', rewardId: undefined }],
      [{ sourceNodeId: 'tier-1-center', rewardId: '' }],
      [{ sourceNodeId: 'tier-1-center', rewardId: 'Second-Wind' }],
      [{ sourceNodeId: 'tier-1-center', rewardId: '__proto__' }],
      [{ rewardId: null }],
      history(['tier-7-center', null]),
      history(['tier-0-center', null]),
      history(['tier-1-centre', null]),
      history(['TIER-1-CENTER', null]),
      history(['tier-2-left', null], ['tier-2-right', null]),
      history(['tier-3-center', null], ['tier-2-center', null]),
      history(['tier-1-center', null], ['tier-1-center', null]),
      history(['tier-1-center', 'second-wind'], ['tier-2-center', 'second-wind'], ['tier-3-center', 'second-wind']),
      history(['tier-1-center', 'prepared-pack'], ['tier-2-center', 'prepared-pack']),
      history(['tier-1-center', 'echo-charm'], ['tier-4-center', 'echo-charm']),
      [...history(
        ['tier-1-center', null],
        ['tier-2-center', null],
        ['tier-3-center', null],
        ['tier-4-center', null],
        ['tier-5-center', null],
        ['tier-6-center', null],
      ), { sourceNodeId: 'tier-6-left', rewardId: null }],
    ]
    for (const value of rejected) {
      expect(isAdventureRewardHistory(value), JSON.stringify(value)).toBe(false)
    }
  })
})

describe('Adventure reward holdings guard', () => {
  it('accepts relics that agree with the history', () => {
    expect(isAdventureRewardHoldings(holdings([], []))).toBe(true)
    expect(isAdventureRewardHoldings(holdings([], history(['tier-1-center', null], ['tier-2-center', 'second-wind'])))).toBe(true)
    expect(isAdventureRewardHoldings(holdings(
      [{ id: 'guardian-sigil', charges: 2 }, { id: 'prepared-pack' }],
      history(['tier-1-center', 'guardian-sigil'], ['tier-2-center', 'prepared-pack'], ['tier-3-center', 'guardian-sigil']),
    ))).toBe(true)
    // Used charges: one charge left after two picks, or none and removed.
    expect(isAdventureRewardHoldings(holdings(
      [{ id: 'scout-cache', charges: 1 }],
      history(['tier-1-center', 'scout-cache'], ['tier-2-center', 'scout-cache']),
    ))).toBe(true)
    expect(isAdventureRewardHoldings(holdings([], history(['tier-1-center', 'streak-anchor'])))).toBe(true)
  })

  it('rejects relics that the history does not explain, and lost passive relics', () => {
    const rejected: unknown[] = [
      null,
      [],
      { relics: [] },
      { rewardHistory: [] },
      holdings([{ id: 'prepared-pack' }], []),
      holdings([{ id: 'guardian-sigil', charges: 1 }], history(['tier-1-center', 'streak-anchor'])),
      holdings([{ id: 'guardian-sigil', charges: 2 }], history(['tier-1-center', 'guardian-sigil'])),
      holdings([], history(['tier-1-center', 'prepared-pack'])),
      holdings([], history(['tier-1-center', 'rooftop-charm'])),
      { relics: [{ id: 'prepared-pack', charges: 1 }], rewardHistory: history(['tier-1-center', 'prepared-pack']) },
      { relics: [], rewardHistory: history(['tier-7-center', null]) },
    ]
    for (const value of rejected) {
      expect(isAdventureRewardHoldings(value), JSON.stringify(value)).toBe(false)
    }
  })
})

describe('Adventure reward offer guard', () => {
  it('derives offer IDs from the reward ordinal and source node', () => {
    expect(adventureRewardOfferId('tier-1-center', 0)).toBe('reward-1-tier-1-center')
    expect(adventureRewardOfferId('tier-2-left', 1)).toBe('reward-2-tier-2-left')
    expect(adventureRewardOfferId('tier-6-right', 5)).toBe('reward-6-tier-6-right')
  })

  it('accepts current-version offers from non-boss nodes', () => {
    expect(isAdventureRewardOffer(offer('tier-1-center', 0, ['second-wind', 'prepared-pack', 'echo-charm']))).toBe(true)
    expect(isAdventureRewardOffer(offer('tier-6-right', 5, ['memory-charm', 'scout-cache', 'guardian-sigil']))).toBe(true)
    // Runs migrated mid-route resolve fewer offers than their tier index.
    expect(isAdventureRewardOffer(offer('tier-6-left', 0, ['memory-charm', 'scout-cache', 'guardian-sigil']))).toBe(true)
    expect(isAdventureRewardOffer({ ...offer('tier-2-left', 1, ['second-wind', 'signal-charm', 'echo-charm']), extra: true }))
      .toBe(true)
  })

  it('rejects other versions, sources, ordinals, IDs and choices', () => {
    const valid = offer('tier-3-left', 2, ['second-wind', 'prepared-pack', 'echo-charm'])
    const rejected: unknown[] = [
      null,
      [],
      { ...valid, rulesVersion: 0 },
      { ...valid, rulesVersion: 2 },
      { ...valid, rulesVersion: '1' },
      { ...offer('tier-7-center', 2, valid.choices) },
      { ...valid, sourceNodeId: 'tier-3-centre' },
      { ...valid, sourceNodeId: 'tier-3-center' },
      { ...valid, sourceNodeId: undefined },
      offer('tier-3-left', 3, valid.choices),
      offer('tier-3-left', -1, valid.choices),
      offer('tier-3-left', 1.5, valid.choices),
      { ...valid, rewardOrdinal: '2' },
      { ...valid, offerId: 'reward-2-tier-3-left' },
      { ...valid, offerId: undefined },
      { ...valid, choices: ['second-wind', 'prepared-pack'] },
      { ...valid, choices: ['second-wind', 'prepared-pack', 'echo-charm', 'memory-charm'] },
      { ...valid, choices: ['second-wind', 'second-wind', 'echo-charm'] },
      { ...valid, choices: ['second-wind', 'prepared-pack', 'Echo-Charm'] },
      { ...valid, choices: ['second-wind', 'prepared-pack', null] },
      { ...valid, choices: 'second-wind' },
      { ...valid, choices: undefined },
    ]
    for (const value of rejected) {
      expect(isAdventureRewardOffer(value), JSON.stringify(value)).toBe(false)
    }
  })
})

describe('Adventure reward clones', () => {
  it('returns detached copies of the known fields', () => {
    const guardian = { id: 'guardian-sigil' as const, charges: 1, note: 'dropped' }
    const pack = { id: 'prepared-pack' as const, note: 'dropped' }
    const relics: AdventureRelic[] = deepFreeze([guardian, pack])
    const relicCopy = cloneAdventureRelics(relics)
    expect(relicCopy).toEqual([{ id: 'guardian-sigil', charges: 1 }, { id: 'prepared-pack' }])
    expect(relicCopy).not.toBe(relics)
    expect(relicCopy[0]).not.toBe(relics[0])

    const skipped = { sourceNodeId: 'tier-1-center', rewardId: null, note: 'dropped' }
    const entries: AdventureRewardHistoryEntry[] = deepFreeze([skipped])
    const historyCopy = cloneAdventureRewardHistory(entries)
    expect(historyCopy).toEqual([{ sourceNodeId: 'tier-1-center', rewardId: null }])
    expect(historyCopy[0]).not.toBe(entries[0])

    const extended = { ...offer('tier-2-right', 1, ['second-wind', 'signal-charm', 'echo-charm']), note: 'dropped' }
    const pending: AdventureRewardOffer = deepFreeze(extended)
    const offerCopy = cloneAdventureRewardOffer(pending)
    expect(offerCopy).toEqual(offer('tier-2-right', 1, ['second-wind', 'signal-charm', 'echo-charm']))
    expect(offerCopy.choices).not.toBe(pending.choices)
  })
})

describe('Adventure reward eligibility', () => {
  function eligible(relics: AdventureRelic[], rewardHistory: AdventureRewardHistoryEntry[]): AdventureRewardId[] {
    return eligibleAdventureRewardIds(deepFreeze(holdings(relics, rewardHistory)))
  }

  it('offers every reward in catalog order at the start of a run', () => {
    expect(eligible([], [])).toEqual(ADVENTURE_REWARD_IDS)
  })

  it('caps Second Wind at two picks', () => {
    expect(eligible([], history(['tier-1-center', 'second-wind']))).toContain('second-wind')
    expect(eligible([], history(['tier-1-center', 'second-wind'], ['tier-2-center', 'second-wind']))).not.toContain('second-wind')
  })

  it('offers a charged relic below its maximum charges, including after a charge is used', () => {
    const picked = (count: number) => history(...Array.from(
      { length: count },
      (_, index): [string, AdventureRewardId] => [`tier-${index + 1}-center`, 'guardian-sigil'],
    ))
    expect(eligible([{ id: 'guardian-sigil', charges: 1 }], picked(1))).toContain('guardian-sigil')
    expect(eligible([{ id: 'guardian-sigil', charges: 2 }], picked(2))).not.toContain('guardian-sigil')
    expect(eligible([{ id: 'guardian-sigil', charges: 1 }], picked(2))).toContain('guardian-sigil')
    expect(eligible([], picked(2))).toContain('guardian-sigil')
  })

  it('offers a unique relic only until it is owned', () => {
    const owned = eligible([{ id: 'prepared-pack' }, { id: 'signal-charm' }], history(
      ['tier-1-center', 'prepared-pack'],
      ['tier-2-center', 'signal-charm'],
    ))
    expect(owned).toEqual(ADVENTURE_REWARD_IDS.filter((id) => id !== 'prepared-pack' && id !== 'signal-charm'))
    // Never re-offered while the history shows it, even if the inventory lost it.
    expect(eligible([], history(['tier-1-center', 'prepared-pack']))).not.toContain('prepared-pack')
  })
})

describe('Adventure reward offers', () => {
  it('pins offers for reference seeds', () => {
    const choices = (baseSeed: number, sourceNodeId: string, rewardOrdinal: number) =>
      generateAdventureRewardOffer(baseSeed, sourceNodeId, holdings([], skippedHistory(rewardOrdinal))).choices

    expect(generateAdventureRewardOffer(0, 'tier-1-center', holdings([], []))).toEqual({
      rulesVersion: 1,
      offerId: 'reward-1-tier-1-center',
      sourceNodeId: 'tier-1-center',
      rewardOrdinal: 0,
      choices: ['prepared-pack', 'guardian-sigil', 'gravebloom-charm'],
    })
    expect(choices(CLOCK_SEED, 'tier-2-left', 1)).toEqual(['streak-anchor', 'rooftop-charm', 'signal-charm'])
    expect(choices(Number.MAX_SAFE_INTEGER, 'tier-6-right', 5)).toEqual(['second-wind', 'prepared-pack', 'echo-charm'])
  })

  it('shuffles the whole catalog with the reward seed for every node and ordinal', () => {
    for (const seed of SEED_TABLE) {
      for (const { tierIndex, lane, sourceNodeId, rewardOrdinal } of REWARD_SLOTS) {
        const generated = generateAdventureRewardOffer(seed, sourceNodeId, holdings([], skippedHistory(rewardOrdinal)))

        expect(isAdventureRewardOffer(generated)).toBe(true)
        expect(generated.offerId).toBe(adventureRewardOfferId(sourceNodeId, rewardOrdinal))
        expect(generated.choices).toEqual(
          shuffle([...ADVENTURE_REWARD_IDS], adventureRewardSeed(seed, tierIndex, lane, rewardOrdinal))
            .slice(0, ADVENTURE_REWARD_OFFER_SIZE),
        )
      }
    }
  })

  it('offers the first three eligible rewards in shuffled order', () => {
    // Second Wind taken twice, Guardian Sigil at its maximum charges and Prepared Pack owned.
    const restricted = deepFreeze(holdings([{ id: 'guardian-sigil', charges: 2 }, { id: 'prepared-pack' }], history(
      ['tier-1-center', 'second-wind'],
      ['tier-2-left', 'guardian-sigil'],
      ['tier-3-right', 'second-wind'],
      ['tier-4-center', 'prepared-pack'],
      ['tier-5-left', 'guardian-sigil'],
    )))
    const eligible = eligibleAdventureRewardIds(restricted)
    expect(eligible).toHaveLength(ADVENTURE_REWARD_IDS.length - 3)

    for (const seed of SEED_TABLE) {
      for (const lane of LANES) {
        const generated = generateAdventureRewardOffer(seed, adventureNodeId(5, lane), restricted)

        expect(new Set(generated.choices).size).toBe(ADVENTURE_REWARD_OFFER_SIZE)
        expect(generated.choices.every((id) => eligible.includes(id))).toBe(true)
        expect(generated.choices).toEqual(
          shuffle([...ADVENTURE_REWARD_IDS], adventureRewardSeed(seed, 5, lane, 5))
            .filter((id) => eligible.includes(id))
            .slice(0, ADVENTURE_REWARD_OFFER_SIZE),
        )
      }
    }
  })

  it('returns equal, detached offers for equal inputs without changing them', () => {
    const input = deepFreeze(holdings([{ id: 'scout-cache', charges: 1 }], history(['tier-1-left', 'scout-cache'])))
    const before = JSON.stringify(input)
    const first = generateAdventureRewardOffer(CLOCK_SEED, 'tier-2-right', input)
    const second = generateAdventureRewardOffer(CLOCK_SEED, 'tier-2-right', input)

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second.choices).not.toBe(first.choices)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('seeds every node and ordinal separately', () => {
    // Seeds differ; offers may still match by chance, about once in 720.
    for (const seed of EDGE_SEEDS) {
      const seeds = REWARD_SLOTS.map(({ tierIndex, lane, rewardOrdinal }) => adventureRewardSeed(seed, tierIndex, lane, rewardOrdinal))
      expect(new Set(seeds).size).toBe(REWARD_SLOTS.length)
    }
  })

  it('offers each reward in about 30% of offers', () => {
    const counts = new Map<AdventureRewardId, number>()
    let offers = 0
    for (const seed of SEED_TABLE) {
      for (const { sourceNodeId, rewardOrdinal } of REWARD_SLOTS) {
        offers += 1
        for (const id of generateAdventureRewardOffer(seed, sourceNodeId, holdings([], skippedHistory(rewardOrdinal))).choices) {
          counts.set(id, (counts.get(id) ?? 0) + 1)
        }
      }
    }

    for (const id of ADVENTURE_REWARD_IDS) {
      const share = (counts.get(id) ?? 0) / offers
      expect(share, id).toBeGreaterThanOrEqual(0.25)
      expect(share, id).toBeLessThanOrEqual(0.35)
    }
  })

  it('rejects invalid holdings and seeds, malformed or boss nodes, and tiers already passed', () => {
    const empty = holdings([], [])
    const afterTierTwo = holdings([], history(['tier-2-center', null]))
    const invalidHoldings: unknown[] = [
      null,
      { relics: [] },
      holdings([{ id: 'guardian-sigil', charges: 3 }], history(['tier-1-center', 'guardian-sigil'])),
      holdings([{ id: 'echo-charm' }], []),
      holdings([], history(['tier-1-center', 'echo-charm'])),
      holdings([], history(['tier-7-center', null])),
    ]
    for (const value of invalidHoldings) {
      expect(() => generateAdventureRewardOffer(CLOCK_SEED, 'tier-1-center', value as AdventureRewardHoldings)).toThrow(RangeError)
    }
    for (const seed of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => generateAdventureRewardOffer(seed, 'tier-1-center', empty)).toThrow(RangeError)
    }
    for (const sourceNodeId of [
      'tier-7-center',
      'tier-0-center',
      'tier-8-center',
      'Tier-1-center',
      ' tier-1-center',
      'tier-1-centre',
      '',
      '__proto__',
      1,
      null,
    ]) {
      expect(() => generateAdventureRewardOffer(CLOCK_SEED, sourceNodeId as string, empty)).toThrow(RangeError)
    }
    // The rewarded node, another lane of its tier, and an earlier tier.
    for (const sourceNodeId of ['tier-2-center', 'tier-2-left', 'tier-1-right']) {
      expect(() => generateAdventureRewardOffer(CLOCK_SEED, sourceNodeId, afterTierTwo)).toThrow(RangeError)
    }
    // A third offer cannot come from the second tier: its ordinal would exceed the tier index.
    expect(() => generateAdventureRewardOffer(CLOCK_SEED, 'tier-2-right', holdings([], skippedHistory(2)))).toThrow(RangeError)
    expect(generateAdventureRewardOffer(CLOCK_SEED, 'tier-3-left', afterTierTwo).offerId).toBe('reward-2-tier-3-left')
  })
})

describe('Choosing and skipping Adventure rewards', () => {
  // Two offers resolved; the next offer comes from the third tier.
  const state = deepFreeze<AdventureRewardState>({
    remainingChances: 2,
    relics: [{ id: 'guardian-sigil', charges: 1 }, { id: 'echo-charm' }],
    rewardHistory: history(['tier-1-center', 'guardian-sigil'], ['tier-2-left', 'echo-charm']),
  })
  const nextOffer = deepFreeze(offer('tier-3-right', 2, ['second-wind', 'prepared-pack', 'guardian-sigil']))

  function resolvedHistory(rewardId: AdventureRewardId | null): AdventureRewardHistoryEntry[] {
    return [...state.rewardHistory, { sourceNodeId: 'tier-3-right', rewardId }]
  }

  it('applies Second Wind once as exactly one chance', () => {
    expect(chooseAdventureReward(state, nextOffer, 'second-wind')).toEqual({
      remainingChances: 3,
      relics: state.relics,
      rewardHistory: resolvedHistory('second-wind'),
    })
  })

  it('adds a unique relic in catalog order', () => {
    expect(chooseAdventureReward(state, nextOffer, 'prepared-pack')).toEqual({
      remainingChances: 2,
      relics: [{ id: 'guardian-sigil', charges: 1 }, { id: 'prepared-pack' }, { id: 'echo-charm' }],
      rewardHistory: resolvedHistory('prepared-pack'),
    })
  })

  it('adds a charge to a charged relic, or adds the relic with one charge', () => {
    expect(chooseAdventureReward(state, nextOffer, 'guardian-sigil')?.relics).toEqual([
      { id: 'guardian-sigil', charges: 2 },
      { id: 'echo-charm' },
    ])
    const scoutOffer = deepFreeze(offer('tier-3-right', 2, ['memory-charm', 'scout-cache', 'streak-anchor']))
    expect(chooseAdventureReward(state, scoutOffer, 'scout-cache')).toEqual({
      remainingChances: 2,
      relics: [{ id: 'guardian-sigil', charges: 1 }, { id: 'scout-cache', charges: 1 }, { id: 'echo-charm' }],
      rewardHistory: resolvedHistory('scout-cache'),
    })
  })

  it('records a skip without changing chances or relics', () => {
    expect(skipAdventureReward(state, nextOffer)).toEqual({
      remainingChances: 2,
      relics: state.relics,
      rewardHistory: resolvedHistory(null),
    })
  })

  it('returns exactly the three reward fields as detached copies', () => {
    const run = deepFreeze({ ...state, scoreEligibleChances: 7, winStreak: 4, status: 'active' })
    for (const result of [chooseAdventureReward(run, nextOffer, 'second-wind'), skipAdventureReward(run, nextOffer)]) {
      const progress = expectProgress(result)

      expect(Object.keys(progress)).toEqual(['remainingChances', 'relics', 'rewardHistory'])
      expect(progress.relics).not.toBe(run.relics)
      progress.relics.forEach((relic) => expect(run.relics).not.toContain(relic))
      expect(progress.rewardHistory).not.toBe(run.rewardHistory)
      progress.rewardHistory.forEach((entry) => expect(run.rewardHistory).not.toContain(entry))
    }
  })

  it('rejects choices that are not eligible rewards in the offer', () => {
    for (const choice of [...NON_ID_VALUES, 'streak-anchor', 'memory-charm']) {
      expect(chooseAdventureReward(state, nextOffer, choice), String(choice)).toBeNull()
    }

    // In the offer but capped: Second Wind taken twice, Guardian Sigil at two charges, Echo Charm owned.
    const capped = deepFreeze<AdventureRewardState>({
      remainingChances: 4,
      relics: [{ id: 'guardian-sigil', charges: 2 }, { id: 'echo-charm' }],
      rewardHistory: history(
        ['tier-1-center', 'second-wind'],
        ['tier-2-center', 'guardian-sigil'],
        ['tier-3-left', 'second-wind'],
        ['tier-4-center', 'guardian-sigil'],
        ['tier-5-right', 'echo-charm'],
      ),
    })
    const cappedOffer = deepFreeze(offer('tier-6-left', 5, ['second-wind', 'guardian-sigil', 'echo-charm']))
    for (const choice of cappedOffer.choices) {
      expect(chooseAdventureReward(capped, cappedOffer, choice), choice).toBeNull()
    }
    expect(skipAdventureReward(capped, cappedOffer)).not.toBeNull()
  })

  it('rejects Second Wind when the chance count cannot grow by one', () => {
    const crowded = deepFreeze({ ...state, remainingChances: Number.MAX_SAFE_INTEGER })

    expect(chooseAdventureReward(crowded, nextOffer, 'second-wind')).toBeNull()
    expect(chooseAdventureReward(crowded, nextOffer, 'prepared-pack')?.remainingChances).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects tampered offers and offers that are not the next one', () => {
    const offers: unknown[] = [
      null,
      undefined,
      'reward-3-tier-3-right',
      [],
      { ...nextOffer, rulesVersion: 2 },
      { ...nextOffer, offerId: 'reward-3-tier-3-left' },
      { ...nextOffer, choices: ['second-wind', 'second-wind', 'prepared-pack'] },
      { ...nextOffer, choices: ['second-wind', 'prepared-pack'] },
      { ...nextOffer, choices: ['second-wind', 'prepared-pack', 'guardian-sigil', 'echo-charm'] },
      { ...nextOffer, choices: ['second-wind', 'prepared-pack', 'Guardian-Sigil'] },
      offer('tier-7-center', 2, nextOffer.choices),
      offer('tier-3-right', 1, nextOffer.choices),
      offer('tier-4-right', 3, nextOffer.choices),
    ]
    for (const value of offers) {
      expect(chooseAdventureReward(state, value as AdventureRewardOffer, 'second-wind')).toBeNull()
      expect(skipAdventureReward(state, value as AdventureRewardOffer)).toBeNull()
    }

    // A tier that already earned a reward, through the rewarded node or another lane.
    const gapped = deepFreeze<AdventureRewardState>({
      remainingChances: 2,
      relics: [],
      rewardHistory: history(['tier-1-center', null], ['tier-3-left', null]),
    })
    for (const sourceNodeId of ['tier-3-left', 'tier-3-center']) {
      const repeated = offer(sourceNodeId, 2, nextOffer.choices)
      expect(isAdventureRewardOffer(repeated)).toBe(true)
      expect(chooseAdventureReward(gapped, repeated, 'second-wind')).toBeNull()
      expect(skipAdventureReward(gapped, repeated)).toBeNull()
    }
    expect(skipAdventureReward(gapped, offer('tier-4-center', 2, nextOffer.choices))).not.toBeNull()
  })

  it('rejects invalid chances, relics and histories', () => {
    const states: unknown[] = [
      null,
      { ...state, remainingChances: -1 },
      { ...state, remainingChances: 1.5 },
      { ...state, remainingChances: Number.NaN },
      { ...state, remainingChances: Number.POSITIVE_INFINITY },
      { ...state, remainingChances: '2' },
      { ...state, remainingChances: undefined },
      { ...state, relics: [{ id: 'echo-charm' }, { id: 'guardian-sigil', charges: 1 }] },
      { ...state, relics: [{ id: 'guardian-sigil', charges: 0 }, { id: 'echo-charm' }] },
      { ...state, relics: [{ id: 'guardian-sigil', charges: 2 }, { id: 'echo-charm' }] },
      { ...state, relics: [{ id: 'guardian-sigil', charges: 1 }] },
      { ...state, rewardHistory: history(['tier-1-center', 'guardian-sigil'], ['tier-7-center', 'echo-charm']) },
      { ...state, rewardHistory: 'none' },
    ]
    for (const value of states) {
      expect(chooseAdventureReward(value as AdventureRewardState, nextOffer, 'prepared-pack')).toBeNull()
      expect(skipAdventureReward(value as AdventureRewardState, nextOffer)).toBeNull()
    }
  })

  it('resolves each offer once', () => {
    for (const resolved of [
      expectProgress(chooseAdventureReward(state, nextOffer, 'prepared-pack')),
      expectProgress(skipAdventureReward(state, nextOffer)),
    ]) {
      for (const choice of nextOffer.choices) {
        expect(chooseAdventureReward(resolved, nextOffer, choice)).toBeNull()
      }
      expect(skipAdventureReward(resolved, nextOffer)).toBeNull()
      expect(skipAdventureReward(resolved, offer('tier-4-center', 3, nextOffer.choices))).not.toBeNull()
    }
  })
})

describe('Adventure relic charges', () => {
  const relics = deepFreeze<AdventureRelic[]>([
    { id: 'guardian-sigil', charges: 2 },
    { id: 'scout-cache', charges: 1 },
    { id: 'echo-charm' },
  ])

  it('uses one charge and removes a relic with its last charge', () => {
    const used = consumeAdventureRelicCharge(relics, 'guardian-sigil')

    expect(used).toEqual([{ id: 'guardian-sigil', charges: 1 }, { id: 'scout-cache', charges: 1 }, { id: 'echo-charm' }])
    used?.forEach((relic) => expect(relics).not.toContain(relic))
    expect(consumeAdventureRelicCharge(relics, 'scout-cache')).toEqual([
      { id: 'guardian-sigil', charges: 2 },
      { id: 'echo-charm' },
    ])
  })

  it('rejects relics without a charge and invalid inventories', () => {
    for (const id of ['streak-anchor', 'echo-charm', 'second-wind', 'Guardian-Sigil', '__proto__', null]) {
      expect(consumeAdventureRelicCharge(relics, id as AdventureChargedRelicId)).toBeNull()
    }
    for (const inventory of [
      null,
      [{ id: 'echo-charm' }, { id: 'guardian-sigil', charges: 1 }],
      [{ id: 'guardian-sigil', charges: 3 }],
      [{ id: 'guardian-sigil', charges: 1 }, { id: 'guardian-sigil', charges: 1 }],
    ]) {
      expect(consumeAdventureRelicCharge(inventory as AdventureRelic[], 'guardian-sigil')).toBeNull()
    }
  })
})

describe('Adventure loss protection', () => {
  /** Guardian Sigil and Streak Anchor charges, beside relics that never protect. */
  function protectedRelics(guardianCharges: number, anchorCharges: number): AdventureRelic[] {
    return [
      ...(guardianCharges > 0 ? [{ id: 'guardian-sigil' as const, charges: guardianCharges }] : []),
      ...(anchorCharges > 0 ? [{ id: 'streak-anchor' as const, charges: anchorCharges }] : []),
      { id: 'scout-cache', charges: 2 },
      { id: 'echo-charm' },
    ]
  }

  it('prevents only losses that would happen, using one charge for each', () => {
    const outcomes: AdventureEncounterOutcome[] = ['win', 'loss', 'draw']
    for (const outcome of outcomes) {
      for (const guardianCharges of [0, 1, 2]) {
        for (const anchorCharges of [0, 1, 2]) {
          for (const remainingChances of [0, 1, 3]) {
            for (const winStreak of [0, 2]) {
              const input = deepFreeze({ remainingChances, winStreak, relics: protectedRelics(guardianCharges, anchorCharges) })
              const loss = outcome === 'loss'
              const guarded = loss && remainingChances > 0 && guardianCharges > 0
              const anchored = loss && winStreak > 0 && anchorCharges > 0
              const result = applyAdventureLossProtection(input, outcome)

              expect(result, JSON.stringify([outcome, input])).toEqual({
                remainingChances: loss && !guarded ? Math.max(0, remainingChances - 1) : remainingChances,
                winStreak: loss && !anchored ? 0 : winStreak,
                relics: protectedRelics(guardianCharges - Number(guarded), anchorCharges - Number(anchored)),
                preventedChanceLoss: guarded,
                preventedStreakReset: anchored,
              })
              result.relics.forEach((relic) => expect(input.relics).not.toContain(relic))
            }
          }
        }
      }
    }
  })

  it('keeps both a chance and the win streak, removing relics with their last charge', () => {
    expect(applyAdventureLossProtection({
      remainingChances: 1,
      winStreak: 2,
      relics: [{ id: 'guardian-sigil', charges: 1 }, { id: 'streak-anchor', charges: 1 }],
    }, 'loss')).toEqual({
      remainingChances: 1,
      winStreak: 2,
      relics: [],
      preventedChanceLoss: true,
      preventedStreakReset: true,
    })
  })

  it('costs a chance and resets the streak without protection', () => {
    expect(applyAdventureLossProtection({ remainingChances: 3, winStreak: 2, relics: [{ id: 'echo-charm' }] }, 'loss')).toEqual({
      remainingChances: 2,
      winStreak: 0,
      relics: [{ id: 'echo-charm' }],
      preventedChanceLoss: false,
      preventedStreakReset: false,
    })
  })

  it('treats unknown outcomes like a draw', () => {
    const input = deepFreeze({ remainingChances: 1, winStreak: 2, relics: protectedRelics(1, 1) })

    expect(applyAdventureLossProtection(input, 'forfeit' as AdventureEncounterOutcome)).toEqual({
      ...input,
      preventedChanceLoss: false,
      preventedStreakReset: false,
    })
  })

  it('rejects invalid counters and relics', () => {
    const valid = { remainingChances: 1, winStreak: 2, relics: protectedRelics(1, 1) }
    for (const value of [
      null,
      { ...valid, remainingChances: -1 },
      { ...valid, remainingChances: 1.5 },
      { ...valid, remainingChances: Number.NaN },
      { ...valid, winStreak: -1 },
      { ...valid, winStreak: Number.POSITIVE_INFINITY },
      { ...valid, winStreak: '2' },
      { ...valid, relics: [{ id: 'guardian-sigil', charges: 3 }] },
      { ...valid, relics: [{ id: 'streak-anchor', charges: 1 }, { id: 'guardian-sigil', charges: 1 }] },
      { ...valid, relics: undefined },
    ]) {
      expect(() => applyAdventureLossProtection(value as AdventureLossProtectionState, 'loss')).toThrow(RangeError)
    }
  })
})

describe('Reachable Adventure reward states', () => {
  const chargedRelics = ADVENTURE_REWARD_IDS.filter((id): id is AdventureChargedRelicId => isAdventureChargedRelicId(id))

  /**
   * Adds a state and every state reached from it by using charges one at a
   * time. States with the same relics and Second Wind count are offered the
   * same rewards, so the first one stands for all of them.
   */
  function addReachable(level: Map<string, AdventureRewardProgress>, state: AdventureRewardProgress): void {
    const secondWinds = state.rewardHistory.filter((entry) => entry.rewardId === 'second-wind').length
    const key = JSON.stringify([state.relics, secondWinds])
    if (level.has(key)) return
    level.set(key, deepFreeze(state))
    for (const id of chargedRelics) {
      const relics = consumeAdventureRelicCharge(state.relics, id)
      if (relics !== null) addReachable(level, { ...state, relics })
    }
  }

  it('keeps at least three eligible rewards for every offer, and every state passes the guards', () => {
    let level = new Map<string, AdventureRewardProgress>()
    addReachable(level, { remainingChances: 3, relics: [], rewardHistory: [] })
    const levelSizes: number[] = []

    for (let rewardOrdinal = 0; ; rewardOrdinal += 1) {
      levelSizes.push(level.size)
      for (const state of level.values()) {
        expect(isAdventureRewardHoldings(state)).toBe(true)
      }
      if (rewardOrdinal === ADVENTURE_MAX_REWARDS) break

      const sourceNodeId = adventureNodeId(rewardOrdinal, 'center')
      const next = new Map<string, AdventureRewardProgress>()
      for (const state of level.values()) {
        const eligible = eligibleAdventureRewardIds(state)
        expect(eligible.length).toBeGreaterThanOrEqual(ADVENTURE_REWARD_OFFER_SIZE)
        const generated = generateAdventureRewardOffer(CLOCK_SEED, sourceNodeId, state)
        expect(generated.choices.every((id) => eligible.includes(id))).toBe(true)

        addReachable(next, expectProgress(skipAdventureReward(state, generated)))
        for (const id of eligible) {
          const others = eligible.filter((other) => other !== id).slice(0, ADVENTURE_REWARD_OFFER_SIZE - 1)
          addReachable(next, expectProgress(chooseAdventureReward(state, offer(sourceNodeId, rewardOrdinal, [id, ...others]), id)))
        }
      }
      level = next
    }

    // Distinct (relics, Second Wind count) pairs after each number of resolved offers.
    expect(levelSizes).toEqual([1, 11, 60, 216, 576, 1212, 2098])
  })
})

describe('adventure rewards module boundary', () => {
  const source = readFileSync(resolve(__dirname, '..', 'app', 'adventure-rewards.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('imports only game cards and types, the map module, the card catalog and the shared validators', () => {
    const specifiers = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])

    expect(new Set(specifiers)).toEqual(new Set([
      '../game/cards',
      '../game/types',
      './adventure-map',
      './card-catalog',
      './validators',
    ]))
  })

  it('reads no randomness, clock, storage, DOM or string hashes', () => {
    for (const forbidden of [
      /\bMath\.random\b/,
      /\bDate\b/,
      /\bperformance\b/,
      /\bcrypto\b/,
      /\blocalStorage\b/,
      /\bdocument\b/,
      /\bwindow\b/,
      /\.charCodeAt\b/,
      /\.codePointAt\b/,
    ]) {
      expect(code).not.toMatch(forbidden)
    }
  })

  it('keeps reward IDs and names out of the game engine', () => {
    const gameDir = resolve(__dirname, '..', 'game')
    const sources = [gameDir, resolve(gameDir, 'ai-policies')].flatMap((dir) => readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({ name, source: readFileSync(resolve(dir, name), 'utf8') })))

    expect(sources.length).toBeGreaterThanOrEqual(13)
    for (const { name, source: gameSource } of sources) {
      for (const reward of ADVENTURE_REWARD_CATALOG) {
        expect(gameSource, name).not.toContain(reward.id)
        expect(gameSource, name).not.toContain(reward.name)
      }
    }
  })
})
