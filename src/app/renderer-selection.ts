import { readStorageItem, writeStorageItem } from './safe-storage'
import type { RendererKind } from './types'

const STORAGE_KEY = 'cardgame-renderer'

export const RENDERER_OPTIONS: ReadonlyArray<{ value: RendererKind; label: string }> = [
  { value: 'dom', label: 'DOM' },
  { value: 'phaser', label: 'Phaser' },
  { value: 'three', label: 'Three.js' },
]

export function isRendererKind(value: unknown): value is RendererKind {
  return RENDERER_OPTIONS.some((option) => option.value === value)
}

export function rendererSearch(kind: RendererKind, search: string): string {
  const params = new URLSearchParams(search)
  params.set('renderer', kind)
  return `?${params.toString()}`
}

export function pickRendererKind(search: string, stored: string | null): RendererKind {
  const params = new URLSearchParams(search)
  const requested = params.get('renderer')
  if (isRendererKind(requested)) {
    return requested
  }
  if (isRendererKind(stored)) {
    return stored
  }
  return 'dom'
}

export function persistRendererKind(kind: RendererKind): void {
  writeStorageItem(STORAGE_KEY, kind)
}

export function readStoredRendererKind(): string | null {
  return readStorageItem(STORAGE_KEY)
}
