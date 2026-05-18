// Shared structural validators used by every `src/app/` module that
// accepts untrusted input (localStorage payloads, imported recordings,
// P2P messages).
//
// The invariants enforced here are the ones called out in
// `docs/agent/state-and-persistence.md`:
//
//  - Reject non-finite numbers (`Infinity` / `NaN` from `JSON.parse`).
//  - Reject negatives and fractions for counters that the engine treats
//    as non-negative integers.
//  - Cap arrays from the **tail** (most recent), not the head, so log
//    capping preserves the entries users care about.
//  - Provide a recognised idiom for "validate every element of a
//    discriminated union" so guards do not duplicate the pattern.

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

export function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteInteger(value) && (value as number) >= 0
}

export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteInteger(value) && (value as number) >= min && (value as number) <= max
}

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Cap an array, keeping the **tail** (most recent entries). Mirrors the
 * convention required by `docs/agent/state-and-persistence.md`:
 *
 *   raw.slice(raw.length - max)
 *
 * Capping from the head silently drops the entries users care about.
 */
export function capTail<T>(values: readonly T[], max: number): T[] {
  if (max <= 0) {
    return []
  }
  if (values.length <= max) {
    return values.slice()
  }
  return values.slice(values.length - max)
}

/**
 * Validate every element of an array against a per-element guard, dropping
 * elements that fail. Returns a new array of validated elements (capped to
 * `max` entries from the tail when provided).
 */
export function filterValid<T>(
  values: unknown,
  isValid: (entry: unknown) => entry is T,
  options: { max?: number } = {},
): T[] {
  if (!Array.isArray(values)) {
    return []
  }
  const source = options.max !== undefined ? capTail(values, options.max) : values
  const out: T[] = []
  for (const entry of source) {
    if (isValid(entry)) {
      out.push(entry)
    }
  }
  return out
}
