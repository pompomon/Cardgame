import { describe, expect, it } from 'vitest'
import {
  hasSavedAdventureRun,
  isAdventureResumable,
  LOBBY_MODE_OPTIONS,
} from '../app/lobby-presentation'
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

describe('lobby presentation', () => {
  it('lists every playable lobby mode', () => {
    expect(LOBBY_MODE_OPTIONS.map((entry) => entry.mode)).toEqual([
      'local-hvh',
      'local-hvai',
      'local-aivai',
      'adventure-hvai',
      'p2p-host',
      'p2p-join',
    ])
  })

  it('only resumes active or paused saved adventures', () => {
    expect(isAdventureResumable(undefined)).toBe(false)
    expect(isAdventureResumable(adventure({ hasSavedRun: false, status: 'active' }))).toBe(false)
    expect(isAdventureResumable(adventure({ hasSavedRun: true, status: 'paused' }))).toBe(true)
    expect(isAdventureResumable(adventure({ hasSavedRun: true, status: 'active' }))).toBe(true)
    expect(isAdventureResumable(adventure({ hasSavedRun: true, status: 'completed' }))).toBe(false)
  })

  it('reports any saved adventure independently of resumability', () => {
    expect(hasSavedAdventureRun(undefined)).toBe(false)
    expect(hasSavedAdventureRun(adventure({ hasSavedRun: true, status: 'completed' }))).toBe(true)
  })
})
