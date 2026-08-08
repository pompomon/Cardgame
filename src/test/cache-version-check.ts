import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_BASE_REF = 'origin/main'
const UNHASHED_ASSET_PREFIXES = [
  'public/cards/',
  'public/boards/',
  'public/sprites/',
] as const
const SERVICE_WORKER_PATH = 'public/sw.js'

export type CacheVersionCheckResult =
  | { kind: 'ok' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'warning'; message: string }

export type CacheVersionCheckInput = {
  baseCacheVersion: string | null
  changedPaths: string[]
  currentCacheVersion: string | null
}

type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; reason: string }

export function extractCacheVersion(source: string): string | null {
  const match = source.match(/\bconst\s+CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/)
  return match?.[1] ?? null
}

export function evaluateCacheVersionCheck({
  baseCacheVersion,
  changedPaths,
  currentCacheVersion,
}: CacheVersionCheckInput): CacheVersionCheckResult {
  const changedAssetPaths = changedPaths.filter((path) =>
    UNHASHED_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix)),
  )
  if (changedAssetPaths.length === 0) {
    return { kind: 'ok' }
  }

  if (baseCacheVersion === null || currentCacheVersion === null) {
    return { kind: 'skipped', reason: 'CACHE_VERSION could not be read from public/sw.js' }
  }

  if (baseCacheVersion !== currentCacheVersion) {
    return { kind: 'ok' }
  }

  return {
    kind: 'warning',
    message: [
      '[cache-version] unhashed public assets changed without a public/sw.js CACHE_VERSION bump.',
      `Changed unhashed asset files: ${changedAssetPaths.join(', ')}`,
      'If these are same-path card/board/sprite changes, bump CACHE_VERSION and note the bump in the PR "Risk / migration notes" section.',
    ].join('\n'),
  }
}

export function checkCacheVersionForRepo(
  repoRoot: string,
  baseRef = DEFAULT_BASE_REF,
): CacheVersionCheckResult {
  if (!gitSucceeds(repoRoot, ['rev-parse', '--verify', baseRef])) {
    return { kind: 'skipped', reason: `${baseRef} is unavailable` }
  }

  const changedPathsResult = runGit(repoRoot, [
    'diff',
    '--name-only',
    // Only modified/renamed/deleted paths matter for the same-path stale-cache
    // concern. Newly added (A) public art was never cached under its URL, so
    // excluding it avoids false-positive CACHE_VERSION warnings.
    '--diff-filter=MRD',
    baseRef,
    '--',
    ...UNHASHED_ASSET_PREFIXES,
  ])
  if (!changedPathsResult.ok) {
    return { kind: 'skipped', reason: changedPathsResult.reason }
  }

  const baseWorkerResult = runGit(repoRoot, ['show', `${baseRef}:${SERVICE_WORKER_PATH}`])
  if (!baseWorkerResult.ok) {
    return { kind: 'skipped', reason: baseWorkerResult.reason }
  }

  let currentWorkerSource: string
  try {
    currentWorkerSource = readFileSync(resolve(repoRoot, SERVICE_WORKER_PATH), 'utf8')
  } catch {
    return { kind: 'skipped', reason: `${SERVICE_WORKER_PATH} could not be read` }
  }
  const changedPaths = changedPathsResult.stdout
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean)

  return evaluateCacheVersionCheck({
    baseCacheVersion: extractCacheVersion(baseWorkerResult.stdout),
    changedPaths,
    currentCacheVersion: extractCacheVersion(currentWorkerSource),
  })
}

function gitSucceeds(repoRoot: string, args: string[]): boolean {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).status === 0
}

function runGit(repoRoot: string, args: string[]): GitResult {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.error?.message || `git ${args.join(' ')} failed`,
    }
  }
  return { ok: true, stdout: result.stdout }
}
