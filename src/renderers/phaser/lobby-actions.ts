// Pure lobby action models and predicates: the shared "what rows/entries
// does the lobby show right now" logic, decoupled from Phaser rendering.
// `lobby-scene.ts` maps these into buttons; `a11y-navigation.ts` reuses the
// predicates (`isAdventureResumable`, `selectedAiLevelLabel`) so the visible
// and accessible surfaces can never drift apart — see
// docs/agent/phaser-renderer.md "A11y submenu predicates must mirror the
// visible-button predicates".
import { AI_LEVEL_OPTIONS } from '../../app/ai-levels'
import { ANIMATION_SPEED_OPTIONS, DEFAULT_ANIMATION_SPEED } from '../../app/animation-settings'
import { BOARD_THEME_OPTIONS, DEFAULT_BOARD_THEME } from '../../app/board-theme'
import { CARD_VISUAL_STYLE_OPTIONS, DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import { DEFAULT_RENDER_QUALITY_PREFERENCE, RENDER_QUALITY_PREFERENCE_OPTIONS } from '../../app/render-quality'
import type { AdventureUiState, AnimationSpeed, BoardTheme, CardVisualStyle, Mode, RenderQualityPreference } from '../../app/types'
import type { AiLevel } from '../../game/ai-levels'

// Mode entries shown on the lobby root menu. Shared with the a11y nav so the
// two surfaces can never drift out of sync.
export const LOBBY_MODE_OPTIONS: Array<{ mode: Mode; label: string }> = [
  { mode: 'tutorial', label: 'Tutorial (Learn to Play)' },
  { mode: 'local-hvh', label: 'Local Human vs Human' },
  { mode: 'local-hvai', label: 'Local Human vs AI' },
  { mode: 'local-aivai', label: 'Local AI vs AI' },
  { mode: 'adventure-hvai', label: 'Adventure (Human vs AI)' },
  { mode: 'p2p-host', label: 'P2P Host' },
  { mode: 'p2p-join', label: 'P2P Join' },
]

export function isAdventureResumable(adventure: AdventureUiState | undefined): boolean {
  return !!adventure?.hasSavedRun && (adventure.status === 'paused' || adventure.status === 'active')
}

export function hasSavedAdventureRun(adventure: AdventureUiState | undefined): boolean {
  return !!adventure?.hasSavedRun
}

export function selectedAiLevelLabel(aiLevel: AiLevel | undefined): string {
  const selected = aiLevel ?? 'basic'
  return AI_LEVEL_OPTIONS.find((option) => option.value === selected)?.label ?? 'Basic'
}

export type LobbyRootRow =
  | { kind: 'start-mode'; label: string; mode: Mode }
  | { kind: 'open-settings'; label: string }
  | { kind: 'open-recording'; label: string }
  | { kind: 'resume-adventure'; label: string }
  | { kind: 'reset-adventure'; label: string }
  | { kind: 'install'; label: string; disabled: boolean }
  | { kind: 'switch-renderer'; label: string }

export interface LobbyRootRowsParams {
  adventure: AdventureUiState | undefined
  installLabel: string
  installDisabled: boolean
}

export function buildLobbyRootRows(params: LobbyRootRowsParams): LobbyRootRow[] {
  const rows: LobbyRootRow[] = []
  for (const entry of LOBBY_MODE_OPTIONS) {
    rows.push({ kind: 'start-mode', label: entry.label, mode: entry.mode })
  }
  rows.push({ kind: 'open-settings', label: 'Settings' })
  rows.push({ kind: 'open-recording', label: 'Recording' })
  if (isAdventureResumable(params.adventure)) {
    rows.push({ kind: 'resume-adventure', label: 'Resume Adventure' })
  }
  if (hasSavedAdventureRun(params.adventure)) {
    rows.push({ kind: 'reset-adventure', label: 'Reset Adventure Run' })
  }
  rows.push({ kind: 'install', label: params.installLabel, disabled: params.installDisabled })
  rows.push({ kind: 'switch-renderer', label: 'Switch to DOM renderer' })
  return rows
}

export type LobbySettingsRow =
  | { kind: 'back'; label: string }
  | { kind: 'ai-level-toggle'; label: string }
  | { kind: 'ai-level-option'; label: string; value: AiLevel; selected: boolean }
  | { kind: 'card-visual-style-cycle'; label: string; value: CardVisualStyle }
  | { kind: 'animation-speed-cycle'; label: string; value: AnimationSpeed }
  | { kind: 'board-theme-cycle'; label: string; value: BoardTheme }
  | { kind: 'render-quality-cycle'; label: string; value: RenderQualityPreference }

export interface LobbySettingsRowsParams {
  aiLevel: AiLevel | undefined
  aiLevelOptionsOpen: boolean
  cardVisualStyle: CardVisualStyle | undefined
  animationSpeed: AnimationSpeed | undefined
  boardTheme: BoardTheme | undefined
  renderQualityPreference: RenderQualityPreference | undefined
}

function cyclingRow<T>(
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>,
  currentValue: T,
): { label: string; nextValue: T } {
  const currentIndex = options.findIndex((option) => option.value === currentValue)
  const current = options[currentIndex] ?? options[0]
  const next = options[(currentIndex + 1) % options.length] ?? current
  return { label: current?.label ?? '', nextValue: next?.value ?? currentValue }
}

export function buildLobbySettingsRows(params: LobbySettingsRowsParams): LobbySettingsRow[] {
  const rows: LobbySettingsRow[] = []
  rows.push({ kind: 'back', label: 'Back' })
  const currentLabel = selectedAiLevelLabel(params.aiLevel)
  rows.push({
    kind: 'ai-level-toggle',
    label: `AI Difficulty: ${currentLabel}${params.aiLevelOptionsOpen ? ' ▲' : ' ▼'}`,
  })
  if (params.aiLevelOptionsOpen) {
    for (const option of AI_LEVEL_OPTIONS) {
      const selected = option.value === (params.aiLevel ?? 'basic')
      rows.push({
        kind: 'ai-level-option',
        label: selected ? `Set AI: ${option.label} ✓` : `Set AI: ${option.label}`,
        value: option.value,
        selected,
      })
    }
  }
  const cardStyle = cyclingRow(CARD_VISUAL_STYLE_OPTIONS, params.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE)
  rows.push({ kind: 'card-visual-style-cycle', label: `Card Style: ${cardStyle.label} ›`, value: cardStyle.nextValue })
  const animationSpeed = cyclingRow(ANIMATION_SPEED_OPTIONS, params.animationSpeed ?? DEFAULT_ANIMATION_SPEED)
  rows.push({ kind: 'animation-speed-cycle', label: `Animations: ${animationSpeed.label} ›`, value: animationSpeed.nextValue })
  const boardTheme = cyclingRow(BOARD_THEME_OPTIONS, params.boardTheme ?? DEFAULT_BOARD_THEME)
  rows.push({ kind: 'board-theme-cycle', label: `Board Theme: ${boardTheme.label} ›`, value: boardTheme.nextValue })
  const renderQuality = cyclingRow(
    RENDER_QUALITY_PREFERENCE_OPTIONS,
    params.renderQualityPreference ?? DEFAULT_RENDER_QUALITY_PREFERENCE,
  )
  rows.push({ kind: 'render-quality-cycle', label: `Render Quality: ${renderQuality.label} ›`, value: renderQuality.nextValue })
  return rows
}

export type LobbyRecordingRow =
  | { kind: 'back'; label: string }
  | { kind: 'load-from-browser'; label: string; disabled: boolean }
  | { kind: 'load-from-file'; label: string }

export function buildLobbyRecordingRows(params: { hasLocalSave: boolean }): LobbyRecordingRow[] {
  return [
    { kind: 'back', label: 'Back' },
    { kind: 'load-from-browser', label: 'Load Recording from Browser', disabled: !params.hasLocalSave },
    { kind: 'load-from-file', label: 'Load Recording from File' },
  ]
}
