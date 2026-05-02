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
  try {
    localStorage.setItem(STORAGE_KEY, kind)
  } catch {
    // Ignore storage failures and keep default/in-memory behavior.
  }
}

export function readStoredRendererKind(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
