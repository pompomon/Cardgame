// Adventure reward rules: the reward catalog, guards for reward data,
// eligibility, deterministic offers, choosing or skipping an offer, relic
// charges and loss protection.
//
// This is a leaf module. It imports game types, the map module, the card
// catalog and the shared validators, never `adventure.ts`, persistence, the
// controller, storage or the DOM. Run progression does not call it yet.

import type { BasicLand } from '../game/types'
import { ADVENTURE_TIER_COUNT, parseAdventureNodeId } from './adventure-map'
import { displayCardName } from './card-catalog'
import { isIntegerInRange, isRecordObject } from './validators'

/**
 * Version of the reward rules: the catalog and its order, offer seeds and
 * reward effects. Changing any of them changes what a seed offers.
 */
export const ADVENTURE_REWARD_RULES_VERSION = 1
/** Choices in every offer. Skipping is a separate action. */
export const ADVENTURE_REWARD_OFFER_SIZE = 3
/** At most one reward for each non-boss tier. */
export const ADVENTURE_MAX_REWARDS = ADVENTURE_TIER_COUNT - 1
/** Most charges one charged relic holds. */
export const ADVENTURE_MAX_RELIC_CHARGES = 2
/** Most times one run may take Second Wind. */
export const ADVENTURE_SECOND_WIND_LIMIT = 2

/** Every reward in catalog order. The order is part of the rules version. */
export const ADVENTURE_REWARD_IDS = Object.freeze([
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
] as const)

export type AdventureRewardId = (typeof ADVENTURE_REWARD_IDS)[number]
export type AdventureRelicId = Exclude<AdventureRewardId, 'second-wind'>
export type AdventureChargedRelicId = 'guardian-sigil' | 'streak-anchor' | 'scout-cache'
export type AdventurePassiveRelicId = Exclude<AdventureRelicId, AdventureChargedRelicId>

/**
 * How a reward is held. A boon applies once when chosen and may be chosen
 * up to `maxPicks` times. A unique relic is owned at most once. Each pick of
 * a charged relic adds one charge, up to `maxCharges`; the relic is removed
 * when its last charge is used.
 */
export type AdventureRewardAcquisition =
  | { readonly kind: 'boon'; readonly maxPicks: number }
  | { readonly kind: 'unique-relic' }
  | { readonly kind: 'charged-relic'; readonly maxCharges: number }

/**
 * What a reward does. Every effect applies at a run transition or while
 * setting up an encounter, never during a game.
 */
export type AdventureRewardEffect =
  | { readonly kind: 'gain-chance' }
  | { readonly kind: 'prevent-chance-loss' }
  | { readonly kind: 'prevent-streak-reset' }
  | { readonly kind: 'opening-hand-bonus'; readonly cards: number; readonly scope: 'every-encounter' | 'next-encounter' }
  | { readonly kind: 'guarantee-creature'; readonly land: BasicLand }

export interface AdventureRewardCatalogEntry {
  readonly id: AdventureRewardId
  /** Player-facing name: plain text that renderers escape. */
  readonly name: string
  /** Player-facing effect text: plain text that renderers escape. */
  readonly rulesText: string
  readonly acquisition: AdventureRewardAcquisition
  readonly effect: AdventureRewardEffect
}

/** An owned relic. A charged relic holds 1 charge up to its maximum. */
export type AdventureRelic =
  | { readonly id: AdventurePassiveRelicId }
  | { readonly id: AdventureChargedRelicId; readonly charges: number }

export interface AdventureRewardHistoryEntry {
  /** The non-boss node whose win earned the reward. */
  readonly sourceNodeId: string
  /** The chosen reward, or null when the offer was skipped. */
  readonly rewardId: AdventureRewardId | null
}

/** The reward data of a run that eligibility and offers read. */
export interface AdventureRewardHoldings {
  /** Owned relics in catalog order. */
  readonly relics: readonly AdventureRelic[]
  /** One entry for each resolved offer, in tier order. */
  readonly rewardHistory: readonly AdventureRewardHistoryEntry[]
}

export interface AdventureRewardOffer {
  readonly rulesVersion: typeof ADVENTURE_REWARD_RULES_VERSION
  /** `reward-<rewardOrdinal + 1>-<sourceNodeId>`; see `adventureRewardOfferId`. */
  readonly offerId: string
  /** The non-boss node whose win earned the offer. */
  readonly sourceNodeId: string
  /** Offers the run resolved before this one: 0 up to the source tier index. */
  readonly rewardOrdinal: number
  /** Distinct reward IDs in offer order. */
  readonly choices: readonly AdventureRewardId[]
}

