import { describe, expect, it } from 'vitest'
import {
  AMBIENCE_ATLAS_FRAMES,
  BOARD_UI_ATLAS_FRAMES,
  buildPhaserBoardAssetManifest,
  EFFECTS_ATLAS_FRAMES,
  resolveLoadedBoardBackgroundTextureKey,
} from '../renderers/phaser/asset-manifest'

describe('Phaser board asset manifest', () => {
  it('falls back from HD through balanced, low, and placeholder art', () => {
    const manifest = buildPhaserBoardAssetManifest('moonlit', 'high')
    expect(manifest.backgroundCandidates.map((asset) => asset.key)).toEqual([
      'board-background:moonlit:hd',
      'board-background:moonlit:balanced',
      'board-background:moonlit:low',
      'board-background:moonlit:fallback',
    ])
  })

  it('starts auto/balanced and low preferences at their required tier', () => {
    expect(
      buildPhaserBoardAssetManifest('classic', 'auto')
        .backgroundCandidates.map((asset) => asset.key),
    ).toEqual([
      'board-background:classic:balanced',
      'board-background:classic:low',
      'board-background:classic:fallback',
    ])
    expect(
      buildPhaserBoardAssetManifest('verdant', 'low')
        .backgroundCandidates.map((asset) => asset.key),
    ).toEqual([
      'board-background:verdant:low',
      'board-background:verdant:fallback',
    ])
  })

  it('keeps large backgrounds separate from the three sprite atlases', () => {
    const manifest = buildPhaserBoardAssetManifest('verdant', 'balanced')
    expect(manifest.backgroundCandidates.every((asset) => asset.kind === 'image')).toBe(true)
    expect(manifest.atlases.map((asset) => asset.key)).toEqual([
      'board-atlas:ambience:verdant',
      'board-atlas:board-ui',
      'board-atlas:effects',
    ])
    expect(manifest.atlases.map((asset) => asset.requiredFrames)).toEqual([
      AMBIENCE_ATLAS_FRAMES,
      BOARD_UI_ATLAS_FRAMES,
      EFFECTS_ATLAS_FRAMES,
    ])
  })

  it('resolves the first loaded fallback and otherwise uses the procedural board', () => {
    const manifest = buildPhaserBoardAssetManifest('classic', 'high')
    expect(
      resolveLoadedBoardBackgroundTextureKey(
        manifest,
        (key) => key === 'board-background:classic:low',
      ),
    ).toBe('board-background:classic:low')
    expect(resolveLoadedBoardBackgroundTextureKey(manifest, () => false)).toBe(null)
  })
})
