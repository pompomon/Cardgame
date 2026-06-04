import {
  readJsonStorageItem,
  removeStorageItem,
  writeJsonStorageItem,
} from './safe-storage'
import { isAdventureRunState, type AdventureRunState } from './adventure'

export const ADVENTURE_RUN_STORAGE_KEY = 'cardgame.adventure-run'

export function persistAdventureRun(run: AdventureRunState): boolean {
  return writeJsonStorageItem(ADVENTURE_RUN_STORAGE_KEY, run)
}

export function clearStoredAdventureRun(): void {
  removeStorageItem(ADVENTURE_RUN_STORAGE_KEY)
}

export function readStoredAdventureRun(): AdventureRunState | null {
  const parsed = readJsonStorageItem(ADVENTURE_RUN_STORAGE_KEY)
  if (parsed === null) {
    return null
  }
  return isAdventureRunState(parsed) ? parsed : null
}
