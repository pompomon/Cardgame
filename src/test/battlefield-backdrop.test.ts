import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')

function normalizeCssWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

const styleCss = normalizeCssWhitespace(readFileSync(join(REPO_ROOT, 'src/style.css'), 'utf8'))
const phaserTheme = readFileSync(join(REPO_ROOT, 'src/renderers/phaser/theme.ts'), 'utf8')

function ruleBody(selector: string): string {
  const normalizedSelector = normalizeCssWhitespace(selector)
  const escapedSelector = normalizedSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styleCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule for ${normalizedSelector}`).not.toBeNull()
  return (match?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('physical-tabletop felt backdrops', () => {
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

    it('defines the --felt-base and --felt-active-glow tokens in :root', () => {
      expect(styleCss).toContain('--felt-base:')
      expect(styleCss).toContain('--felt-active-glow:')
    })

    it('derives 95%-transparent status fills from their border colours', () => {
      expect(styleCss).toContain('--status-active-fill: color-mix(in srgb, var(--battlefield-active-stroke) 5%, transparent 95%)')
      expect(styleCss).toContain('--status-non-active-fill: color-mix(in srgb, var(--battlefield-nonactive-stroke) 5%, transparent 95%)')
    })
  })

  describe('felt play-area gradients', () => {
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

    it('active and non-active share the same felt base gradient (visual consistency)', () => {
      const activeBg = ruleBody('.battlefield-active')
      const nonActiveBg = ruleBody('.battlefield-non-active')
      expect(activeBg).toContain('var(--felt-base)')
      expect(nonActiveBg).toContain('var(--felt-base)')
    })

    it('layers the matching status fill over each battlefield while preserving borders', () => {
      const activeBg = ruleBody('.battlefield-active')
      const nonActiveBg = ruleBody('.battlefield-non-active')
      expect(activeBg).toContain('var(--status-active-fill)')
      expect(activeBg).toContain('border: 2px solid var(--battlefield-active-stroke)')
      expect(nonActiveBg).toContain('var(--status-non-active-fill)')
      expect(nonActiveBg).toContain('border-color: var(--battlefield-nonactive-stroke)')
    })

    it('only the active battlefield gets the lighting glow', () => {
      const activeBg = ruleBody('.battlefield-active')
      const nonActiveBg = ruleBody('.battlefield-non-active')
      expect(activeBg).toContain('--felt-active-glow')
      expect(nonActiveBg).not.toContain('--felt-active-glow')
    })
  })

  describe('drop zone affordance', () => {
    it('.dom-drop-zone--over still references --battlefield-active-bg token', () => {
      const body = ruleBody('.dom-drop-zone--over')
      expect(body).toContain('--battlefield-active-bg')
    })
  })

  describe('player panel status fills', () => {
    it('layers matching 95%-transparent fills over the shared panel surface', () => {
      const activePanel = ruleBody('.player-active')
      const nonActivePanel = ruleBody('.player-non-active')
      expect(activePanel).toContain('var(--status-active-fill)')
      expect(activePanel).toContain('var(--surface-panel)')
      expect(nonActivePanel).toContain('var(--status-non-active-fill)')
      expect(nonActivePanel).toContain('var(--surface-panel)')
    })
  })

  describe('cross-renderer palette sync', () => {
    it('CSS active stroke matches Phaser COLOR_BATTLEFIELD_ACTIVE_STROKE', () => {
      // Hex #72b048 in CSS ↔ 0x72b048 in Phaser
      expect(styleCss).toContain('--battlefield-active-stroke: #72b048')
      expect(phaserTheme).toContain('COLOR_BATTLEFIELD_ACTIVE_STROKE = 0x72b048')
    })

    it('CSS non-active stroke matches Phaser COLOR_BATTLEFIELD_NON_ACTIVE_STROKE', () => {
      // Hex #b46878 in CSS ↔ 0xb46878 in Phaser
      expect(styleCss).toContain('--battlefield-nonactive-stroke: #b46878')
      expect(phaserTheme).toContain('COLOR_BATTLEFIELD_NON_ACTIVE_STROKE = 0xb46878')
    })

    it('Phaser status fills reuse their border colours at 95% transparency', () => {
      expect(phaserTheme).toContain('COLOR_STATUS_ACTIVE_FILL = COLOR_BATTLEFIELD_ACTIVE_STROKE')
      expect(phaserTheme).toContain('COLOR_STATUS_NON_ACTIVE_FILL = COLOR_BATTLEFIELD_NON_ACTIVE_STROKE')
      expect(phaserTheme).toContain('STATUS_FILL_ALPHA = 0.05')
    })
  })
})