function defineReward(entry: AdventureRewardCatalogEntry): AdventureRewardCatalogEntry {
  return Object.freeze({
    ...entry,
    acquisition: Object.freeze({ ...entry.acquisition }),
    effect: Object.freeze({ ...entry.effect }),
  })
}

/** A charm guarantees one creature, named from the card catalog. */
function defineCharm(id: AdventurePassiveRelicId, name: string, land: BasicLand): AdventureRewardCatalogEntry {
  return defineReward({
    id,
    name,
    rulesText: `Your future opening hands include at least one ${displayCardName(land)}.`,
    acquisition: { kind: 'unique-relic' },
    effect: { kind: 'guarantee-creature', land },
  })
}

const REWARDS = Object.freeze({
  'second-wind': defineReward({
    id: 'second-wind',
    name: 'Second Wind',
    rulesText: 'Gain one chance.',
    acquisition: { kind: 'boon', maxPicks: ADVENTURE_SECOND_WIND_LIMIT },
    effect: { kind: 'gain-chance' },
  }),
  'guardian-sigil': defineReward({
    id: 'guardian-sigil',
    name: 'Guardian Sigil',
    rulesText: 'The next time a loss would cost a chance, keep it. Uses one charge.',
    acquisition: { kind: 'charged-relic', maxCharges: ADVENTURE_MAX_RELIC_CHARGES },
    effect: { kind: 'prevent-chance-loss' },
  }),
  'streak-anchor': defineReward({
    id: 'streak-anchor',
    name: 'Streak Anchor',
    rulesText: 'The next time a loss would reset your win streak, keep it. Uses one charge.',
    acquisition: { kind: 'charged-relic', maxCharges: ADVENTURE_MAX_RELIC_CHARGES },
    effect: { kind: 'prevent-streak-reset' },
  }),
  'prepared-pack': defineReward({
    id: 'prepared-pack',
    name: 'Prepared Pack',
    rulesText: 'Draw one extra opening card in every future encounter.',
    acquisition: { kind: 'unique-relic' },
    effect: { kind: 'opening-hand-bonus', cards: 1, scope: 'every-encounter' },
  }),
  'scout-cache': defineReward({
    id: 'scout-cache',
    name: "Scout's Cache",
    rulesText: 'Draw two extra opening cards in your next encounter. Uses one charge when it starts.',
    acquisition: { kind: 'charged-relic', maxCharges: ADVENTURE_MAX_RELIC_CHARGES },
    effect: { kind: 'opening-hand-bonus', cards: 2, scope: 'next-encounter' },
  }),
  'gravebloom-charm': defineCharm('gravebloom-charm', 'Gravebloom Charm', 'Forest'),
  'signal-charm': defineCharm('signal-charm', 'Signal Charm', 'Island'),
  'rooftop-charm': defineCharm('rooftop-charm', 'Rooftop Charm', 'Mountain'),
  'echo-charm': defineCharm('echo-charm', 'Echo Charm', 'Plains'),
  'memory-charm': defineCharm('memory-charm', 'Memory Charm', 'Swamp'),
} satisfies Readonly<Record<AdventureRewardId, AdventureRewardCatalogEntry>>)

/** The reward catalog in `ADVENTURE_REWARD_IDS` order, deeply frozen. */
export const ADVENTURE_REWARD_CATALOG: readonly AdventureRewardCatalogEntry[] = Object.freeze(
  ADVENTURE_REWARD_IDS.map((id) => REWARDS[id]),
)

/** The catalog entry of a known reward ID. */
export function adventureRewardCatalogEntry(id: AdventureRewardId): AdventureRewardCatalogEntry {
  return REWARDS[id]
}

/** A known reward ID. Case and whitespace variants are unknown. */
export function isAdventureRewardId(value: unknown): value is AdventureRewardId {
  return typeof value === 'string' && (ADVENTURE_REWARD_IDS as readonly string[]).includes(value)
}

export function isAdventureRelicId(value: unknown): value is AdventureRelicId {
  if (!isAdventureRewardId(value)) return false
  const kind = REWARDS[value].acquisition.kind
  return kind === 'unique-relic' || kind === 'charged-relic'
}

