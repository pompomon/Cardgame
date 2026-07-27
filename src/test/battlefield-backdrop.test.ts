import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')

function normalizeCssWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

const styleCss = normalizeCssWhitespace(readFileSync(join(REPO_ROOT, 'src/style.css'), 'utf8'))
const phaserIndex = readFileSync(join(REPO_ROOT, 'src/renderers/phaser/index.ts'), 'utf8')

function ruleBody(selector: string): string {
  const normalizedSelector = normalizeCssWhitespace(selector)
  const escapedSelector = normalizedSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styleCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule for ${normalizedSelector}`).not.toBeNull()
  return (match?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('battlefield parchment backdrops', () => {
  describe('CSS tokens', () => {
    it('defines the --parchment-base token in :root', () => {
      expect(styleCss).toContain('--parchment-base:')
    })

    it('--battlefield-active-bg is a plain colour (required for color-mix in drop-zone)', () => {
      // Must be a hex literal, not a gradient function
      const match = styleCss.match(/--battlefield-active-bg:\s*([^;]+);/)
      expect(match).not.toBeNull()
      const value = (match?.[1] ?? '').trim()
      expect(value).toMatch(/^#[0-9a-fA-F]{3,8}$/)
    })

  })

  describe('gradient backgrounds', () => {
    it('.battlefield-active uses at least 2 gradient layers', () => {
      const body = ruleBody('.battlefield-active')
      const gradientCount = (body.match(/gradient\(/g) ?? []).length
      expect(gradientCount).toBeGreaterThanOrEqual(2)
    })

    it('.battlefield-non-active uses at least 2 gradient layers', () => {
      const body = ruleBody('.battlefield-non-active')
      const gradientCount = (body.match(/gradient\(/g) ?? []).length
      expect(gradientCount).toBeGreaterThanOrEqual(2)
    })

    it('active and non-active share the same parchment base gradient (visual consistency)', () => {
      const activeBg = ruleBody('.battlefield-active')
      const nonActiveBg = ruleBody('.battlefield-non-active')
      // Both should end with the same parchment linear-gradient as their fallback layer
      expect(activeBg).toContain('#c4a060')
      expect(nonActiveBg).toContain('#c4a060')
    })
  })

  describe('drop zone affordance', () => {
    it('.dom-drop-zone--over still references --battlefield-active-bg token', () => {
      const body = ruleBody('.dom-drop-zone--over')
      expect(body).toContain('--battlefield-active-bg')
    })
  })

  describe('cross-renderer palette sync', () => {
    it('CSS active stroke matches Phaser COLOR_BATTLEFIELD_ACTIVE_STROKE', () => {
      // Hex #72b048 in CSS ↔ 0x72b048 in Phaser
      expect(styleCss).toContain('--battlefield-active-stroke: #72b048')
      expect(phaserIndex).toContain('COLOR_BATTLEFIELD_ACTIVE_STROKE = 0x72b048')
    })

    it('CSS non-active stroke matches Phaser COLOR_BATTLEFIELD_NON_ACTIVE_STROKE', () => {
      // Hex #b46878 in CSS ↔ 0xb46878 in Phaser
      expect(styleCss).toContain('--battlefield-nonactive-stroke: #b46878')
      expect(phaserIndex).toContain('COLOR_BATTLEFIELD_NON_ACTIVE_STROKE = 0xb46878')
    })
  })
})
