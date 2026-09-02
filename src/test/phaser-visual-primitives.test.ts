import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({ default: {} }))

import {
  buildBattlefieldBackdrop,
  buildPolishedPanel,
  buildRoundedCoverImage,
} from '../renderers/phaser/visual-primitives'
import {
  computeCoverCrop,
  computeRoundedCoverTextureSize,
  paintRoundedCover,
  roundedCoverTextureKey,
} from '../renderers/phaser/rounded-cover'
import {
  COLOR_BATTLEFIELD_ACTIVE_STROKE,
  COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  COLOR_FELT_ACTIVE_GLOW,
  COLOR_STATUS_ACTIVE_FILL,
  COLOR_STATUS_NON_ACTIVE_FILL,
  STATUS_FILL_ALPHA,
} from '../renderers/phaser/theme'

class RecordingGraphics {
  readonly fillStyle = vi.fn((_color: number, _alpha?: number) => this)
  readonly fillRoundedRect = vi.fn((..._args: unknown[]) => this)
  readonly lineStyle = vi.fn((_width: number, _color: number, _alpha?: number) => this)
  readonly strokeRoundedRect = vi.fn((..._args: unknown[]) => this)
}

class RecordingContainer {
  readonly children: unknown[] = []
  readonly add = vi.fn((child: unknown) => {
    this.children.push(child)
    return this
  })
  readonly setSize = vi.fn((_width: number, _height: number) => this)
}

function createGraphicsHarness(): {
  scene: unknown
  graphics: RecordingGraphics[]
} {
  const graphics: RecordingGraphics[] = []
  return {
    scene: {
      add: {
        container: () => new RecordingContainer(),
        graphics: () => {
          const object = new RecordingGraphics()
          graphics.push(object)
          return object
        },
      },
    },
    graphics,
  }
}

