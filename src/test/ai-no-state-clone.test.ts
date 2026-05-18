import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// AGENTS.md rule #7 forbids `structuredClone(GameState)` in AI hot loops
// (evaluation / candidate-action scoring), where a per-action deep clone of
// the whole game state would tank performance. This test enforces the rule
// statically by scanning the AI evaluation surface and asserting that no
// `structuredClone` call survives in those files.
//
// If you genuinely need to clone in a different AI module, prefer a narrow,
// typed copy of just the fields you mutate. If you must add an exception
// here, document the reason in the file and add the path to the
// `EXCEPTIONS` list with a comment explaining why.

const AI_HOT_LOOP_FILES = [
  'src/game/ai-evaluation.ts',
  'src/game/ai-policies/basic.ts',
  'src/game/ai-policies/advanced.ts',
  'src/game/ai-policies/hard.ts',
  'src/game/ai-action-utils.ts',
  'src/game/ai-visibility.ts',
  'src/game/ai.ts',
] as const

const EXCEPTIONS: ReadonlySet<string> = new Set()

const REPO_ROOT = join(__dirname, '..', '..')

describe('AI hot-loop modules', () => {
  for (const relativePath of AI_HOT_LOOP_FILES) {
    if (EXCEPTIONS.has(relativePath)) {
      continue
    }
    it(`does not call structuredClone in ${relativePath}`, () => {
      const fullPath = join(REPO_ROOT, relativePath)
      const source = readFileSync(fullPath, 'utf8')
      // Strip line comments and block comments before searching so a
      // legitimate documentation mention of `structuredClone` does not
      // trigger the guard. We only care about real call sites.
      const withoutLineComments = source.replace(/\/\/.*$/gm, '')
      const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '')
      expect(withoutComments).not.toMatch(/structuredClone\s*\(/)
    })
  }
})
