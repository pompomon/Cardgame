import { describe, expect, it, vi } from 'vitest'

import {
  BattlefieldTargetsController,
  battlefieldTargetA11yEntries,
  computeBattlefieldTargetEntries,
  type BattlefieldTargetEntry,
} from '../renderers/phaser/battlefield-targets'
import type { GameUiState } from '../app/types'

function baseGame(overrides: Partial<GameUiState> = {}): GameUiState {
  return {
    turn: 1,
    phase: 'main',
    winnerText: '',
    actor: 0,
    actorControl: 'human',
    canInput: true,
    pendingLandName: null,
    pendingPlainsReuseName: null,
    players: [
      { id: 0, handCount: 1, deckCount: 10, graveyardCount: 0, handCards: [], graveyardCards: [], battlefield: [] },
      { id: 1, handCount: 1, deckCount: 10, graveyardCount: 0, handCards: [], graveyardCards: [], battlefield: [] },
    ],
    legal: {
      playLandByCard: {},
      counterOptions: [],
      swampDiscardOptions: [],
      plainsReuseOptions: [],
      canEndTurn: true,
      canPassResponse: false,
    },
    log: [],
    events: [],
    isReplay: false,
    revealedEnemyHandForSwamp: null,
    ...overrides,
  }
}

describe('computeBattlefieldTargetEntries', () => {
  it('returns no entries when the player cannot act', () => {
    const game = baseGame({ canInput: false })
    expect(computeBattlefieldTargetEntries(game, null, false, vi.fn(), vi.fn())).toEqual([])
  })

  it('returns no entries while the menu overlay is open, even mid target-selection', () => {
    const game = baseGame({
      players: [
        { id: 0, handCount: 1, deckCount: 10, graveyardCount: 0, handCards: [{ id: 'mountain-1', name: 'Mountain' }], graveyardCards: [], battlefield: [] },
        { id: 1, handCount: 0, deckCount: 10, graveyardCount: 0, handCards: [], graveyardCards: [], battlefield: [{ instanceId: 'enemy-island-1', name: 'Island' }] },
      ],
      legal: {
        playLandByCard: {
          'mountain-1': [
            { action: { type: 'play_land', actor: 0, cardId: 'mountain-1', effectTargetId: 'enemy-island-1' }, label: 'Destroy Island' },
          ],
        },
        counterOptions: [], swampDiscardOptions: [], plainsReuseOptions: [], canEndTurn: true, canPassResponse: false,
      },
    })
    const pending = { cardId: 'mountain-1', options: [{ effectTargetId: 'enemy-island-1', label: 'Destroy Island' }] }
    expect(computeBattlefieldTargetEntries(game, pending, true, vi.fn(), vi.fn())).toEqual([])
  })

  it('flags enemy battlefield cards as non-active targets for a Mountain play', () => {
    const game = baseGame({
      players: [
        { id: 0, handCount: 1, deckCount: 10, graveyardCount: 0, handCards: [{ id: 'mountain-1', name: 'Mountain' }], graveyardCards: [], battlefield: [] },
        {
          id: 1,
          handCount: 0,
          deckCount: 10,
          graveyardCount: 0,
          handCards: [],
          graveyardCards: [],
          battlefield: [
            { instanceId: 'enemy-island-1', name: 'Island' },
            { instanceId: 'enemy-island-2', name: 'Island' },
          ],
        },
      ],
      legal: {
        playLandByCard: {
          'mountain-1': [
            { action: { type: 'play_land', actor: 0, cardId: 'mountain-1', effectTargetId: 'enemy-island-1' }, label: 'Destroy Island' },
            { action: { type: 'play_land', actor: 0, cardId: 'mountain-1', effectTargetId: 'enemy-island-2' }, label: 'Destroy Island' },
          ],
        },
        counterOptions: [], swampDiscardOptions: [], plainsReuseOptions: [], canEndTurn: true, canPassResponse: false,
      },
    })
    const pending = {
      cardId: 'mountain-1',
      options: [
        { effectTargetId: 'enemy-island-1', label: 'Destroy Island' },
        { effectTargetId: 'enemy-island-2', label: 'Destroy Island' },
      ],
    }
    const submitAction = vi.fn()
    const onResolved = vi.fn()
    const entries = computeBattlefieldTargetEntries(game, pending, false, submitAction, onResolved)
    expect(entries).toHaveLength(2)
    expect(entries.every((entry) => entry.owner === 'non-active')).toBe(true)
    expect(entries.map((entry) => entry.effectTargetId).sort()).toEqual(['enemy-island-1', 'enemy-island-2'])
    expect(entries.every((entry) => entry.cardName === 'Island')).toBe(true)

    entries[0].onSelect()
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ effectTargetId: entries[0].effectTargetId }))
  })

  it("flags the active player's own battlefield cards for a Plains reuse (not Mountain)", () => {
    const game = baseGame({
      phase: 'plains_target',
      pendingPlainsReuseName: 'Plains',
      players: [
        {
          id: 0,
          handCount: 0,
          deckCount: 10,
          graveyardCount: 0,
          handCards: [],
          graveyardCards: [],
          battlefield: [{ instanceId: 'own-forest-1', name: 'Forest' }, { instanceId: 'own-forest-2', name: 'Forest' }],
        },
        { id: 1, handCount: 0, deckCount: 10, graveyardCount: 0, handCards: [], graveyardCards: [], battlefield: [] },
      ],
      legal: {
        playLandByCard: {},
        counterOptions: [],
        swampDiscardOptions: [],
        plainsReuseOptions: [
          { action: { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'own-forest-1' }, label: 'Reuse targeting Forest' },
          { action: { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'own-forest-2' }, label: 'Reuse targeting Forest' },
        ],
        canEndTurn: true,
        canPassResponse: false,
      },
    })
    const submitAction = vi.fn()
    const entries = computeBattlefieldTargetEntries(game, null, false, submitAction, vi.fn())
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ owner: 'active', effectTargetId: 'own-forest-1', cardName: 'Forest' })
    entries[0].onSelect()
    expect(submitAction).toHaveBeenCalledTimes(1)
  })
})

