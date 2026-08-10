// Adaptive desktop/mobile render-quality policy for the Phaser renderer.
//
// The renderer-neutral *preference* ('auto' | 'high' | 'balanced' | 'low')
// lives in src/app/render-quality.ts. This module turns that preference plus
// device signals (viewport size, device pixel ratio, reduced motion, page
// visibility) into a concrete, typed `PhaserQualityProfile` that retained
// views (background/ambience, card views, effects) reconcile against.
//
// Phaser 4 API note: `Phaser.Types.Core.GameConfig` has no `resolution`
// option and `ScaleManager` never multiplies the canvas backing store by
// `window.devicePixelRatio` (verified against phaser@4.1.0 —
// node_modules/phaser/src/scale/ScaleManager.js has no devicePixelRatio
// usage, and only `zoom` / `setGameSize` / `resize` affect canvas size). With
// `Phaser.Scale.RESIZE` the drawing buffer therefore already matches CSS
// pixels, so `maxDevicePixelRatio` below is an explicit policy bound used for
// asset-tier decisions and by `resolveGameResolution` — we deliberately do
// not change scale-manager behaviour.
import type { BoardBackgroundVariant } from '../../app/board-assets'
import type { RenderQualityPreference } from '../../app/render-quality'
import type { AnimationSpeed } from '../../app/types'

const DEFAULT_GAME_RESOLUTION = 1
const MOBILE_MAX_SHORT_EDGE = 480
const MOBILE_MAX_LONG_EDGE = 950
const DESKTOP_HIGH_TIER_MIN_WIDTH = 1200
const DESKTOP_HIGH_TIER_MIN_HEIGHT = 760

const MAX_MOBILE_DEVICE_PIXEL_RATIO = 2

export type PhaserQualityTier = 'high' | 'balanced' | 'low'

export type PhaserAmbienceLevel = 'full' | 'reduced' | 'off'

export type PhaserEffectDetail = 'full' | 'reduced'

const TIER_MAX_DEVICE_PIXEL_RATIO: Record<PhaserQualityTier, number> = {
  high: 2.5,
  balanced: 2,
  low: 1.5,
}

const TIER_BACKGROUND_VARIANT: Record<PhaserQualityTier, BoardBackgroundVariant> = {
  high: 'hd',
  balanced: 'balanced',
  low: 'low',
}

export interface PhaserQualityProfile {
  readonly tier: PhaserQualityTier
  /** Explicit policy bound; see the Phaser 4 API note at the top of this file. */
  readonly maxDevicePixelRatio: number
  readonly backgroundVariant: BoardBackgroundVariant
  readonly ambience: PhaserAmbienceLevel
  readonly maxParticles: number
  readonly effectDetail: PhaserEffectDetail
  readonly enableMoveTweens: boolean
  readonly enableHoverTweens: boolean
}

export interface PhaserQualityProfileInput {
  readonly preference: RenderQualityPreference
  readonly width: number
  readonly height: number
  readonly animationSpeed?: AnimationSpeed
  readonly reducedMotion?: boolean
  readonly documentHidden?: boolean
}

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

// 'auto' resolves conservatively: phone-sized viewports get the balanced tier
// (never 'high'), and desktop-sized viewports only reach 'high' once the
// viewport is comfortably large. Unknown/awkward sizes fall back to balanced.
function resolveTier(
  preference: RenderQualityPreference,
  phoneSized: boolean,
  width: number,
  height: number,
): PhaserQualityTier {
  switch (preference) {
    case 'high':
      return 'high'
    case 'balanced':
      return 'balanced'
    case 'low':
      return 'low'
    case 'auto':
      if (phoneSized) {
        return 'balanced'
      }
      return width >= DESKTOP_HIGH_TIER_MIN_WIDTH && height >= DESKTOP_HIGH_TIER_MIN_HEIGHT
        ? 'high'
        : 'balanced'
    default:
      return 'balanced'
  }
}

function resolveMaxDevicePixelRatio(tier: PhaserQualityTier, phoneSized: boolean): number {
  const tierCap = TIER_MAX_DEVICE_PIXEL_RATIO[tier]
  return phoneSized ? Math.min(tierCap, MAX_MOBILE_DEVICE_PIXEL_RATIO) : tierCap
}

function resolveAmbience(
  tier: PhaserQualityTier,
  motionSuppressed: boolean,
): PhaserAmbienceLevel {
  if (motionSuppressed || tier === 'low') {
    return 'off'
  }
  return tier === 'high' ? 'full' : 'reduced'
}

function resolveMaxParticles(ambience: PhaserAmbienceLevel, phoneSized: boolean): number {
  switch (ambience) {
    case 'full':
      return phoneSized ? 4 : 8
    case 'reduced':
      return phoneSized ? 2 : 4
    case 'off':
      return 0
    default:
      return 0
  }
}

export function resolvePhaserQualityProfile(
  input: PhaserQualityProfileInput,
): PhaserQualityProfile {
  const width = normalizeViewportDimension(input.width)
  const height = normalizeViewportDimension(input.height)
  const phoneSized = isPhoneSizedViewport(width, height)
  const tier = resolveTier(input.preference, phoneSized, width, height)
  const motionSuppressed = input.reducedMotion === true
    || input.animationSpeed === 'off'
    || input.documentHidden === true
  const ambience = resolveAmbience(tier, motionSuppressed)
  const enableMoveTweens = !motionSuppressed

  return Object.freeze({
    tier,
    maxDevicePixelRatio: resolveMaxDevicePixelRatio(tier, phoneSized),
    backgroundVariant: TIER_BACKGROUND_VARIANT[tier],
    ambience,
    maxParticles: resolveMaxParticles(ambience, phoneSized),
    effectDetail: tier === 'high' && !phoneSized ? 'full' : 'reduced',
    enableMoveTweens,
    enableHoverTweens: enableMoveTweens && tier !== 'low',
  })
}

export function resolveGameResolution(input: PhaserGameResolutionInput): number {
  const ratio = normalizeDevicePixelRatio(input.devicePixelRatio)
  const profile = resolvePhaserQualityProfile({
    preference: 'auto',
    width: input.width,
    height: input.height,
  })
  return Math.min(ratio, profile.maxDevicePixelRatio)
}
