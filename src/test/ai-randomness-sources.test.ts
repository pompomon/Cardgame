import { describe, expect, it } from 'vitest'

import { discoverAiSourceFiles, readSourceWithoutComments } from './helpers/ai-source-files'

// AI choices must repeat exactly for the same state, seat, game seed and
// budget: CLI fixtures, tests and Adventure pause/resume depend on it. AI
// modules therefore take every random number from the seeded streams in
// `src/game/ai-random.ts` and never read a clock, which would also make a
// decision depend on device speed.

const BANNED_SOURCES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'Math.random', pattern: /\bMath\s*\.\s*random\b/ },
  { label: 'Date.now', pattern: /\bDate\s*\.\s*now\b/ },
  { label: 'new Date', pattern: /\bnew\s+Date\b/ },
  { label: 'performance.now', pattern: /\bperformance\s*\.\s*now\b/ },
  { label: 'crypto', pattern: /\bcrypto\s*\.\s*(getRandomValues|randomUUID)\b/ },
]

describe('AI randomness sources', () => {
  const files = discoverAiSourceFiles()

  it('scans the seeded random module and the policies', () => {
    expect(files).toContain('src/game/ai-random.ts')
    expect(files.some((file) => file.startsWith('src/game/ai-policies/'))).toBe(true)
  })

  for (const relativePath of files) {
    it(`uses only seeded randomness in ${relativePath}`, () => {
      const source = readSourceWithoutComments(relativePath)
      for (const banned of BANNED_SOURCES) {
        expect(source, `${relativePath} uses ${banned.label}`).not.toMatch(banned.pattern)
      }
    })
  }
})
