import type { BoardBackgroundVariant } from '../../app/board-assets'
import type { RenderQualityPreference } from '../../app/render-quality'
import type { AnimationSpeed } from '../../app/types'

export interface ThreeQualityInput {
  readonly preference: RenderQualityPreference
  readonly width: number
  readonly height: number
  readonly devicePixelRatio?: number
  readonly animationSpeed?: AnimationSpeed
  readonly reducedMotion?: boolean
  readonly hidden?: boolean
}

export interface ThreeQualityProfile {
  readonly tier: 'high' | 'balanced' | 'low'
  readonly pixelRatio: number
  readonly shadows: boolean
  readonly motion: boolean
  readonly effectParticles: number
  readonly ambienceParticles: number
  readonly backgroundVariant: BoardBackgroundVariant
}

export function threeQualityProfile(input: ThreeQualityInput): ThreeQualityProfile {
  const width = Number.isFinite(input.width) ? Math.max(1, input.width) : 1
  const height = Number.isFinite(input.height) ? Math.max(1, input.height) : 1
  const phone = Math.min(width, height) <= 480
  let tier: ThreeQualityProfile['tier']
  switch (input.preference) {
    case 'high':
    case 'balanced':
    case 'low':
      tier = input.preference
      break
    default:
      tier = !phone && width >= 1200 && height >= 760 ? 'high' : 'balanced'
  }
  const cap = tier === 'low' ? 1 : tier === 'high' && !phone ? 2.5 : 2
  const ratio = typeof input.devicePixelRatio === 'number' && Number.isFinite(input.devicePixelRatio) && input.devicePixelRatio > 0
    ? input.devicePixelRatio : 1
  const motion = input.animationSpeed !== 'off' && !input.reducedMotion && !input.hidden
  return Object.freeze({
    tier,
    pixelRatio: Math.min(cap, ratio),
    shadows: tier !== 'low' && !phone,
    motion,
    effectParticles: !motion ? 0 : tier === 'low' || phone ? 3 : 8,
    ambienceParticles: !motion || tier === 'low' ? 0 : phone || tier === 'balanced' ? 3 : 8,
    // Do not churn multi-megabyte background downloads when crossing viewport thresholds.
    backgroundVariant: input.preference === 'high' ? 'hd' : input.preference === 'low' ? 'low' : 'balanced',
  })
}
