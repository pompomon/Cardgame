import { BOARD_THEMES, type BoardTheme } from './board-theme'
import { joinBasePath } from './url-path'

export const BOARD_BACKGROUND_VARIANTS = ['hd', 'balanced', 'low', 'fallback'] as const

export type BoardBackgroundVariant = typeof BOARD_BACKGROUND_VARIANTS[number]

export const BOARD_SPRITE_ATLASES = ['board-ui', 'effects'] as const

export type BoardSpriteAtlas = typeof BOARD_SPRITE_ATLASES[number]

const BOARD_BACKGROUND_FILE_NAMES: Record<BoardBackgroundVariant, string> = {
  hd: 'background-hd.png',
  balanced: 'background-balanced.png',
  low: 'background-low.png',
  fallback: 'background-fallback.png',
}

export interface BoardBackgroundAssetLocation {
  readonly theme: BoardTheme
  readonly variant: BoardBackgroundVariant
  readonly path: string
  readonly url: string
}

export interface BoardAtlasAssetLocation {
  readonly name: string
  readonly texturePath: string
  readonly textureUrl: string
  readonly atlasPath: string
  readonly atlasUrl: string
}

function publicAssetUrl(path: string): string {
  // Keep this as a direct literal member expression. Vite only replaces
  // import.meta.env.BASE_URL in this form for non-root production builds.
  const base = import.meta.env.BASE_URL
  return joinBasePath(
    typeof base === 'string' && base.length > 0 ? base : '/',
    path,
  )
}

export function boardBackgroundAssetLocation(
  theme: BoardTheme,
  variant: BoardBackgroundVariant,
): BoardBackgroundAssetLocation {
  const path = `boards/${theme}/${BOARD_BACKGROUND_FILE_NAMES[variant]}`
  return Object.freeze({
    theme,
    variant,
    path,
    url: publicAssetUrl(path),
  })
}

export function boardAmbienceAtlasLocation(theme: BoardTheme): BoardAtlasAssetLocation {
  const texturePath = `boards/${theme}/ambience-atlas.png`
  const atlasPath = `boards/${theme}/ambience-atlas.json`
  return Object.freeze({
    name: `ambience:${theme}`,
    texturePath,
    textureUrl: publicAssetUrl(texturePath),
    atlasPath,
    atlasUrl: publicAssetUrl(atlasPath),
  })
}

export function boardSpriteAtlasLocation(name: BoardSpriteAtlas): BoardAtlasAssetLocation {
  const texturePath = `sprites/${name}-atlas.png`
  const atlasPath = `sprites/${name}-atlas.json`
  return Object.freeze({
    name,
    texturePath,
    textureUrl: publicAssetUrl(texturePath),
    atlasPath,
    atlasUrl: publicAssetUrl(atlasPath),
  })
}

export const ALL_BOARD_BACKGROUND_ASSETS: readonly BoardBackgroundAssetLocation[] = Object.freeze(
  BOARD_THEMES.flatMap((theme) =>
    BOARD_BACKGROUND_VARIANTS.map((variant) =>
      boardBackgroundAssetLocation(theme, variant),
    ),
  ),
)

export const ALL_BOARD_ATLAS_ASSETS: readonly BoardAtlasAssetLocation[] = Object.freeze([
  ...BOARD_THEMES.map((theme) => boardAmbienceAtlasLocation(theme)),
  ...BOARD_SPRITE_ATLASES.map((name) => boardSpriteAtlasLocation(name)),
])
