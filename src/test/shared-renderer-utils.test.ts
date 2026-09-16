import { describe, expect, it } from 'vitest'
import { computeCoverFitCrop } from '../renderers/shared/image-fit'
import { clamp } from '../renderers/shared/math'

describe('shared renderer utilities', () => {
  it('computes cover-fit crops for portrait, landscape, and invalid dimensions', () => {
    const portrait = computeCoverFitCrop(1920, 1080, 390, 844)
    expect(portrait.height).toBe(1080)
    expect(portrait.width).toBeCloseTo(499.05, 2)
    expect(portrait.x).toBeGreaterThan(700)

    const landscape = computeCoverFitCrop(1024, 1024, 1280, 720)
    expect(landscape.width).toBe(1024)
    expect(landscape.height).toBeCloseTo(576, 4)
    expect(landscape.y).toBeCloseTo(224, 4)

    expect(computeCoverFitCrop(Number.NaN, -1, 0, 0)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('clamps values to the supplied bounds', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(4, 0, 10)).toBe(4)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})
