import { describe, expect, it } from 'vitest'

import {
  buildLobbyRecordingRows,
  buildLobbyRootRows,
  buildLobbySettingsRows,
  hasSavedAdventureRun,
  isAdventureResumable,
  LOBBY_MODE_OPTIONS,
  selectedAiLevelLabel,
} from '../renderers/phaser/lobby-actions'
import type { AdventureUiState } from '../app/types'

function adventure(overrides: Partial<AdventureUiState> = {}): AdventureUiState {
  return {
    baseSeed: 1,
    currentRound: 1,
    remainingChances: 3,
    winStreak: 0,
    totalRoundsPlayed: 0,
    totalCardsPlayed: 0,
    opponentLineup: [],
    currentOpponentIndex: 0,
    activeGameSeed: null,
    status: 'inactive',
    highScore: 0,
    hasSavedRun: false,
    ...overrides,
  }
}

describe('lobby-actions predicates', () => {
  it('LOBBY_MODE_OPTIONS includes tutorial and every multiplayer mode', () => {
    expect(LOBBY_MODE_OPTIONS.map((entry) => entry.mode)).toEqual([
      'tutorial',
      'local-hvh',
      'local-hvai',
      'local-aivai',
      'adventure-hvai',
      'p2p-host',
      'p2p-join',
    ])
  })

  it('isAdventureResumable is false when there is no saved run', () => {
    expect(isAdventureResumable(undefined)).toBe(false)
    expect(isAdventureResumable(adventure({ hasSavedRun: false, status: 'active' }))).toBe(false)
  })

  it('isAdventureResumable is true only for paused/active saved runs', () => {
    expect(isAdventureResumable(adventure({ hasSavedRun: true, status: 'paused' }))).toBe(true)
    expect(isAdventureResumable(adventure({ hasSavedRun: true, status: 'active' }))).toBe(true)
    expect(isAdventureResumable(adventure({ hasSavedRun: true, status: 'inactive' }))).toBe(false)
    expect(isAdventureResumable(adventure({ hasSavedRun: true, status: 'completed' }))).toBe(false)
  })

  it('hasSavedAdventureRun mirrors the hasSavedRun flag regardless of status', () => {
    expect(hasSavedAdventureRun(undefined)).toBe(false)
    expect(hasSavedAdventureRun(adventure({ hasSavedRun: true, status: 'completed' }))).toBe(true)
  })

  it('selectedAiLevelLabel falls back to Basic for undefined/unknown levels', () => {
    expect(selectedAiLevelLabel(undefined)).toBe('Basic')
    expect(selectedAiLevelLabel('basic')).toBe('Basic')
  })
})

describe('buildLobbyRootRows', () => {
  it('always includes the mode rows, settings, recording, install, and switch-renderer', () => {
    const rows = buildLobbyRootRows({ adventure: undefined, installLabel: 'Install App', installDisabled: false })
    const kinds = rows.map((row) => row.kind)
    expect(kinds.slice(0, LOBBY_MODE_OPTIONS.length)).toEqual(LOBBY_MODE_OPTIONS.map(() => 'start-mode'))
    expect(kinds).toContain('open-settings')
    expect(kinds).toContain('open-recording')
    expect(kinds).toContain('install')
    expect(kinds).toContain('switch-renderer')
    expect(kinds).not.toContain('resume-adventure')
    expect(kinds).not.toContain('reset-adventure')
  })

  it('adds resume-adventure only when the run is resumable', () => {
    const rows = buildLobbyRootRows({
      adventure: adventure({ hasSavedRun: true, status: 'paused' }),
      installLabel: 'Install App',
      installDisabled: false,
    })
    expect(rows.map((row) => row.kind)).toContain('resume-adventure')
  })

  it('adds reset-adventure whenever a run is saved, even if not resumable', () => {
    const rows = buildLobbyRootRows({
      adventure: adventure({ hasSavedRun: true, status: 'completed' }),
      installLabel: 'Install App',
      installDisabled: false,
    })
    const kinds = rows.map((row) => row.kind)
    expect(kinds).toContain('reset-adventure')
    expect(kinds).not.toContain('resume-adventure')
  })

  it('propagates the install label/disabled state verbatim', () => {
    const rows = buildLobbyRootRows({ adventure: undefined, installLabel: 'iOS: Share → Add to Home Screen', installDisabled: true })
    const installRow = rows.find((row) => row.kind === 'install')
    expect(installRow).toEqual({ kind: 'install', label: 'iOS: Share → Add to Home Screen', disabled: true })
  })
})