describe('battlefieldTargetA11yEntries', () => {
  function entry(owner: BattlefieldTargetEntry['owner'], effectTargetId: string, cardName: string): BattlefieldTargetEntry {
    return { owner, effectTargetId, cardName, onSelect: vi.fn() }
  }

  it('labels a single target without a count suffix', () => {
    const entries = battlefieldTargetA11yEntries([entry('active', 't1', 'Forest')])
    expect(entries).toEqual([{ key: 'battlefield-target:active:t1', label: 'Target Forest', onSelect: expect.any(Function) }])
  })

  it('adds "(n/total)" suffixes when the same card name repeats', () => {
    const entries = battlefieldTargetA11yEntries([
      entry('non-active', 't1', 'Island'),
      entry('non-active', 't2', 'Island'),
    ])
    expect(entries.map((e) => e.label)).toEqual(['Target Island (1/2)', 'Target Island (2/2)'])
  })

  it('does not cross-count distinct card names', () => {
    const entries = battlefieldTargetA11yEntries([
      entry('active', 't1', 'Forest'),
      entry('active', 't2', 'Plains'),
    ])
    expect(entries.map((e) => e.label)).toEqual(['Target Forest', 'Target Plains'])
  })
})

describe('BattlefieldTargetsController', () => {
  it('tracks pending play-land target selection lifecycle', () => {
    const controller = new BattlefieldTargetsController({ isMenuOpen: () => false, submitAction: vi.fn() })
    expect(controller.getPendingPlayLandTargetSelection()).toBeNull()
    controller.beginPlayLandTargetSelection('card-1', [{ effectTargetId: 't1', label: 'Target 1' }])
    expect(controller.getPendingPlayLandTargetSelection()).toEqual({ cardId: 'card-1', options: [{ effectTargetId: 't1', label: 'Target 1' }] })
    controller.clearPendingPlayLandTargetSelection()
    expect(controller.getPendingPlayLandTargetSelection()).toBeNull()
  })

  it('drops the pending selection when syncing against a game state that no longer offers it', () => {
    const controller = new BattlefieldTargetsController({ isMenuOpen: () => false, submitAction: vi.fn() })
    controller.beginPlayLandTargetSelection('card-1', [{ effectTargetId: 't1', label: 'Target 1' }])
    const game = baseGame({ legal: { playLandByCard: {}, counterOptions: [], swampDiscardOptions: [], plainsReuseOptions: [], canEndTurn: true, canPassResponse: false } })
    controller.syncPendingPlayLandTargetSelection(game)
    expect(controller.getPendingPlayLandTargetSelection()).toBeNull()
  })

  it('reset() clears both pending selection and battlefield entries; clearTransientEntries() only clears entries', () => {
    const controller = new BattlefieldTargetsController({ isMenuOpen: () => false, submitAction: vi.fn() })
    controller.beginPlayLandTargetSelection('card-1', [{ effectTargetId: 't1', label: 'Target 1' }])
    controller.clearTransientEntries()
    expect(controller.getPendingPlayLandTargetSelection()).not.toBeNull()
    controller.reset()
    expect(controller.getPendingPlayLandTargetSelection()).toBeNull()
    expect(controller.getBattlefieldTargetEntries()).toEqual([])
  })
})
