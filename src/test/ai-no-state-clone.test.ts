import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// AGENTS.md rule #7 forbids `structuredClone(GameState)` in AI hot loops
// (evaluation / candidate-action scoring), where a per-action deep clone of
// the whole game state would tank performance. This test enforces the rule
// statically by scanning the AI evaluation surface and asserting that no
// `structuredClone` call survives in those files.
//
// `ai-policies/` is discovered at runtime so new policy modules are picked
// up automatically — there is no list to keep in sync when a new AI level
// lands. Other AI-adjacent files are listed explicitly because they live
// at known paths.
//
// If you genuinely need to clone in a different AI module, prefer a narrow,
// typed copy of just the fields you mutate. If you must add an exception
// here, document the reason in the file and add the path to the
// `EXCEPTIONS` list with a comment explaining why.

const REPO_ROOT = join(__dirname, '..', '..')

const AI_POLICIES_DIR = 'src/game/ai-policies'

const AI_HOT_LOOP_FIXED_FILES: readonly string[] = [
  'src/game/ai-evaluation.ts',
  'src/game/ai-action-utils.ts',
  'src/game/ai-visibility.ts',
  'src/game/ai.ts',
]

function discoverAiPolicyFiles(): string[] {
  const dir = join(REPO_ROOT, AI_POLICIES_DIR)
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts'))
    .map((entry) => `${AI_POLICIES_DIR}/${entry}`)
    .sort()
}

const AI_HOT_LOOP_FILES: readonly string[] = [
  ...AI_HOT_LOOP_FIXED_FILES,
  ...discoverAiPolicyFiles(),
]

const EXCEPTIONS: ReadonlySet<string> = new Set()

describe('AI hot-loop modules', () => {
  it('discovers at least one ai-policies/* module', () => {
    // Guards against the scanner silently degrading to an empty policy
    // list (e.g. directory rename) and then trivially "passing".
    expect(discoverAiPolicyFiles().length).toBeGreaterThan(0)
  })

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