describe('buildLobbySettingsRows', () => {
  it('collapses the AI level list when aiLevelOptionsOpen is false', () => {
    const rows = buildLobbySettingsRows({
      aiLevel: 'basic',
      aiLevelOptionsOpen: false,
      cardVisualStyle: 'classic',
      animationSpeed: 'normal',
      boardTheme: 'classic',
      renderQualityPreference: 'auto',
    })
    expect(rows.some((row) => row.kind === 'ai-level-option')).toBe(false)
    expect(rows).toHaveLength(6)
    const toggle = rows.find((row) => row.kind === 'ai-level-toggle')
    expect(toggle?.label).toBe('AI Difficulty: Basic ▼')
  })

  it('expands the AI level list and marks the selected option when open', () => {
    const rows = buildLobbySettingsRows({
      aiLevel: 'basic',
      aiLevelOptionsOpen: true,
      cardVisualStyle: 'classic',
      animationSpeed: 'normal',
      boardTheme: 'classic',
      renderQualityPreference: 'auto',
    })
    const toggle = rows.find((row) => row.kind === 'ai-level-toggle')
    expect(toggle?.label).toBe('AI Difficulty: Basic ▲')
    const options = rows.filter((row) => row.kind === 'ai-level-option')
    expect(options.length).toBeGreaterThan(0)
    const selected = options.filter((row) => row.kind === 'ai-level-option' && row.selected)
    expect(selected).toHaveLength(1)
    expect(selected[0]?.label).toContain('✓')
  })

  it('collapses visual settings into rows that cycle to the next option', () => {
    const rows = buildLobbySettingsRows({
      aiLevel: 'basic',
      aiLevelOptionsOpen: false,
      cardVisualStyle: 'hd',
      animationSpeed: 'fast',
      boardTheme: 'moonlit',
      renderQualityPreference: 'balanced',
    })
    expect(rows.find((row) => row.kind === 'card-visual-style-cycle')).toEqual({
      kind: 'card-visual-style-cycle',
      label: 'Card Style: HD ›',
      value: 'monochrome',
    })
    expect(rows.find((row) => row.kind === 'animation-speed-cycle')).toEqual({
      kind: 'animation-speed-cycle',
      label: 'Animations: Fast ›',
      value: 'normal',
    })
    expect(rows.find((row) => row.kind === 'board-theme-cycle')).toEqual({
      kind: 'board-theme-cycle',
      label: 'Board Theme: Moonlit ›',
      value: 'verdant',
    })
    expect(rows.find((row) => row.kind === 'render-quality-cycle')).toEqual({
      kind: 'render-quality-cycle',
      label: 'Render Quality: Balanced ›',
      value: 'low',
    })
  })
})

describe('buildLobbyRecordingRows', () => {
  it('disables "Load from Browser" when there is no local save', () => {
    const rows = buildLobbyRecordingRows({ hasLocalSave: false })
    const loadRow = rows.find((row) => row.kind === 'load-from-browser')
    expect(loadRow?.disabled).toBe(true)
  })

  it('enables "Load from Browser" when a local save exists', () => {
    const rows = buildLobbyRecordingRows({ hasLocalSave: true })
    const loadRow = rows.find((row) => row.kind === 'load-from-browser')
    expect(loadRow?.disabled).toBe(false)
  })

  it('always includes back and load-from-file rows', () => {
    const kinds = buildLobbyRecordingRows({ hasLocalSave: true }).map((row) => row.kind)
    expect(kinds).toEqual(['back', 'load-from-browser', 'load-from-file'])
  })
})
