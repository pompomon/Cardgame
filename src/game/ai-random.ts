// Seeded randomness for AI decisions.
//
// AI choices must be reproducible from the game state, the acting seat, the
// game seed and the search budget. The CLI characterization fixtures, tests
// and resuming a saved game rely on that. AI modules therefore take all
// randomness from this module and never call `Math.random()` or read a clock;
// `src/test/ai-randomness-sources.test.ts` enforces it.

import type { GameState } from './types'

/** A deterministic pseudo-random stream (mulberry32). */
export interface AiRng {
  /** The next uniform unsigned 32-bit integer. */
  nextUint32(): number
  /** The next uniform number in [0, 1). */
  next(): number
  /** The next uniform integer in [0, bound), for a positive integer bound. */
  nextInt(bound: number): number
}

const UINT32_RANGE = 4294967296

/** Independent random streams of one decision. */
export const AI_RANDOM_STREAM = Object.freeze({
  search: 1,
  selection: 2,
  persona: 3,
})

/**
 * Creates a stream from a 32-bit seed; larger seeds keep only their low 32
 * bits. Derive stream seeds with `deriveAiSeed` so every bit of a game seed
 * counts.
 */
export function createAiRng(seed: number): AiRng {
  let value = seed >>> 0
  const nextUint32 = (): number => {
    value = (value + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(value ^ (value >>> 15), value | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return (mixed ^ (mixed >>> 14)) >>> 0
  }
  const next = (): number => nextUint32() / UINT32_RANGE
  return {
    nextUint32,
    next,
    nextInt: (bound) => Math.floor(next() * bound),
  }
}

/** Shuffles `items` in place (Fisher-Yates) and returns it. */
export function shuffleInPlace<T>(items: T[], rng: AiRng): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = rng.nextInt(index + 1)
    const item = items[index]
    items[index] = items[swap]
    items[swap] = item
  }
  return items
}

// The murmur3 32-bit finalizer.
function fmix32(value: number): number {
  let hash = value >>> 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return hash >>> 0
}

function mixWord(hash: number, word: number): number {
  return fmix32(Math.imul(hash ^ word, 0x9e3779b1) + 0x7f4a7c15)
}

// Mixes in a whole number. Non-finite values count as 0 and fractions are
// truncated. Both 32-bit halves count, so `Date.now()` seeds that differ by
// a multiple of 2^32 still give different streams; the sign counts too.
function mixNumber(hash: number, value: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : 0
  const magnitude = Math.min(Math.abs(integer), Number.MAX_SAFE_INTEGER)
  const low = magnitude >>> 0
  const high = Math.floor(magnitude / UINT32_RANGE) + (integer < 0 ? 0x200000 : 0)
  return mixWord(mixWord(hash, low), high)
}

// Mixes in a string through its FNV-1a hash and its length.
function mixString(hash: number, text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193)
  }
  return mixWord(mixWord(hash, value >>> 0), text.length)
}

function mixSortedStrings(hash: number, values: string[]): number {
  values.sort()
  let mixed = mixNumber(hash, values.length)
  for (const value of values) {
    mixed = mixString(mixed, value)
  }
  return mixed
}

/**
 * Derives a 32-bit stream seed from a base seed and any number of whole-number
 * words, such as a seat, a decision fingerprint or an `AI_RANDOM_STREAM` tag.
 */
export function deriveAiSeed(base: number, ...words: readonly number[]): number {
  let hash = mixNumber(0x2545f491, base)
  for (const word of words) {
    hash = mixNumber(hash, word)
  }
  return hash
}

const PHASE_CODES: Readonly<Record<GameState['phase'], number>> = {
  main: 0,
  respond: 1,
  plains_target: 2,
  swamp_target: 3,
  gameOver: 4,
}

/**
 * Hashes what `actor` can see at a decision: public zones, its own hand and
 * the sizes of hidden zones. Card ids are sorted, so the order of cards
 * within a zone does not matter. Logs and events are left out because saves
 * cap them, and deck order is left out because no player can see it.
 */
export function decisionFingerprint(state: GameState, actor: number): number {
  let hash = mixNumber(0x6a09e667, actor)
  hash = mixNumber(hash, state.turn)
  hash = mixNumber(hash, state.currentPlayer)
  hash = mixNumber(hash, state.nextInstanceId)
  hash = mixNumber(hash, PHASE_CODES[state.phase] ?? -1)
  const pending = state.pendingLandPlay
  hash = mixString(hash, pending ? `${pending.actor}|${pending.card.id}|${pending.effectTargetId ?? ''}` : '')
  const reuse = state.pendingPlainsReuse
  hash = mixString(hash, reuse ? `${reuse.actor}|${reuse.reusedInstanceId}` : '')
  hash = mixNumber(hash, state.pendingSwampDiscard ? state.pendingSwampDiscard.actor : -1)
  state.players.forEach((player, seat) => {
    hash = mixNumber(hash, player.landsPlayedThisTurn)
    hash = mixNumber(hash, player.deck.length)
    hash = mixNumber(hash, player.hand.length)
    hash = mixSortedStrings(hash, player.battlefield.map((entry) => `${entry.instanceId}|${entry.card.id}`))
    hash = mixSortedStrings(hash, player.graveyard.map((card) => card.id))
    if (seat === actor) {
      hash = mixSortedStrings(hash, player.hand.map((card) => card.id))
    }
  })
  return hash
}
