import { describe, expect, it } from 'vitest'
import {
  ALL_BOARD_ATLAS_ASSETS,
  ALL_BOARD_BACKGROUND_ASSETS,
  BOARD_BACKGROUND_VARIANTS,
  BOARD_SPRITE_ATLASES,
  boardAmbienceAtlasLocation,
  boardBackgroundAssetLocation,
  boardSpriteAtlasLocation,
} from '../app/board-assets'
import { BOARD_THEMES } from '../app/board-theme'

describe('board assets', () => {
  it('enumerates every theme and independently loadable background variant', () => {
    expect(ALL_BOARD_BACKGROUND_ASSETS).toHaveLength(
      BOARD_THEMES.length * BOARD_BACKGROUND_VARIANTS.length,
    )
    expect(new Set(ALL_BOARD_BACKGROUND_ASSETS.map((asset) => asset.path)).size)
      .toBe(ALL_BOARD_BACKGROUND_ASSETS.length)

    for (const theme of BOARD_THEMES) {
      for (const variant of BOARD_BACKGROUND_VARIANTS) {
        expect(boardBackgroundAssetLocation(theme, variant)).toMatchObject({
          theme,
          variant,
          path: `boards/${theme}/background-${variant}.png`,
          url: `/boards/${theme}/background-${variant}.png`,
        })
      }
    }
  })

  it('exposes one ambience atlas per theme and shared UI/effects atlases', () => {
    expect(ALL_BOARD_ATLAS_ASSETS).toHaveLength(
      BOARD_THEMES.length + BOARD_SPRITE_ATLASES.length,
    )
    for (const theme of BOARD_THEMES) {
      expect(boardAmbienceAtlasLocation(theme)).toMatchObject({
        name: `ambience:${theme}`,
        textureUrl: `/boards/${theme}/ambience-atlas.png`,
        atlasUrl: `/boards/${theme}/ambience-atlas.json`,
      })
    }
    for (const name of BOARD_SPRITE_ATLASES) {
      expect(boardSpriteAtlasLocation(name)).toMatchObject({
        name,
        textureUrl: `/sprites/${name}-atlas.png`,
        atlasUrl: `/sprites/${name}-atlas.json`,
      })
    }
  })
})
