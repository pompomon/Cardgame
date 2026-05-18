import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readJsonStorageItem,
  readStorageItem,
  removeStorageItem,
  writeJsonStorageItem,
  writeStorageItem,
} from '../app/safe-storage'

interface MemoryStore {
  data: Map<string, string>
  shouldThrowOnGet: boolean
  shouldThrowOnSet: boolean
  shouldThrowOnRemove: boolean
}

function installMemoryLocalStorage(): MemoryStore {
  const store: MemoryStore = {
    data: new Map<string, string>(),
    shouldThrowOnGet: false,
    shouldThrowOnSet: false,
    shouldThrowOnRemove: false,
  }
  const stub = {
    getItem(key: string): string | null {
      if (store.shouldThrowOnGet) throw new Error('storage unavailable')
      return store.data.has(key) ? (store.data.get(key) as string) : null
    },
    setItem(key: string, value: string): void {
      if (store.shouldThrowOnSet) throw new Error('storage quota')
      store.data.set(key, String(value))
    },
    removeItem(key: string): void {
      if (store.shouldThrowOnRemove) throw new Error('storage unavailable')
      store.data.delete(key)
    },
    clear(): void { store.data.clear() },
    key(): string | null { return null },
    length: 0,
  }
  vi.stubGlobal('localStorage', stub)
  return store
}

describe('safe-storage', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = installMemoryLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips simple string values', () => {
    expect(writeStorageItem('k', 'v')).toBe(true)
    expect(readStorageItem('k')).toBe('v')
    expect(removeStorageItem('k')).toBe(true)
    expect(readStorageItem('k')).toBeNull()
  })

  it('returns null on getItem when storage throws', () => {
    store.data.set('k', 'v')
    store.shouldThrowOnGet = true
    expect(readStorageItem('k')).toBeNull()
  })

  it('returns false on setItem when storage throws', () => {
    store.shouldThrowOnSet = true
    expect(writeStorageItem('k', 'v')).toBe(false)
  })

  it('returns false on removeItem when storage throws but does not propagate', () => {
    store.shouldThrowOnRemove = true
    expect(removeStorageItem('k')).toBe(false)
  })

  it('round-trips JSON values', () => {
    expect(writeJsonStorageItem('k', { a: 1, b: [2, 3] })).toBe(true)
    expect(readJsonStorageItem('k')).toEqual({ a: 1, b: [2, 3] })
  })

  it('returns null from readJsonStorageItem when entry is missing', () => {
    expect(readJsonStorageItem('missing')).toBeNull()
  })

  it('returns null from readJsonStorageItem on malformed JSON', () => {
    store.data.set('k', '{not json')
    expect(readJsonStorageItem('k')).toBeNull()
  })

  it('returns false from writeJsonStorageItem on circular structures', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(writeJsonStorageItem('k', circular)).toBe(false)
  })
})
