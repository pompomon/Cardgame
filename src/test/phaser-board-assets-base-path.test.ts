import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')
const TEST_BASE = '/regression-base/'

let outDir: string | null = null

function runViteBuild(base: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'phaser-board-assets-base-'))
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
  const files = readdirSync(join(dir, 'assets')).filter((name) => name.endsWith('.js'))
  expect(files.length, 'expected at least one built JS bundle').toBeGreaterThan(0)
  return files
    .map((name) => readFileSync(join(dir, 'assets', name), 'utf8'))
    .join('\n')
}

describe('Phaser board asset base path (production bundle)', () => {
  afterAll(() => {
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true })
      outDir = null
    }
  })

  it('bakes the configured Vite BASE_URL into board and sprite URLs', () => {
    const bundle = readBundle(runViteBuild(TEST_BASE))

    expect(
      bundle.includes('import.meta.env.BASE_URL')
        || bundle.includes('import.meta.env?.BASE_URL'),
      'board asset BASE_URL must be statically replaced by Vite',
    ).toBe(false)
    expect(bundle.includes(TEST_BASE), 'configured base should be present').toBe(true)
    expect(bundle.includes('boards/'), 'board URL path should be bundled').toBe(true)
    expect(bundle.includes('background-hd.png'), 'HD background filename should be bundled').toBe(true)
    expect(bundle.includes('sprites/'), 'sprite URL path should be bundled').toBe(true)
    expect(bundle.includes('board-ui'), 'board UI atlas name should be bundled').toBe(true)
    expect(bundle.includes('-atlas.png'), 'atlas texture suffix should be bundled').toBe(true)
  }, 120_000)
})
