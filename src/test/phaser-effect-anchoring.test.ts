import { describe, expect, it } from 'vitest'
import type { AppViewModel } from '../app/types'
import {
  computeEffectAnchorFromLayout,
  computeEffectSourceAnchor,
} from '../renderers/phaser/effect-anchoring'
import type { EffectAnchor, EffectDescriptor } from '../renderers/phaser/effects'
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
} as SceneLayout

const view = {
  game: {
    actor: 0,
    players: [{ battlefield: [] }, { battlefield: [] }],
  },
} as unknown as AppViewModel

function descriptor(overrides: Partial<EffectDescriptor>): EffectDescriptor {
  return {
    kind: 'mountain_destroy',
    actor: 0,
    targetActor: 1,
    land: 'Mountain',
    visualStyle: 'hd',
    palette: { primary: '#ffbfa3', secondary: '#ff8b62', glow: '#ff8b62' },
    ...overrides,
  }
}

describe('Phaser effect anchoring', () => {
  it('uses the previous registry for a card removed by an effect', () => {
    const removed: EffectAnchor = { x: 250, y: 180, width: 90, height: 120 }
    const result = computeEffectAnchorFromLayout(
      view,
      descriptor({ targetInstanceId: 'p1-4' }),
      layout,
      new Map(),
      new Map([['p1-4', removed]]),
    )
    expect(result).toBe(removed)
  })

  it('resolves the source independently for source-to-target trails', () => {
    const source: EffectAnchor = { x: 420, y: 490, width: 90, height: 120 }
    expect(computeEffectSourceAnchor(
      descriptor({ sourceInstanceId: 'p0-2' }),
      new Map([['p0-2', source]]),
    )).toBe(source)
  })

  it('falls back to the target actor battlefield row', () => {
    const result = computeEffectAnchorFromLayout(
      view,
      descriptor({}),
      layout,
      new Map(),
    )
    expect(result.y).toBe(175)
  })
})
