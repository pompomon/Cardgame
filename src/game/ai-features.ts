import type { BasicLand, GameState } from './types'

// Position features and the win-probability evaluator for AI search. The
// value of a position for a player is a logistic model of the differences
// between that player's features and the opponent's, so the two players'
// values always sum to one. The weights live in `ai-weights.ts` and are fitted
// on self-play outcomes by the opt-in tuning tool.
//
// Extraction reuses module-level scratch buffers and allocates nothing, so
// rollouts can call it for every candidate action.

/** Feature names in weight order. Each feature is computed for both players. */
export const AI_FEATURE_NAMES = [
  'unique',
  'kind',
  'atThree',
  'atFour',
  'need',
  'gap',
  'winNow',
  'winNowToMove',
  'winNowUnanswerable',
  'twoWinners',
  'outsUnique',
  'outsKind',
  'drawOuts',
  'hand',
  'canCounter',
  'counterTwice',
  'islands',
  'mountainThreat',
  'mountainVsFour',
  'swamp',
  'swampOnWinner',
  'plainsReuse',
  'forestReturn',
  'toMove',
] as const

export type AiFeatureName = (typeof AI_FEATURE_NAMES)[number]

export const AI_FEATURE_COUNT = AI_FEATURE_NAMES.length

const F = Object.freeze(
  Object.fromEntries(AI_FEATURE_NAMES.map((name, index) => [name, index])) as Record<AiFeatureName, number>,
)

export type AiWeights = Readonly<Record<AiFeatureName, number>>

/** The weights as a vector in `AI_FEATURE_NAMES` order. */
export function weightVector(weights: AiWeights): Float64Array {
  return Float64Array.from(AI_FEATURE_NAMES, (name) => weights[name])
}

/**
 * What the evaluating player cannot see. `hiddenHandSeat` is a seat whose
 * hand contents are unknown (only its size counts), or -1. `maskedCardId` is
 * a card counted only for hand size, such as a card an Island just drew in a
 * sampled world, so choices stay blind to the sampled deck order.
 */
export interface AiFeatureView {
  readonly hiddenHandSeat: number
  readonly maskedCardId: string | undefined
}

export const FULL_VIEW: AiFeatureView = Object.freeze({ hiddenHandSeat: -1, maskedCardId: undefined })

const NAMES = 5
const ZONE_BATTLEFIELD = 0
const ZONE_HAND = NAMES
const ZONE_GRAVEYARD = 2 * NAMES
const ZONE_DECK = 3 * NAMES
const SIDE_STRIDE = 4 * NAMES

const FOREST = 0
const ISLAND = 1
const MOUNTAIN = 2
const PLAINS = 3
const SWAMP = 4

// Per-side summary slots.
const S_UNIQUE = 0
const S_KIND = 1
const S_BEST = 2
const S_WIN_MASK = 3
const S_WIN_CARDS = 4
const S_HAND = 5
const S_DECK = 6
const S_CAN_COUNTER = 7
const S_MOUNTAIN = 8
const S_SWAMP = 9
const S_FOREST = 10
const S_HIDDEN = 11
const SUMMARY_STRIDE = 12

const counts = new Int32Array(2 * SIDE_STRIDE)
const maskedDraws = new Int32Array(2)
const summary = new Int32Array(2 * SUMMARY_STRIDE)
const sideFeatures = new Float64Array(2 * AI_FEATURE_COUNT)
const differences = new Float64Array(AI_FEATURE_COUNT)

function nameIndex(name: BasicLand): number {
  switch (name) {
    case 'Forest':
      return FOREST
    case 'Island':
      return ISLAND
    case 'Mountain':
      return MOUNTAIN
    case 'Plains':
      return PLAINS
    case 'Swamp':
      return SWAMP
    default:
      return -1
  }
}

// A masked card is counted with the deck it was drawn from, so the deck
// makeup does not reveal it either.
function countSide(state: GameState, side: number, maskedCardId: string | undefined): void {
  const base = side * SIDE_STRIDE
  counts.fill(0, base, base + SIDE_STRIDE)
  maskedDraws[side] = 0
  const player = state.players[side]
  for (const entry of player.battlefield) {
    const index = nameIndex(entry.card.name)
    if (index >= 0) counts[base + ZONE_BATTLEFIELD + index] += 1
  }
  for (const card of player.hand) {
    const index = nameIndex(card.name)
    if (index < 0) continue
    if (card.id === maskedCardId) {
      counts[base + ZONE_DECK + index] += 1
      maskedDraws[side] = 1
    } else {
      counts[base + ZONE_HAND + index] += 1
    }
  }
  for (const card of player.graveyard) {
    const index = nameIndex(card.name)
    if (index >= 0) counts[base + ZONE_GRAVEYARD + index] += 1
  }
  for (const card of player.deck) {
    const index = nameIndex(card.name)
    if (index >= 0) counts[base + ZONE_DECK + index] += 1
  }
}

