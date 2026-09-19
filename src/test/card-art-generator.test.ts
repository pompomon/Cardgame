import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { cardAssetSlug } from '../app/card-catalog'
import { BASIC_LANDS } from '../game/types'

const REPO_ROOT = resolve(__dirname, '..', '..')
const GENERATOR = resolve(REPO_ROOT, 'scripts', 'generate-card-art.mjs')
const PHOTOREAL_GENERATOR = resolve(REPO_ROOT, 'scripts', 'generate-photoreal-card-art.mjs')
const GENERATED_STYLES = ['classic', 'hd-fallback', 'monochrome'] as const
const EXPECTED_FILES = BASIC_LANDS.map((land) => `${cardAssetSlug(land)}.png`).sort()
const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'card-art-generator-'))
  temporaryDirectories.push(directory)
  return directory
}

function runGenerator(output: string): void {
  const result = spawnSync(
    process.execPath,
    [GENERATOR, '--output', output, '--size', '256'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false
  return first.every((byte, index) => byte === second[index])
}

describe('card art generators', () => {
  afterAll(() => {
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('writes the exact slug inventory reproducibly for every deterministic style', () => {
    const first = temporaryDirectory()
    const second = temporaryDirectory()
    runGenerator(first)
    runGenerator(second)

    for (const style of GENERATED_STYLES) {
      expect(readdirSync(resolve(first, style)).sort()).toEqual(EXPECTED_FILES)
      expect(readdirSync(resolve(second, style)).sort()).toEqual(EXPECTED_FILES)
      for (const filename of EXPECTED_FILES) {
        expect(bytesEqual(
          readFileSync(resolve(first, style, filename)),
          readFileSync(resolve(second, style, filename)),
        ), `${style}/${filename} should be byte-identical`).toBe(true)
      }
    }
  }, 120_000)

  it('documents the catalog slug/key selector for manual HD generation', () => {
    const result = spawnSync(process.execPath, [PHOTOREAL_GENERATOR, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('--card=selector')
    expect(result.stdout).toContain('gravebloom-dryad')
    expect(result.stdout).toContain('Forest')
    expect(result.stdout).not.toContain('--land=')
  })

  it('rejects deterministic output below the documented minimum dimensions', () => {
    const result = spawnSync(
      process.execPath,
      [GENERATOR, '--output', temporaryDirectory(), '--size', '128'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('size must be an integer from 256 to 2048')
  })
})
