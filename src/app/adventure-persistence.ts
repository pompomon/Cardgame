import {
  readJsonStorageItem,
  removeStorageItem,
  writeJsonStorageItem,
} from './safe-storage'
import {
  createAdventureRunId,
  isAdventureRunId,
  isLegacyAdventureRunState,
  migrateLegacyAdventureRun,
  normalizeAdventureRun,
  type AdventureRunState,
} from './adventure'
import { isRecordObject } from './validators'

export const ADVENTURE_RUN_STORAGE_KEY = 'cardgame.adventure-run'

export interface StoredAdventureRunRecord {
  run: AdventureRunState
  /** True when `run` was converted in memory from an unversioned save. */
  migratedFromV1: boolean
}

/**
 * Writes a schema version 2 run. Invalid runs are refused (returns false)
 * so storage never holds a run that the reader would reject.
 */
export function persistAdventureRun(run: AdventureRunState): boolean {
  const normalized = normalizeAdventureRun(run)
  return normalized !== null && writeJsonStorageItem(ADVENTURE_RUN_STORAGE_KEY, normalized)
}

export function clearStoredAdventureRun(): void {
  removeStorageItem(ADVENTURE_RUN_STORAGE_KEY)
}

/**
 * Reads the stored run without ever writing. A valid schema version 2 run is
 * returned as a detached copy. A payload without a `schemaVersion` key is a
 * version 1 run: it must pass the strict version 1 guard and is then
 * converted in memory with an unsaved run ID. Anything else, including
 * unknown versions, is unavailable rather than repaired.
 *
 * `conversionRunId` lets a caller keep the unsaved ID it already showed for
 * an earlier conversion, so the first version 2 write uses that ID. It is
 * ignored for version 2 payloads, and a fresh ID is used when it is invalid.
 */
export function readStoredAdventureRunRecord(conversionRunId?: string): StoredAdventureRunRecord | null {
  const parsed = readJsonStorageItem(ADVENTURE_RUN_STORAGE_KEY)
  if (!isRecordObject(parsed)) {
    return null
  }
  if ('schemaVersion' in parsed) {
    const run = normalizeAdventureRun(parsed)
    return run ? { run, migratedFromV1: false } : null
  }
  if (!isLegacyAdventureRunState(parsed)) {
    return null
  }
  const runId = isAdventureRunId(conversionRunId) ? conversionRunId : createAdventureRunId()
  const run = migrateLegacyAdventureRun(parsed, runId)
  return run ? { run, migratedFromV1: true } : null
}

export function readStoredAdventureRun(): AdventureRunState | null {
  return readStoredAdventureRunRecord()?.run ?? null
}
