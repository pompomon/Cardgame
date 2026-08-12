import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// AGENTS.md rule #7 forbids `structuredClone(GameState)` in hot loops and
// explicitly calls out both "AI evaluation and render paths": a per-render-pass
// deep clone of the whole game state would tank performance just as badly as
// a per-candidate-action clone in AI evaluation. `ai-no-state-clone.test.ts`
// already enforces this for the AI evaluation surface; this test enforces the
// same rule for the retained-mode Phaser renderer's render-pass modules.
//
// Files are discovered at runtime (rather than a fixed list) so a newly added
// renderer module is automatically covered without editing this test.
//
// If you genuinely need to clone in a different renderer module, prefer a
// narrow, typed copy of just the fields you mutate. If you must add an
// exception here, document the reason and add the path to `EXCEPTIONS`.

const REPO_ROOT = join(__dirname, '..', '..')
const PHASER_DIR = 'src/renderers/phaser'

function discoverPhaserRendererFiles(): string[] {
  const dir = join(REPO_ROOT, PHASER_DIR)
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts'))
    .map((entry) => `${PHASER_DIR}/${entry}`)
    .sort()
}

const EXCEPTIONS: ReadonlySet<string> = new Set()

describe('Phaser renderer render-pass modules', () => {
  it('discovers at least one src/renderers/phaser/*.ts module', () => {
    // Guards against the scanner silently degrading to an empty file list
    // (e.g. a directory rename) and then trivially "passing".
    expect(discoverPhaserRendererFiles().length).toBeGreaterThan(0)
  })

  for (const relativePath of discoverPhaserRendererFiles()) {
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
