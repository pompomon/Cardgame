import { readStorageItem, writeStorageItem } from './safe-storage'

const STORAGE_KEY = 'cardgame.render-quality'

export const RENDER_QUALITY_PREFERENCES = ['auto', 'high', 'balanced', 'low'] as const

export type RenderQualityPreference = typeof RENDER_QUALITY_PREFERENCES[number]

export const DEFAULT_RENDER_QUALITY_PREFERENCE: RenderQualityPreference = 'auto'

const RENDER_QUALITY_LABELS: Record<RenderQualityPreference, string> = {
  auto: 'Auto',
  high: 'High',
  balanced: 'Balanced',
  low: 'Low',
}

export const RENDER_QUALITY_PREFERENCE_OPTIONS: ReadonlyArray<{
  readonly value: RenderQualityPreference
  readonly label: string
}> = RENDER_QUALITY_PREFERENCES.map((value) => ({
  value,
  label: RENDER_QUALITY_LABELS[value],
}))

export function isRenderQualityPreference(value: unknown): value is RenderQualityPreference {
  return typeof value === 'string'
    && (RENDER_QUALITY_PREFERENCES as readonly string[]).includes(value)
}

export function persistRenderQualityPreference(preference: RenderQualityPreference): void {
  writeStorageItem(STORAGE_KEY, preference)
}

export function readStoredRenderQualityPreference(): RenderQualityPreference {
  const value = readStorageItem(STORAGE_KEY)
  return isRenderQualityPreference(value) ? value : DEFAULT_RENDER_QUALITY_PREFERENCE
}
