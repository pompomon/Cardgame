import { describe, expect, it, vi } from 'vitest'
import {
  computeCoverCrop,
  computeRoundedCoverTextureSize,
  paintRoundedCover,
  roundedCoverTextureKey,
} from '../renderers/phaser/rounded-cover'

describe('Phaser rounded cover artwork', () => {
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
