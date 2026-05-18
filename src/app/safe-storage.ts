// Thin wrapper around `localStorage` that swallows access errors uniformly.
//
// Browsers throw on `localStorage` access in private modes, when storage is
// disabled, or when quota is exceeded. Every module in `src/app/` used to
// reimplement the same `try { ... } catch { ... }` boilerplate around
// `getItem`/`setItem`/`removeItem`. This helper centralises that pattern
// so:
//   - storage-unavailable handling is consistent,
//   - callers can chain `?? defaultValue` without nested try/catch,
//   - future telemetry / "storage unavailable" warnings can hook in here
//     in one place (see AGENTS.md rule #9 — status message ordering).
//
// The helper deliberately does NOT validate JSON shapes — callers must
// still pass the parsed value through a guard from `app/validators.ts`
// before trusting it.

export function readStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Returns true on success, false if storage rejected the write. */
export function writeStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Returns true on success, false if storage rejected the removal. */
export function removeStorageItem(key: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * Read a JSON value from storage and return the parsed result, or `null`
 * if the entry is missing, storage is unavailable, or the JSON is
 * malformed. The caller is responsible for validating the shape of the
 * parsed value (use `app/validators.ts`).
 */
export function readJsonStorageItem(key: string): unknown {
  const raw = readStorageItem(key)
  if (raw === null) {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeJsonStorageItem(key: string, value: unknown): boolean {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    // JSON.stringify can throw on circular structures. Treat as a write
    // failure rather than letting it propagate into UI code.
    return false
  }
  if (typeof serialized !== 'string') {
    // `JSON.stringify(undefined)` and stringify of a function/symbol
    // return `undefined` (no throw). Persisting that would coerce to the
    // literal string "undefined" via `setItem`, which `readJsonStorageItem`
    // would later treat as malformed. Treat it as a write failure so
    // callers can react instead of silently corrupting storage.
    return false
  }
  return writeStorageItem(key, serialized)
}
