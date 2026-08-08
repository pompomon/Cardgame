import { readStorageItem, writeStorageItem } from './safe-storage'

const STORAGE_KEY = 'cardgame.render-quality'

export const RENDER_QUALITY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'low', label: 'Low' },
] as const

export type RenderQualityPreference = typeof RENDER_QUALITY_OPTIONS[number]['value']

export const DEFAULT_RENDER_QUALITY_PREFERENCE: RenderQualityPreference = 'auto'

export function isRenderQualityPreference(value: unknown): value is RenderQualityPreference {
  return typeof value === 'string'
    && RENDER_QUALITY_OPTIONS.some((option) => option.value === value)
}

export function persistRenderQualityPreference(preference: RenderQualityPreference): void {
  writeStorageItem(STORAGE_KEY, preference)
}

export function readStoredRenderQualityPreference(): RenderQualityPreference {
  const value = readStorageItem(STORAGE_KEY)
  return isRenderQualityPreference(value) ? value : DEFAULT_RENDER_QUALITY_PREFERENCE
}
