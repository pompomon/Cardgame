import type { RenderQualityPreference } from '../../app/render-quality'
import type { AnimationSpeed } from '../../app/types'

const DEFAULT_GAME_RESOLUTION = 1
const MAX_MOBILE_GAME_RESOLUTION = 2
const MAX_DESKTOP_GAME_RESOLUTION = 2.5
const MOBILE_MAX_SHORT_EDGE = 480
const MOBILE_MAX_LONG_EDGE = 950

export const MAX_BOARD_AMBIENCE_SPRITES = 10
const BALANCED_DESKTOP_AMBIENCE_SPRITES = 6
const BALANCED_PHONE_AMBIENCE_SPRITES = 3
const HIGH_PHONE_AMBIENCE_SPRITES = 5

export interface PhaserGameResolutionInput {
  width: number
  height: number
  devicePixelRatio?: number
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

export interface BoardAmbienceInput {
  readonly width: number
  readonly height: number
  readonly quality: RenderQualityPreference
  readonly animationSpeed: AnimationSpeed
  readonly reducedMotion: boolean
  readonly pageVisible: boolean
}

export function resolveBoardAmbienceSpriteCount(input: BoardAmbienceInput): number {
  if (
    input.quality === 'low'
    || input.animationSpeed === 'off'
    || input.reducedMotion
    || !input.pageVisible
  ) {
    return 0
  }

  const phoneSized = isPhoneSizedViewport(input.width, input.height)
  if (input.quality === 'high') {
    return phoneSized
      ? HIGH_PHONE_AMBIENCE_SPRITES
      : MAX_BOARD_AMBIENCE_SPRITES
  }
  return phoneSized
    ? BALANCED_PHONE_AMBIENCE_SPRITES
    : BALANCED_DESKTOP_AMBIENCE_SPRITES
}