describe('Phaser rounded cover artwork', () => {
  it('falls back to the cover image when source artwork is unavailable', () => {
    const image = {
      setCrop: vi.fn(),
      setScale: vi.fn(),
    }
    const scene = {
      add: {
        image: vi.fn(() => image),
      },
      textures: {
        createCanvas: vi.fn(),
        exists: vi.fn(),
        get: vi.fn(() => ({
          getSourceImage: vi.fn(() => null),
        })),
      },
    }

    expect(buildRoundedCoverImage(scene as never, 'missing-art', 72, 100, 8, 64)).toBe(image)
    expect(scene.textures.createCanvas).not.toHaveBeenCalled()
    expect(scene.add.image).toHaveBeenCalledWith(0, 0, 'missing-art')
  })

  it('center-crops square artwork to portrait card dimensions', () => {
    expect(computeCoverCrop(1024, 1024, 72, 100)).toEqual({
      sourceX: 143.36,
      sourceY: 0,
      sourceWidth: 737.28,
      sourceHeight: 1024,
    })
  })

  it('retains source resolution for an enlarged preview', () => {
    expect(computeRoundedCoverTextureSize(1024, 1024, 72, 100, 8)).toEqual({
      width: 737,
      height: 1024,
      radius: 82,
    })
  })

  describe('Phaser status-area fills', () => {
    it('uses a 95%-transparent shared tint alpha', () => {
      expect(STATUS_FILL_ALPHA).toBe(0.05)
    })

    it('draws an optional polished-panel tint beneath the intact border', () => {
      const harness = createGraphicsHarness()

      buildPolishedPanel(harness.scene as never, 0, 0, {
        fill: 0x112233,
        stroke: COLOR_BATTLEFIELD_ACTIVE_STROKE,
        width: 120,
        height: 80,
        strokeWidth: 2,
        shadow: false,
        topSheen: false,
        tint: {
          color: COLOR_STATUS_ACTIVE_FILL,
          alpha: STATUS_FILL_ALPHA,
        },
      })

      expect(harness.graphics).toHaveLength(1)
      expect(harness.graphics[0].fillStyle.mock.calls).toEqual([
        [0x112233, 1],
        [COLOR_STATUS_ACTIVE_FILL, STATUS_FILL_ALPHA],
      ])
      expect(harness.graphics[0].fillRoundedRect.mock.calls).toEqual([
        [-60, -40, 120, 80, 10],
        [-60, -40, 120, 80, 10],
      ])
      expect(harness.graphics[0].lineStyle).toHaveBeenCalledWith(
        2,
        COLOR_BATTLEFIELD_ACTIVE_STROKE,
        0.95,
      )
    })

    it('leaves polished panels unchanged when no tint is requested', () => {
      const harness = createGraphicsHarness()

      buildPolishedPanel(harness.scene as never, 0, 0, {
        fill: 0x112233,
        stroke: 0x445566,
        width: 120,
        height: 80,
        shadow: false,
        topSheen: false,
      })

      expect(harness.graphics[0].fillStyle.mock.calls).toEqual([[0x112233, 1]])
    })

    it.each([
      ['active', COLOR_BATTLEFIELD_ACTIVE_STROKE, COLOR_STATUS_ACTIVE_FILL, 3, true],
      ['non-active', COLOR_BATTLEFIELD_NON_ACTIVE_STROKE, COLOR_STATUS_NON_ACTIVE_FILL, 2, false],
    ] as const)('fills the %s battlefield at 95% transparency and preserves its border', (
      kind,
      stroke,
      fill,
      strokeWidth,
      hasGlow,
    ) => {
      const harness = createGraphicsHarness()

      buildBattlefieldBackdrop(harness.scene as never, 100, 80, {
        width: 200,
        height: 120,
        kind,
        stroke,
      })

      expect(harness.graphics[3].fillStyle).toHaveBeenCalledWith(fill, STATUS_FILL_ALPHA)
      expect(harness.graphics[3].fillRoundedRect).toHaveBeenCalledWith(-100, -60, 200, 120, 12)
      expect(harness.graphics[4].lineStyle).toHaveBeenCalledWith(strokeWidth, stroke, 0.92)
      if (hasGlow) {
        expect(harness.graphics[5].fillStyle).toHaveBeenCalledWith(COLOR_FELT_ACTIVE_GLOW, 0.16)
      } else {
        expect(harness.graphics).toHaveLength(5)
      }
    })
  })

  it('clears transparent corners and clips before painting the cover crop', () => {
    const calls: string[] = []
    const context = {
      clearRect: vi.fn(() => calls.push('clear')),
      save: vi.fn(() => calls.push('save')),
      beginPath: vi.fn(() => calls.push('path')),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(() => calls.push('round')),
      clip: vi.fn(() => calls.push('clip')),
      drawImage: vi.fn(() => calls.push('draw')),
      restore: vi.fn(() => calls.push('restore')),
    } as unknown as CanvasRenderingContext2D
    const source = { width: 1024, height: 1024 } as CanvasImageSource

    paintRoundedCover(context, source, 1024, 1024, 72, 100, 8)

    expect(calls).toEqual(['clear', 'save', 'path', 'round', 'clip', 'draw', 'restore'])
    expect(context.moveTo).toHaveBeenCalledWith(8, 0)
    expect(context.quadraticCurveTo).toHaveBeenCalledTimes(4)
    expect(context.drawImage).toHaveBeenCalledWith(
      source,
      143.36,
      0,
      737.28,
      1024,
      0,
      0,
      72,
      100,
    )
  })

  it('uses stable dimension-specific texture keys for caching', () => {
    expect(roundedCoverTextureKey('card-art:hd:Forest', 72, 100, 8))
      .toBe(roundedCoverTextureKey('card-art:hd:Forest', 72, 100, 8))
    expect(roundedCoverTextureKey('card-art:hd:Forest', 72, 100, 8))
      .not.toBe(roundedCoverTextureKey('card-art:hd:Forest', 100, 72, 8))
  })
})
