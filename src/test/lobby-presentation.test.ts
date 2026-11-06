import { describe, expect, it } from 'vitest'
import {
  actionableAdventureNodes,
  describeNextAdventureOpponent,
  hasSavedAdventureRun,
  isAdventureResumable,
  LOBBY_MODE_OPTIONS,
} from '../app/lobby-presentation'
import type { AdventureNodeLane, AdventureNodeStatus } from '../app/adventure'
import type { AdventureNodeSummary, AdventureTierSummary, AdventureUiState } from '../app/types'

function adventure(overrides: Partial<AdventureUiState> = {}): AdventureUiState {
  return {
    runId: null,
    baseSeed: 1,
    status: 'inactive',
    stage: null,
    currentTier: 0,
    attemptOrdinal: 0,
    remainingChances: 3,
    winStreak: 0,
    totalRoundsPlayed: 0,
    totalCardsPlayed: 0,
    tiers: [],
    activeGameSeed: null,
    pendingCompletion: null,
    lastResult: null,
    highScore: 0,
    hasSavedRun: false,
    decisionKey: 'none',
    ...overrides,
  }
}

function node(tierIndex: number, lane: AdventureNodeLane, status: AdventureNodeStatus, label: string): AdventureNodeSummary {
  return {
    id: `tier-${tierIndex + 1}-${lane}`,
    tierIndex,
    lane,
    status,
    boss: false,
    opponent: { id: `opponent-${tierIndex}-${lane}`, label, kind: 'dual', lands: ['Forest', 'Swamp'] },
  }
}

function route(fork: [AdventureNodeStatus, AdventureNodeStatus], next: AdventureNodeStatus = 'locked'): AdventureTierSummary[] {
  return [
    { tierIndex: 0, nodes: [node(0, 'center', 'completed', 'First foe')] },
    { tierIndex: 1, nodes: [node(1, 'left', fork[0], 'Left foe'), node(1, 'right', fork[1], 'Right foe')] },
    { tierIndex: 2, nodes: [node(2, 'center', next, 'Next foe')] },
  ]
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

  it('lists both choices at an uncommitted fork', () => {
    const fork = adventure({ status: 'active', stage: 'map', currentTier: 2, tiers: route(['available', 'available']) })

    expect(actionableAdventureNodes(fork).map((entry) => entry.id)).toEqual(['tier-2-left', 'tier-2-right'])
    expect(describeNextAdventureOpponent(fork)).toBe('Choose Left foe or Right foe')
  })

  it('lists only the committed node after a fork choice and the single node of a convergence tier', () => {
    const committed = adventure({ status: 'paused', stage: 'map', currentTier: 2, tiers: route(['bypassed', 'current']) })
    const convergence = adventure({ status: 'active', stage: 'map', currentTier: 3, tiers: route(['bypassed', 'completed'], 'current') })

    expect(actionableAdventureNodes(committed).map((entry) => entry.id)).toEqual(['tier-2-right'])
    expect(describeNextAdventureOpponent(committed)).toBe('Right foe')
    expect(actionableAdventureNodes(convergence).map((entry) => entry.id)).toEqual(['tier-3-center'])
    expect(describeNextAdventureOpponent(convergence)).toBe('Next foe')
  })

  it('has no actionable node without a run or after the run ends', () => {
    const ended = adventure({ status: 'failed', currentTier: 2, tiers: route(['locked', 'locked']) })

    expect(actionableAdventureNodes(undefined)).toEqual([])
    expect(actionableAdventureNodes(adventure())).toEqual([])
    expect(actionableAdventureNodes(ended)).toEqual([])
    expect(describeNextAdventureOpponent(undefined)).toBeNull()
    expect(describeNextAdventureOpponent(ended)).toBeNull()
  })
})
