import { beforeEach, describe, expect, it } from 'vitest'
import {
  BOARD_THEME_OPTIONS,
  DEFAULT_BOARD_THEME,
  isBoardTheme,
  persistBoardTheme,
  readStoredBoardTheme,
} from '../app/board-theme'

function installMemoryStorage(): void {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
      removeItem: (key: string) => { map.delete(key) },
      clear: () => { map.clear() },
    },
  })
}

describe('board-theme', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('exposes immutable board theme options and default', () => {
    expect(BOARD_THEME_OPTIONS.map((entry) => entry.value)).toEqual(['classic', 'moonlit', 'verdant'])
    expect(DEFAULT_BOARD_THEME).toBe('classic')
  })

  it('validates board theme values', () => {
    expect(isBoardTheme('classic')).toBe(true)
    expect(isBoardTheme('moonlit')).toBe(true)
    expect(isBoardTheme('verdant')).toBe(true)
    expect(isBoardTheme('unknown')).toBe(false)
    expect(isBoardTheme(null)).toBe(false)
  })

  it('round-trips stored board themes and falls back on invalid/malformed values', () => {
    expect(readStoredBoardTheme()).toBe(DEFAULT_BOARD_THEME)
    persistBoardTheme('moonlit')
    expect(readStoredBoardTheme()).toBe('moonlit')
    localStorage.setItem('cardgame.board-theme', 'invalid')
    expect(readStoredBoardTheme()).toBe(DEFAULT_BOARD_THEME)
    localStorage.setItem('cardgame.board-theme', '{"broken":"json-shape"}')
    expect(readStoredBoardTheme()).toBe(DEFAULT_BOARD_THEME)
  })
})
