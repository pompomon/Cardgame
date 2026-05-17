// Regression test for the GitHub Pages base-path bug where card-art URLs were
// emitted as `/cards/...` instead of `/Cardgame/cards/...` because the source
// accessed `import.meta.env.BASE_URL` through an intermediate alias that
// defeated Vite's static replacement. We verify the production bundle by
// running `vite build` with a custom VITE_BASE_PATH and confirming the built
// JS contains the configured base baked into the card URL template, and that
// no `import.meta.env` reference survives in the BASE_URL access path.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')
const TEST_BASE = '/regression-base/'

let outDir: string | null = null

function runViteBuild(base: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'card-art-base-'))
  outDir = dir
  const result = spawnSync(
    process.execPath,
    [resolve(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dir, '--emptyOutDir'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, VITE_BASE_PATH: base, NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 120_000,
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `vite build failed (status=${result.status}):\n${result.stdout}\n${result.stderr}`,
    )
  }
  return dir
}

function readBundle(dir: string): string {
  const assetsDir = join(dir, 'assets')
  const files = readdirSync(assetsDir).filter((name) => name.endsWith('.js'))
  expect(files.length, 'expected at least one built JS bundle').toBeGreaterThan(0)
  return files
    .map((name) => readFileSync(join(assetsDir, name), 'utf8'))
    .join('\n')
}

describe('card-art base path (production bundle)', () => {
  afterAll(() => {
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true })
      outDir = null
    }
  })

  it('bakes the configured Vite BASE_URL into card-art URLs', () => {
    const dir = runViteBuild(TEST_BASE)
    const bundle = readBundle(dir)

    // The BASE_URL access must have been statically replaced — no
    // `import.meta.env.BASE_URL` reference must survive in the bundle.
    expect(
      bundle.includes('import.meta.env.BASE_URL') ||
        bundle.includes('import.meta.env?.BASE_URL'),
      'import.meta.env.BASE_URL must be statically replaced by Vite, not left as a runtime lookup',
    ).toBe(false)

    // The configured base must appear in the bundle so that
    // `${basePath()}cards/${style}/${land}.png` resolves to e.g.
    // `/regression-base/cards/hd/Forest.png` at runtime.
    expect(
      bundle.includes(TEST_BASE),
      `built bundle should reference the configured base '${TEST_BASE}'`,
    ).toBe(true)
  }, 120_000)
})
