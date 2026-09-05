import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')
let outDir: string | null = null

describe('standalone CLI bundle', () => {
  afterAll(() => {
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true })
      outDir = null
    }
  })

  it('builds one Node bundle and completes a fixed-seed game without browser modules', () => {
    outDir = mkdtempSync(join(tmpdir(), 'cardgame-cli-'))
    const vite = resolve(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
    const build = spawnSync(
      process.execPath,
      [vite, 'build', '--config', resolve(REPO_ROOT, 'vite.cli.config.ts')],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, CLI_OUT_DIR: outDir },
        encoding: 'utf8',
        timeout: 120_000,
      },
    )
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
    expect(readdirSync(outDir)).toEqual(['cardgame-cli.mjs'])

    const bundlePath = join(outDir, 'cardgame-cli.mjs')
    const bundle = readFileSync(bundlePath, 'utf8')
    expect(bundle).not.toContain('RTCPeerConnection')
    expect(bundle).not.toContain('localStorage')
    expect(bundle).not.toContain('from "phaser"')

    const run = spawnSync(
      process.execPath,
      [bundlePath, '--mode', 'ai-vs-ai', '--ai-level', 'basic', '--seed', '7', '--delay-ms', '0'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 30_000,
      },
    )
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(run.stdout).toContain('Seed: 7')
    expect(run.stdout).toMatch(/Game over: (Player [12] wins|draw)\./)
  }, 120_000)
})
