import { beforeEach, describe, expect, it } from 'vitest'
import {
  BOARD_THEME_OPTIONS,
  DEFAULT_BOARD_THEME,
  isBoardTheme,
  persistBoardTheme,
  readStoredBoardTheme,
} from '../app/board-theme'

function installMemoryStorage(): void {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
    },
  })
}

describe('board-theme', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('exposes immutable theme options and a compatibility-preserving default', () => {
    expect(BOARD_THEME_OPTIONS).toEqual([
      { value: 'classic', label: 'Classic' },
      { value: 'midnight', label: 'Midnight' },
      { value: 'parchment', label: 'Parchment' },
    ])
    expect(DEFAULT_BOARD_THEME).toBe('classic')
  })

  it('validates only declared board themes', () => {
    for (const option of BOARD_THEME_OPTIONS) {
      expect(isBoardTheme(option.value)).toBe(true)
    }
    expect(isBoardTheme('unknown')).toBe(false)
    expect(isBoardTheme(null)).toBe(false)
    expect(isBoardTheme({ value: 'classic' })).toBe(false)
  })

  it('defaults missing settings and round-trips valid persisted values', () => {
    expect(readStoredBoardTheme()).toBe(DEFAULT_BOARD_THEME)
    persistBoardTheme('midnight')
    expect(readStoredBoardTheme()).toBe('midnight')
  })

  it('rejects invalid and malformed persisted values', () => {
    localStorage.setItem('cardgame.board-theme', 'future-theme')
    expect(readStoredBoardTheme()).toBe(DEFAULT_BOARD_THEME)
    localStorage.setItem('cardgame.board-theme', '{"value":"midnight"}')
    expect(readStoredBoardTheme()).toBe(DEFAULT_BOARD_THEME)
  })
})
