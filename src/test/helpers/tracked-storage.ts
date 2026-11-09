/** An in-memory `localStorage` that logs writes and can refuse chosen keys. */
export interface TrackedStorage {
  readonly data: Map<string, string>
  /** Every write and removal, in order, as `set:<key>` / `remove:<key>`. */
  readonly calls: string[]
  readonly failingSets: Set<string>
  readonly failingRemoves: Set<string>
  readonly failingGets: Set<string>
}

/**
 * Installs a fresh tracked `localStorage` holding `seed`. Refused writes and
 * removals are still logged, then throw like a full or locked browser store.
 */
export function installTrackedStorage(seed: Record<string, string> = {}): TrackedStorage {
  const tracked: TrackedStorage = {
    data: new Map(Object.entries(seed)),
    calls: [],
    failingSets: new Set(),
    failingRemoves: new Set(),
    failingGets: new Set(),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => {
        if (tracked.failingGets.has(key)) {
          throw new Error('storage locked')
        }
        return tracked.data.get(key) ?? null
      },
      setItem: (key: string, value: string) => {
        tracked.calls.push(`set:${key}`)
        if (tracked.failingSets.has(key)) {
          throw new Error('quota exceeded')
        }
        tracked.data.set(key, String(value))
      },
      removeItem: (key: string) => {
        tracked.calls.push(`remove:${key}`)
        if (tracked.failingRemoves.has(key)) {
          throw new Error('storage locked')
        }
        tracked.data.delete(key)
      },
      clear: () => {
        tracked.data.clear()
      },
    },
  })
  return tracked
}
