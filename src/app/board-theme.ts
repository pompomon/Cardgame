import { readStorageItem, writeStorageItem } from './safe-storage'

const STORAGE_KEY = 'cardgame.board-theme'

export const BOARD_THEMES = ['classic', 'moonlit', 'verdant'] as const

export type BoardTheme = typeof BOARD_THEMES[number]

export const DEFAULT_BOARD_THEME: BoardTheme = 'classic'

const BOARD_THEME_LABELS: Record<BoardTheme, string> = {
  classic: 'Classic',
  moonlit: 'Moonlit',
  verdant: 'Verdant',
}

export const BOARD_THEME_OPTIONS: ReadonlyArray<{
  readonly value: BoardTheme
  readonly label: string
}> = BOARD_THEMES.map((value) => ({
  value,
  label: BOARD_THEME_LABELS[value],
}))

export function isBoardTheme(value: unknown): value is BoardTheme {
  return typeof value === 'string'
    && (BOARD_THEMES as readonly string[]).includes(value)
}

export function persistBoardTheme(theme: BoardTheme): void {
  writeStorageItem(STORAGE_KEY, theme)
}

export function readStoredBoardTheme(): BoardTheme {
  const value = readStorageItem(STORAGE_KEY)
  return isBoardTheme(value) ? value : DEFAULT_BOARD_THEME
}
