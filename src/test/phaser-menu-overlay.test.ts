import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')
const INDEX_PATH = join(REPO_ROOT, 'src/renderers/phaser/index.ts')
const MENU_OVERLAY_PATH = join(REPO_ROOT, 'src/renderers/phaser/menu-overlay.ts')

describe('phaser menu overlay extraction', () => {
  it('keeps menu overlay rendering in its own module', () => {
    expect(existsSync(MENU_OVERLAY_PATH)).toBe(true)

    const indexSource = readFileSync(INDEX_PATH, 'utf8')
    const menuOverlaySource = readFileSync(MENU_OVERLAY_PATH, 'utf8')

    expect(indexSource).toContain("from './menu-overlay'")
    expect(menuOverlaySource).toContain('export function createMenuOverlay')
  })

  it('keeps phaser/index.ts below the T-3 extraction size target', () => {
    const lineCount = readFileSync(INDEX_PATH, 'utf8').split('\n').length

    expect(lineCount).toBeLessThanOrEqual(3004)
  })
})
