import { describe, expect, it } from 'vitest'
import { BASIC_LANDS } from '../game/types'
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
  cloneAdventureRelics,
  cloneAdventureRewardHistory,
  cloneAdventureRewardOffer,
  eligibleAdventureRewardIds,
  isAdventureChargedRelicId,
  isAdventureRelicId,
  isAdventureRelicInventory,
  isAdventureRewardHistory,
  isAdventureRewardHoldings,
  isAdventureRewardId,
  isAdventureRewardOffer,
  type AdventureRelic,
  type AdventureRewardHistoryEntry,
  type AdventureRewardHoldings,
  type AdventureRewardId,
  type AdventureRewardOffer,
} from '../app/adventure-rewards'
import { displayCardName } from '../app/card-catalog'
import { deepFreeze } from './helpers/deep-freeze'

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
