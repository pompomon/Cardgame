import {
  boardAmbienceAtlasLocation,
  boardBackgroundAssetLocation,
  boardSpriteAtlasLocation,
  type BoardBackgroundVariant,
} from '../../app/board-assets'
import type { BoardTheme } from '../../app/board-theme'
import type { RenderQualityPreference } from '../../app/render-quality'

export const BOARD_UI_ATLAS_FRAMES = [
  'zone-outline',
  'target-ring',
  'drop-arrow',
  'selection-glow',
] as const

export const EFFECTS_ATLAS_FRAMES = [
  'spark',
  'impact-ring',
  'trail',
  'shield',
] as const

export const AMBIENCE_ATLAS_FRAMES = [
  'ambient-mote',
  'ambient-glow',
] as const

export interface PhaserImageAssetDescriptor {
  readonly kind: 'image'
  readonly key: string
  readonly url: string
}

export interface PhaserAtlasAssetDescriptor {
  readonly kind: 'atlas'
  readonly key: string
  readonly textureUrl: string
  readonly atlasUrl: string
  readonly requiredFrames: readonly string[]
}

export type PhaserAssetDescriptor =
  | PhaserImageAssetDescriptor
  | PhaserAtlasAssetDescriptor

export interface PhaserBoardAssetManifest {
  readonly backgroundCandidates: readonly PhaserImageAssetDescriptor[]
  readonly atlases: readonly PhaserAtlasAssetDescriptor[]
}

const BACKGROUND_VARIANTS_BY_QUALITY: Readonly<
  Record<RenderQualityPreference, readonly BoardBackgroundVariant[]>
> = Object.freeze({
  auto: ['balanced', 'low', 'fallback'] as const,
  high: ['hd', 'balanced', 'low', 'fallback'] as const,
  balanced: ['balanced', 'low', 'fallback'] as const,
  low: ['low', 'fallback'] as const,
})

export function boardBackgroundVariantsForQuality(
  quality: RenderQualityPreference,
): readonly BoardBackgroundVariant[] {
  return BACKGROUND_VARIANTS_BY_QUALITY[quality]
}

export function boardBackgroundTextureKey(
  theme: BoardTheme,
  variant: BoardBackgroundVariant,
): string {
  return `board-background:${theme}:${variant}`
}

export function buildPhaserBoardAssetManifest(
  theme: BoardTheme,
  quality: RenderQualityPreference,
): PhaserBoardAssetManifest {
  const backgroundCandidates = boardBackgroundVariantsForQuality(quality).map((variant) => {
    const asset = boardBackgroundAssetLocation(theme, variant)
    return Object.freeze({
      kind: 'image' as const,
      key: boardBackgroundTextureKey(theme, variant),
      url: asset.url,
    })
  })
  const ambience = boardAmbienceAtlasLocation(theme)
  const sharedAtlases = ['board-ui', 'effects'] as const
  const atlases = [
    Object.freeze({
      kind: 'atlas' as const,
      key: `board-atlas:${ambience.name}`,
      textureUrl: ambience.textureUrl,
      atlasUrl: ambience.atlasUrl,
      requiredFrames: AMBIENCE_ATLAS_FRAMES,
    }),
    ...sharedAtlases.map((name) => {
      const asset = boardSpriteAtlasLocation(name)
      return Object.freeze({
        kind: 'atlas' as const,
        key: `board-atlas:${name}`,
        textureUrl: asset.textureUrl,
        atlasUrl: asset.atlasUrl,
        requiredFrames: name === 'board-ui'
          ? BOARD_UI_ATLAS_FRAMES
          : EFFECTS_ATLAS_FRAMES,
      })
    }),
  ]

  return Object.freeze({
    backgroundCandidates: Object.freeze(backgroundCandidates),
    atlases: Object.freeze(atlases),
  })
}

export function resolveLoadedBoardBackgroundTextureKey(
  manifest: PhaserBoardAssetManifest,
  textureExists: (key: string) => boolean,
): string | null {
  for (const candidate of manifest.backgroundCandidates) {
    if (textureExists(candidate.key)) {
      return candidate.key
    }
  }
  return null
}
