import { removeStorageItem } from './safe-storage'

const LEGACY_RENDERER_STORAGE_KEY = 'cardgame-renderer'

export function removeLegacyRendererSearch(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('renderer')
  const normalized = params.toString()
  return normalized ? `?${normalized}` : ''
}

export function clearLegacyRendererPreference(): boolean {
  return removeStorageItem(LEGACY_RENDERER_STORAGE_KEY)
}