export function isAdventureChargedRelicId(value: unknown): value is AdventureChargedRelicId {
  return isAdventureRewardId(value) && REWARDS[value].acquisition.kind === 'charged-relic'
}

const ADVENTURE_RELIC_COUNT = ADVENTURE_REWARD_IDS.filter((id) => isAdventureRelicId(id)).length

function catalogRank(id: AdventureRewardId): number {
  return ADVENTURE_REWARD_IDS.indexOf(id)
}

function maxRelicCharges(id: AdventureChargedRelicId): number {
  const acquisition = REWARDS[id].acquisition
  return acquisition.kind === 'charged-relic' ? acquisition.maxCharges : 0
}

/** The charges an owned relic holds, or 0 when it is not an owned charged relic. */
function relicCharges(relics: readonly AdventureRelic[], id: AdventureRewardId): number {
  const relic = relics.find((entry) => entry.id === id)
  return relic !== undefined && 'charges' in relic ? relic.charges : 0
}

/**
 * Most times one reward may appear in a history. A charged relic can be
 * chosen again after its charges are used, so only the reward count limits it.
 */
function rewardPickLimit(id: AdventureRewardId): number {
  const acquisition = REWARDS[id].acquisition
  switch (acquisition.kind) {
    case 'boon':
      return acquisition.maxPicks
    case 'unique-relic':
      return 1
    case 'charged-relic':
      return ADVENTURE_MAX_REWARDS
    default:
      return 0
  }
}

function rewardPickCounts(history: readonly AdventureRewardHistoryEntry[]): Map<AdventureRewardId, number> {
  const picks = new Map<AdventureRewardId, number>()
  for (const entry of history) {
    if (entry.rewardId !== null) {
      picks.set(entry.rewardId, (picks.get(entry.rewardId) ?? 0) + 1)
    }
  }
  return picks
}

function isRewardTier(tierIndex: number): boolean {
  return tierIndex < ADVENTURE_TIER_COUNT - 1
}

/**
 * Guard for a relic inventory: known relic IDs in strictly increasing
 * catalog order, so each relic appears at most once. A charged relic holds
 * an integer number of charges from 1 to its maximum; a passive relic has
 * no `charges` key. Other unknown keys are ignored.
 */
export function isAdventureRelicInventory(value: unknown): value is AdventureRelic[] {
  if (!Array.isArray(value) || value.length > ADVENTURE_RELIC_COUNT) return false
  let previousRank = -1
  for (const relic of value) {
    if (!isRecordObject(relic)) return false
    const id = relic.id
    if (!isAdventureRelicId(id) || catalogRank(id) <= previousRank) return false
    previousRank = catalogRank(id)
    if (isAdventureChargedRelicId(id)) {
      if (!isIntegerInRange(relic.charges, 1, maxRelicCharges(id))) return false
    } else if ('charges' in relic) {
      return false
    }
  }
  return true
}

/**
 * Guard for a reward history: at most one entry for each non-boss tier, in
 * strictly increasing tier order. Each entry names its source node and the
 * chosen reward ID, or null for a skip. Second Wind appears at most twice
 * and each unique relic at most once. Unknown keys are ignored.
 */
export function isAdventureRewardHistory(value: unknown): value is AdventureRewardHistoryEntry[] {
  if (!Array.isArray(value) || value.length > ADVENTURE_MAX_REWARDS) return false
  const picks = new Map<AdventureRewardId, number>()
  let previousTierIndex = -1
  for (const entry of value) {
    if (!isRecordObject(entry)) return false
    const source = parseAdventureNodeId(entry.sourceNodeId)
    if (source === null || !isRewardTier(source.tierIndex) || source.tierIndex <= previousTierIndex) return false
    previousTierIndex = source.tierIndex
    const rewardId = entry.rewardId
    if (rewardId === null) continue
    if (!isAdventureRewardId(rewardId)) return false
    const count = (picks.get(rewardId) ?? 0) + 1
    if (count > rewardPickLimit(rewardId)) return false
    picks.set(rewardId, count)
  }
  return true
}

/**
 * Guard for the relics and reward history of a run, checked together. Both
 * pass their own guards, every owned relic was chosen at least as many
 * times as it holds charges (a passive relic counts as one), and every
 * passive relic in the history is still owned. A charged relic may be
 * missing once its charges are used. Which nodes the history may name is a
 * run-level check.
 */
