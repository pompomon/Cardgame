import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')
const SOURCE_ROOT = join(REPO_ROOT, 'src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (entry === 'test') return []
    if (entry.endsWith('.ts')) return [path]
    try {
      return sourceFiles(path)
    } catch {
      return []
    }
  })
}

describe('browser renderer architecture', () => {
  it('ships Three.js as the only browser renderer dependency and implementation', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(packageJson.dependencies).toEqual({ three: expect.any(String) })
    const phaserDirectory = join(SOURCE_ROOT, 'renderers', 'phaser')
    expect(existsSync(phaserDirectory) ? readdirSync(phaserDirectory) : []).toEqual([])
    expect(existsSync(join(SOURCE_ROOT, 'renderers', 'dom.ts'))).toBe(false)
    expect(existsSync(join(SOURCE_ROOT, 'renderers', 'dom-utils.ts'))).toBe(false)
  })

  it('keeps production source free of legacy renderer imports and state', () => {
    const source = sourceFiles(SOURCE_ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(source).not.toMatch(/(?:from\s+|import\()['"][^'"]*phaser/i)
    expect(source).not.toContain('DomRenderer')
    expect(source).not.toContain('RendererKind')
  })
})
