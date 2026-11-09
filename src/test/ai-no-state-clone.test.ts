import { describe, expect, it } from 'vitest'

import { discoverAiSourceFiles, readSourceWithoutComments } from './helpers/ai-source-files'

// AGENTS.md rule 8 forbids `structuredClone(GameState)` in AI hot loops
// (evaluation, search and candidate-action scoring), where a per-action deep
// clone of the whole game state would tank performance. This test enforces
// the rule statically: no `structuredClone` call may survive in any AI module.
//
// AI modules (`src/game/ai.ts`, `src/game/ai-*.ts` and
// `src/game/ai-policies/*`) are discovered at runtime, so new modules are
// picked up automatically. Search code advances states with the engine's
// `applyActionForSearch`, which copies only what the engine mutates.
//
// If you genuinely need to clone in an AI module, prefer a narrow, typed
// copy of just the fields you mutate. If you must add an exception here,
// document the reason in the file and add the path to the `EXCEPTIONS` list
// with a comment explaining why.

const AI_HOT_LOOP_FILES: readonly string[] = discoverAiSourceFiles()

const EXCEPTIONS: ReadonlySet<string> = new Set()

describe('AI hot-loop modules', () => {
  it('discovers the AI modules', () => {
    // Guards against the scanner silently degrading to an empty or partial
    // list (e.g. a directory rename) and then trivially "passing".
    for (const known of [
      'src/game/ai.ts',
      'src/game/ai-action-utils.ts',
      'src/game/ai-evaluation.ts',
      'src/game/ai-hard.ts',
      'src/game/ai-search.ts',
      'src/game/ai-visibility.ts',
    ]) {
      expect(AI_HOT_LOOP_FILES).toContain(known)
    }
    expect(AI_HOT_LOOP_FILES.some((file) => file.startsWith('src/game/ai-policies/'))).toBe(true)
  })

  for (const relativePath of AI_HOT_LOOP_FILES) {
    if (EXCEPTIONS.has(relativePath)) {
      continue
    }
    it(`does not call structuredClone in ${relativePath}`, () => {
      expect(readSourceWithoutComments(relativePath)).not.toMatch(/structuredClone\s*\(/)
    })
  }
})
