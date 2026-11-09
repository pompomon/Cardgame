/**
 * Freezes a value and everything reachable from it, so a test fails if code
 * under test mutates its input. An already frozen object is not descended.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}
