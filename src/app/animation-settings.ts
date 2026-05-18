import { readStorageItem, writeStorageItem } from './safe-storage'
import type { AnimationSpeed } from './types'

const STORAGE_KEY = 'cardgame.animation-speed'

export const ANIMATION_SPEED_OPTIONS: ReadonlyArray<{
  readonly value: AnimationSpeed
  readonly label: string
  readonly baseMs: number
}> = [
  { value: 'off', label: 'Off', baseMs: 0 },
  { value: 'fast', label: 'Fast', baseMs: 150 },
  { value: 'normal', label: 'Normal', baseMs: 350 },
  { value: 'slow', label: 'Slow', baseMs: 700 },
]

export const DEFAULT_ANIMATION_SPEED: AnimationSpeed = 'normal'

// Hard upper bound for any single ability effect, regardless of `baseMs`. Keeps
// AI vs AI sessions watchable and prevents settings from being abused into a
// blocked queue.
export const MAX_EFFECT_MS = 800

// Maximum number of pending ability effects allowed in the visual queue. Once
// exceeded, the oldest pending effects are dropped — they are still recorded
// in the structured log, so the player loses no information.
export const MAX_QUEUED_EFFECTS = 4

export function isAnimationSpeed(value: unknown): value is AnimationSpeed {
  return value === 'off' || value === 'fast' || value === 'normal' || value === 'slow'
}

export function persistAnimationSpeed(speed: AnimationSpeed): void {
  writeStorageItem(STORAGE_KEY, speed)
}

export function readStoredAnimationSpeed(): AnimationSpeed | null {
  const value = readStorageItem(STORAGE_KEY)
  return isAnimationSpeed(value) ? value : null
}

// Resolve the effective speed to use on app boot:
//  - explicit user choice in storage wins
//  - otherwise, if the system advertises `prefers-reduced-motion: reduce`,
//    default animations to `off` so we respect the OS-level preference
//  - otherwise, fall back to `DEFAULT_ANIMATION_SPEED`
export function resolveInitialAnimationSpeed(): AnimationSpeed {
  const stored = readStoredAnimationSpeed()
  if (stored !== null) {
    return stored
  }
  if (prefersReducedMotion()) {
    return 'off'
  }
  return DEFAULT_ANIMATION_SPEED
}

export function prefersReducedMotion(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function durationMsForSpeed(speed: AnimationSpeed): number {
  if (speed === 'off') {
    return 0
  }
  const option = ANIMATION_SPEED_OPTIONS.find((entry) => entry.value === speed) ?? null
  const base = option?.baseMs ?? ANIMATION_SPEED_OPTIONS.find((entry) => entry.value === DEFAULT_ANIMATION_SPEED)!.baseMs
  return Math.min(base, MAX_EFFECT_MS)
}
