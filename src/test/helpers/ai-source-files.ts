import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const REPO_ROOT = join(__dirname, '..', '..', '..')

const GAME_DIR = 'src/game'
const AI_POLICIES_DIR = 'src/game/ai-policies'

function isSourceFile(entry: string): boolean {
  return entry.endsWith('.ts') && !entry.endsWith('.d.ts')
}

/**
 * Every AI module: `src/game/ai.ts`, `src/game/ai-*.ts` and
 * `src/game/ai-policies/*.ts`, sorted. Discovered at runtime, so static
 * guards cover new AI modules without a list to keep in sync.
 */
export function discoverAiSourceFiles(): string[] {
  const gameFiles = readdirSync(join(REPO_ROOT, GAME_DIR))
    .filter((entry) => isSourceFile(entry) && (entry === 'ai.ts' || entry.startsWith('ai-')))
    .map((entry) => `${GAME_DIR}/${entry}`)
  const policyFiles = readdirSync(join(REPO_ROOT, AI_POLICIES_DIR))
    .filter(isSourceFile)
    .map((entry) => `${AI_POLICIES_DIR}/${entry}`)
  return [...gameFiles, ...policyFiles].sort()
}

/**
 * Reads a source file without its comments, so documentation that mentions
 * a banned call does not trip a static guard.
 */
export function readSourceWithoutComments(relativePath: string): string {
  const source = readFileSync(join(REPO_ROOT, relativePath), 'utf8')
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
