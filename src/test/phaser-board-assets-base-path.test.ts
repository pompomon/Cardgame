import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    [
      resolve(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--ssr',
      'src/app/board-assets.ts',
      '--outDir',
      dir,
      '--emptyOutDir',
    ],
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
  return readFileSync(join(dir, 'board-assets.js'), 'utf8')
}

function evaluateBuiltUrls(dir: string): {
  backgroundUrl: string
  spriteUrl: string
} {
  const moduleUrl = `file://${join(dir, 'board-assets.js')}`
  const script = [
    `const assets = await import(${JSON.stringify(moduleUrl)});`,
    'console.log(JSON.stringify({',
    "backgroundUrl: assets.boardBackgroundAssetLocation('classic', 'hd').url,",
    "spriteUrl: assets.boardSpriteAtlasLocation('board-ui').textureUrl,",
    '}));',
  ].join('')
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0) {
    throw new Error(
      `built board-assets module failed (status=${result.status}):\n${result.stdout}\n${result.stderr}`,
    )
  }
  return JSON.parse(result.stdout) as {
    backgroundUrl: string
    spriteUrl: string
  }
}

describe('Phaser board asset base path (production bundle)', () => {
  afterAll(() => {
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true })
      outDir = null
    }
  })

  it('bakes the configured Vite BASE_URL into board and sprite URLs', () => {
    const dir = runViteBuild(TEST_BASE)
    const bundle = readBundle(dir)

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
    expect(evaluateBuiltUrls(dir)).toEqual({
      backgroundUrl: '/regression-base/boards/classic/background-hd.png',
      spriteUrl: '/regression-base/sprites/board-ui-atlas.png',
    })
  }, 120_000)
})