export function isAdventureRewardHoldings(value: unknown): value is AdventureRewardHoldings {
  if (!isRecordObject(value)) return false
  const { relics, rewardHistory } = value
  if (!isAdventureRelicInventory(relics) || !isAdventureRewardHistory(rewardHistory)) return false
  const picks = rewardPickCounts(rewardHistory)
  for (const relic of relics) {
    if ((picks.get(relic.id) ?? 0) < ('charges' in relic ? relic.charges : 1)) return false
  }
  for (const id of picks.keys()) {
    if (isAdventureRelicId(id) && !isAdventureChargedRelicId(id) && !relics.some((relic) => relic.id === id)) {
      return false
    }
  }
  return true
}

/** The offer ID for a source node and reward ordinal. */
export function adventureRewardOfferId(sourceNodeId: string, rewardOrdinal: number): string {
  return `reward-${rewardOrdinal + 1}-${sourceNodeId}`
}

/**
 * Guard for an offer of the current rules version. Its source is a non-boss
 * node, its ordinal is at most the source's tier index (one offer for each
 * earlier tier), its ID follows `adventureRewardOfferId`, and it holds
 * exactly three distinct known reward IDs. Unknown keys are ignored.
 */
export function isAdventureRewardOffer(value: unknown): value is AdventureRewardOffer {
  if (!isRecordObject(value) || value.rulesVersion !== ADVENTURE_REWARD_RULES_VERSION) return false
  const { sourceNodeId, rewardOrdinal, choices } = value
  const source = parseAdventureNodeId(sourceNodeId)
  if (source === null || typeof sourceNodeId !== 'string' || !isRewardTier(source.tierIndex)) return false
  if (!isIntegerInRange(rewardOrdinal, 0, source.tierIndex)) return false
  if (value.offerId !== adventureRewardOfferId(sourceNodeId, rewardOrdinal)) return false
  return Array.isArray(choices)
    && choices.length === ADVENTURE_REWARD_OFFER_SIZE
    && choices.every((choice) => isAdventureRewardId(choice))
    && new Set(choices).size === choices.length
}

function cloneRelic(relic: AdventureRelic): AdventureRelic {
  return 'charges' in relic ? { id: relic.id, charges: relic.charges } : { id: relic.id }
}

/** Detached copies of the known relic fields; unknown keys are dropped. */
export function cloneAdventureRelics(relics: readonly AdventureRelic[]): AdventureRelic[] {
  return relics.map(cloneRelic)
}

/** Detached copies of the known history fields; unknown keys are dropped. */
export function cloneAdventureRewardHistory(
  history: readonly AdventureRewardHistoryEntry[],
): AdventureRewardHistoryEntry[] {
  return history.map((entry) => ({ sourceNodeId: entry.sourceNodeId, rewardId: entry.rewardId }))
}

/** A detached copy of the known offer fields; unknown keys are dropped. */
export function cloneAdventureRewardOffer(offer: AdventureRewardOffer): AdventureRewardOffer {
  return {
    rulesVersion: offer.rulesVersion,
    offerId: offer.offerId,
    sourceNodeId: offer.sourceNodeId,
    rewardOrdinal: offer.rewardOrdinal,
    choices: [...offer.choices],
  }
}

function isRewardEligible(
  id: AdventureRewardId,
  relics: readonly AdventureRelic[],
  picks: ReadonlyMap<AdventureRewardId, number>,
): boolean {
  const acquisition = REWARDS[id].acquisition
  switch (acquisition.kind) {
    case 'boon':
      return (picks.get(id) ?? 0) < acquisition.maxPicks
    case 'unique-relic':
      return !picks.has(id) && !relics.some((relic) => relic.id === id)
    case 'charged-relic':
      return relicCharges(relics, id) < acquisition.maxCharges
    default:
      return false
  }
}

/**
 * Rewards that can be offered now, in catalog order: Second Wind until it
 * was taken twice, a unique relic until it is owned, and a charged relic
 * until it holds its maximum charges.
 */
export function eligibleAdventureRewardIds(holdings: AdventureRewardHoldings): AdventureRewardId[] {
  const picks = rewardPickCounts(holdings.rewardHistory)
  return ADVENTURE_REWARD_IDS.filter((id) => isRewardEligible(id, holdings.relics, picks))
}
