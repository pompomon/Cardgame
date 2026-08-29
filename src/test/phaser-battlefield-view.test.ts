import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildBattlefieldBackdrop: vi.fn(() => ({ kind: 'backdrop' })),
}))

vi.mock('../renderers/phaser/visual-primitives', () => ({
  buildBattlefieldBackdrop: mocks.buildBattlefieldBackdrop,
}))

import type { GameUiState } from '../app/types'
import { renderBattlefields } from '../renderers/phaser/battlefield-view'
import type { SceneLayout } from '../renderers/phaser/layout'

const layout = {
  boardColumnLeft: 100,
  boardColumnWidth: 600,
  nonActiveBattlefieldY: 100,
  nonActiveBattlefieldHeight: 150,
  activeBattlefieldY: 400,
  activeBattlefieldHeight: 180,
  cardWidth: 90,
  cardHeight: 120,
  cardGap: 100,
  smallFontSize: '14px',
} as SceneLayout

describe('Phaser battlefield presentation', () => {
  it('keeps Player 1 near-side while styling active Player 2 on the far side', () => {
    const text = vi.fn((_x: number, _y: number, value: string) => ({ value }))
    const zone = vi.fn()
    const addToRoot = vi.fn()
    const recordCardPosition = vi.fn()
    const findBattlefieldTargetEntry = vi.fn(() => null)
    const setBattlefieldDropZone = vi.fn()
    const game = {
      actor: 1,
      canInput: false,
      phase: 'main',
      players: [
        {
          battlefield: [{ instanceId: 'p0-land', cardId: 'p0-card', name: 'Forest' }],
        },
        {
          battlefield: [{ instanceId: 'p1-land', cardId: 'p1-card', name: 'Mountain' }],
        },
      ],
    } as unknown as GameUiState

    const cards = renderBattlefields({
      scene: { add: { text, zone } },
      getLayout: () => layout,
      getRootContainer: () => ({ add: addToRoot }),
      effectController: {
        beginBattlefieldRenderPass: vi.fn(),
        recordCardPosition,
      },
      battlefieldTargets: {
        findBattlefieldTargetEntry,
        getPendingPlayLandTargetSelection: () => null,
      },
      setBattlefieldDropZone,
    } as never, game, 0)

    expect(mocks.buildBattlefieldBackdrop).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      400,
      175,
      expect.objectContaining({ kind: 'active' }),
    )
    expect(mocks.buildBattlefieldBackdrop).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      400,
      490,
      expect.objectContaining({ kind: 'non-active' }),
    )
    expect(text.mock.calls.map((call) => call[2])).toEqual([
      'Player 2 Battlefield — Active',
      'Player 1 Battlefield',
    ])
    expect(findBattlefieldTargetEntry).toHaveBeenNthCalledWith(1, 'active', 'p1-land')
    expect(findBattlefieldTargetEntry).toHaveBeenNthCalledWith(2, 'non-active', 'p0-land')
    expect(cards.find((card) => card.playerIndex === 1)?.y).toBe(186)
    expect(cards.find((card) => card.playerIndex === 0)?.y).toBe(501)
    expect(zone).not.toHaveBeenCalled()
    expect(setBattlefieldDropZone).toHaveBeenCalledWith(null)
  })
})
