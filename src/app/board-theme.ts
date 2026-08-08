import { readStorageItem, writeStorageItem } from './safe-storage'

const STORAGE_KEY = 'cardgame.board-theme'

export const BOARD_THEME_OPTIONS = [
  { value: 'classic', label: 'Classic' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'parchment', label: 'Parchment' },
] as const

export type BoardTheme = typeof BOARD_THEME_OPTIONS[number]['value']

export const DEFAULT_BOARD_THEME: BoardTheme = 'classic'

export function isBoardTheme(value: unknown): value is BoardTheme {
  return typeof value === 'string'
    && BOARD_THEME_OPTIONS.some((option) => option.value === value)
}

export function persistBoardTheme(theme: BoardTheme): void {
  writeStorageItem(STORAGE_KEY, theme)
}

export function readStoredBoardTheme(): BoardTheme {
  const value = readStorageItem(STORAGE_KEY)
  return isBoardTheme(value) ? value : DEFAULT_BOARD_THEME
}
