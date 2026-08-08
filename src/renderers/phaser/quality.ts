import type { RenderQualityPreference } from '../../app/render-quality'

const DEFAULT_GAME_RESOLUTION = 1
const MAX_MOBILE_GAME_RESOLUTION = 2
const MAX_DESKTOP_GAME_RESOLUTION = 2.5
const MOBILE_MAX_SHORT_EDGE = 480
const MOBILE_MAX_LONG_EDGE = 950
const HIGH_AMBIENCE_SPRITES = 12
const BALANCED_AMBIENCE_SPRITES = 6
const MOBILE_AMBIENCE_DIVISOR = 2

export interface PhaserGameResolutionInput {
  width: number
  height: number
  devicePixelRatio?: number
}

export interface BoardAmbiencePolicyInput {
  readonly quality: RenderQualityPreference
  readonly width: number
  readonly height: number
  readonly animationsEnabled: boolean
  readonly reducedMotion: boolean
  readonly pageVisible: boolean
}

export interface BoardAmbiencePolicy {
  readonly maxSprites: number
  readonly alpha: number
  readonly driftPixels: number
  readonly speed: number
}

function normalizeViewportDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function normalizeDevicePixelRatio(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : DEFAULT_GAME_RESOLUTION
}

export function isPhoneSizedViewport(width: number, height: number): boolean {
  const safeWidth = normalizeViewportDimension(width)
  const safeHeight = normalizeViewportDimension(height)
  const shortEdge = Math.min(safeWidth, safeHeight)
  const longEdge = Math.max(safeWidth, safeHeight)
  return shortEdge <= MOBILE_MAX_SHORT_EDGE && longEdge <= MOBILE_MAX_LONG_EDGE
}

export function resolveGameResolution(input: PhaserGameResolutionInput): number {
  const ratio = normalizeDevicePixelRatio(input.devicePixelRatio)
  const maxResolution = isPhoneSizedViewport(input.width, input.height)
    ? MAX_MOBILE_GAME_RESOLUTION
    : MAX_DESKTOP_GAME_RESOLUTION
  return Math.min(ratio, maxResolution)
}

export function resolveBoardAmbiencePolicy(
  input: BoardAmbiencePolicyInput,
): BoardAmbiencePolicy {
  if (
    !input.animationsEnabled
    || input.reducedMotion
    || !input.pageVisible
    || input.quality === 'low'
  ) {
    return {
      maxSprites: 0,
      alpha: 0,
      driftPixels: 0,
      speed: 0,
    }
  }

  const isPhone = isPhoneSizedViewport(input.width, input.height)
  switch (input.quality) {
    case 'high':
      return {
        maxSprites: isPhone
          ? HIGH_AMBIENCE_SPRITES / MOBILE_AMBIENCE_DIVISOR
          : HIGH_AMBIENCE_SPRITES,
        alpha: isPhone ? 0.2 : 0.28,
        driftPixels: isPhone ? 10 : 18,
        speed: 0.00022,
      }
    case 'auto':
    case 'balanced':
      return {
        maxSprites: isPhone
          ? BALANCED_AMBIENCE_SPRITES / MOBILE_AMBIENCE_DIVISOR
          : BALANCED_AMBIENCE_SPRITES,
        alpha: isPhone ? 0.14 : 0.2,
        driftPixels: isPhone ? 6 : 10,
        speed: 0.00016,
      }
    default:
      return {
        maxSprites: 0,
        alpha: 0,
        driftPixels: 0,
        speed: 0,
      }
  }
}