function summarizeSide(state: GameState, side: number, hidden: boolean): void {
  const base = side * SIDE_STRIDE
  const out = side * SUMMARY_STRIDE
  let unique = 0
  let kind = 0
  for (let name = 0; name < NAMES; name += 1) {
    const onBoard = counts[base + ZONE_BATTLEFIELD + name]
    if (onBoard > 0) unique += 1
    if (onBoard > kind) kind = onBoard
  }
  let winMask = 0
  let winCards = 0
  for (let name = 0; name < NAMES; name += 1) {
    const onBoard = counts[base + ZONE_BATTLEFIELD + name]
    if ((unique === 4 && onBoard === 0) || onBoard === 4) {
      winMask |= 1 << name
      winCards += counts[base + ZONE_HAND + name]
    }
  }
  const hand = (name: number) => counts[base + ZONE_HAND + name]
  const board = (name: number) => counts[base + ZONE_BATTLEFIELD + name]
  const player = state.players[side]
  summary[out + S_UNIQUE] = unique
  summary[out + S_KIND] = kind
  summary[out + S_BEST] = Math.max(unique, kind)
  summary[out + S_WIN_MASK] = winMask
  summary[out + S_WIN_CARDS] = hidden ? 0 : winCards
  summary[out + S_HAND] = player.hand.length
  summary[out + S_DECK] = player.deck.length
  summary[out + S_CAN_COUNTER] = !hidden && hand(ISLAND) > 0 && player.hand.length >= 2 ? 1 : 0
  summary[out + S_MOUNTAIN] = !hidden && (hand(MOUNTAIN) > 0 || (hand(PLAINS) > 0 && board(MOUNTAIN) > 0)) ? 1 : 0
  summary[out + S_SWAMP] = !hidden && (hand(SWAMP) > 0 || (hand(PLAINS) > 0 && board(SWAMP) > 0)) ? 1 : 0
  summary[out + S_FOREST] = !hidden && (hand(FOREST) > 0 || (hand(PLAINS) > 0 && board(FOREST) > 0)) ? 1 : 0
  summary[out + S_HIDDEN] = hidden ? 1 : 0
}

