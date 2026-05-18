import { readStorageItem, writeStorageItem } from './safe-storage'
import type { RendererKind } from './types'

const STORAGE_KEY = 'cardgame-renderer'

export function pickRendererKind(search: string, stored: string | null): RendererKind {
  const params = new URLSearchParams(search)
  const requested = params.get('renderer')
  if (requested === 'dom' || requested === 'phaser') {
    return requested
  }
  if (stored === 'dom' || stored === 'phaser') {
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