function writeSideFeatures(side: number, isMover: boolean): void {
  const base = side * SIDE_STRIDE
  const own = side * SUMMARY_STRIDE
  const other = (1 - side) * SUMMARY_STRIDE
  const out = side * AI_FEATURE_COUNT
  const hidden = summary[own + S_HIDDEN] === 1
  const otherHidden = summary[other + S_HIDDEN] === 1
  const unique = summary[own + S_UNIQUE]
  const kind = summary[own + S_KIND]
  const best = summary[own + S_BEST]
  const winCards = summary[own + S_WIN_CARDS]
  const handSize = summary[own + S_HAND]
  const deckSize = summary[own + S_DECK]
  const hand = (name: number) => (hidden ? 0 : counts[base + ZONE_HAND + name])
  const board = (name: number) => counts[base + ZONE_BATTLEFIELD + name]

  // The next draw comes from the deck, or from the deck and a hidden hand
  // pooled together, because only the deck list is public.
  const drawPool = deckSize + (hidden ? handSize : maskedDraws[side])
  let supportUnique = 0
  let gap = 5 - unique
  let outsKind = 0
  let usefulGraveyard = 0
  let poolWinners = 0
  for (let name = 0; name < NAMES; name += 1) {
    const onBoard = board(name)
    if (onBoard === 0 && hand(name) > 0) supportUnique += 1
    gap = Math.min(gap, Math.max(0, 5 - onBoard - hand(name)))
    if (kind > 0 && onBoard === kind) outsKind = Math.max(outsKind, Math.min(hand(name), 5 - kind))
    if (onBoard === 0 || (kind >= 2 && onBoard === kind)) usefulGraveyard += counts[base + ZONE_GRAVEYARD + name]
    if ((summary[own + S_WIN_MASK] & (1 << name)) !== 0) {
      poolWinners += counts[base + ZONE_DECK + name] + (hidden ? counts[base + ZONE_HAND + name] : 0)
    }
  }
  gap = Math.min(gap, Math.max(0, 5 - unique - supportUnique))
  const winNow = winCards > 0
  const otherBest = summary[other + S_BEST]

  sideFeatures[out + F.unique] = unique / 5
  sideFeatures[out + F.kind] = kind / 5
  sideFeatures[out + F.atThree] = best >= 3 ? 1 : 0
  sideFeatures[out + F.atFour] = best >= 4 ? 1 : 0
  sideFeatures[out + F.need] = (5 - best) / 5
  sideFeatures[out + F.gap] = gap / 5
  sideFeatures[out + F.winNow] = winNow ? 1 : 0
  sideFeatures[out + F.winNowToMove] = winNow && isMover ? 1 : 0
  sideFeatures[out + F.winNowUnanswerable] = winNow && isMover && !otherHidden && summary[other + S_CAN_COUNTER] === 0 ? 1 : 0
  sideFeatures[out + F.twoWinners] = winCards >= 2 ? 1 : 0
  sideFeatures[out + F.outsUnique] = Math.min(supportUnique, 5 - unique) / 5
  sideFeatures[out + F.outsKind] = outsKind / 5
  sideFeatures[out + F.drawOuts] = drawPool > 0 ? poolWinners / drawPool : 0
  sideFeatures[out + F.hand] = Math.min(handSize, 10) / 8
  sideFeatures[out + F.canCounter] = summary[own + S_CAN_COUNTER]
  sideFeatures[out + F.counterTwice] = !hidden && hand(ISLAND) >= 2 && handSize >= 4 ? 1 : 0
  sideFeatures[out + F.islands] = Math.min(hand(ISLAND), 3) / 3
  sideFeatures[out + F.mountainThreat] = summary[own + S_MOUNTAIN] === 1 ? otherBest / 5 : 0
  // The opponent's mirror of this, being at four against a Mountain, would
  // only negate it in the difference, so it is not a separate feature.
  sideFeatures[out + F.mountainVsFour] = summary[own + S_MOUNTAIN] === 1 && otherBest >= 4 ? 1 : 0
  sideFeatures[out + F.swamp] = summary[own + S_SWAMP] === 1 && summary[other + S_HAND] > 0 ? 1 : 0
  sideFeatures[out + F.swampOnWinner] = summary[own + S_SWAMP] === 1 && !otherHidden && summary[other + S_WIN_CARDS] === 1 ? 1 : 0
  sideFeatures[out + F.plainsReuse] = hand(PLAINS) > 0 && board(MOUNTAIN) + board(SWAMP) + board(FOREST) + board(ISLAND) > 0 ? 1 : 0
  sideFeatures[out + F.forestReturn] = summary[own + S_FOREST] === 1 && usefulGraveyard > 0 ? 1 : 0
  sideFeatures[out + F.toMove] = isMover ? 1 : 0
}

/**
 * Writes `f(perspective) − f(opponent)` for every feature into `out`.
 * `toMove` is the player who acts next; callers pass it because a position
 * evaluated at the end of a turn is scored before the next draw.
 */
export function featureDifferences(
  state: GameState,
  perspective: number,
  toMove: number,
  out: Float64Array,
  view: AiFeatureView = FULL_VIEW,
): void {
  for (let side = 0; side < 2; side += 1) {
    countSide(state, side, view.maskedCardId)
  }
  for (let side = 0; side < 2; side += 1) {
    summarizeSide(state, side, side === view.hiddenHandSeat)
  }
  for (let side = 0; side < 2; side += 1) {
    writeSideFeatures(side, side === toMove)
  }
  const own = perspective * AI_FEATURE_COUNT
  const other = (1 - perspective) * AI_FEATURE_COUNT
  for (let index = 0; index < AI_FEATURE_COUNT; index += 1) {
    out[index] = sideFeatures[own + index] - sideFeatures[other + index]
  }
}

/** The logistic function, clamped away from overflow. */
export function sigmoid(logit: number): number {
  if (logit >= 40) return 1
  if (logit <= -40) return 0
  return 1 / (1 + Math.exp(-logit))
}

/**
 * The probability that `perspective` wins: 1, 0 or 0.5 once the game is
 * over, otherwise the logistic model of the feature differences.
 */
export function evaluatePosition(
  state: GameState,
  perspective: number,
  toMove: number,
  weights: Float64Array,
  view: AiFeatureView = FULL_VIEW,
): number {
  if (state.winner !== null) {
    if (state.winner === perspective) return 1
    if (state.winner === 'draw') return 0.5
    return 0
  }
  featureDifferences(state, perspective, toMove, differences, view)
  let logit = 0
  for (let index = 0; index < AI_FEATURE_COUNT; index += 1) {
    logit += weights[index] * differences[index]
  }
  return sigmoid(logit)
}
