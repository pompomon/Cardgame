import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'interface.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
const card = '.three-interface .card-tile'
const preview = '.three-interface .three-dialog[data-modal="preview"]'
const art = `${card} .dom-card__art-frame`

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('Three.js native card and preview layout', () => {
  it('gives previews and target cards a self-contained stacked layout', () => {
    const rule = ruleBody(card)
    expect(rule).toContain('display: grid;')
    expect(rule).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(rule).toContain('grid-template-rows: auto auto;')
    expect(rule).toContain('--dom-radius: 12px;')
    expect(rule).toContain('width: min(160px, 100%);')
    expect(rule).toContain('min-height: 0;')
    expect(ruleBody(`${preview} > .card-tile`)).not.toMatch(/display:\s*(?:inline-)?flex/)
  })

  it('reserves a square art frame even before the absolutely positioned image loads', () => {
    expect(ruleBody(art)).toContain('width: 100%;')
    expect(ruleBody(art)).toContain('aspect-ratio: 1;')
    const image = ruleBody(`${art} img`)
    expect(image).toContain('width: 100%;')
    expect(image).toContain('height: 100%;')
    expect(image).toContain('object-fit: contain;')
  })

  it('enlarges procedural artwork and keeps raster scaling smooth, including after fallback', () => {
    const image = ruleBody(`${art} img`)
    expect(Array.from(image.matchAll(/image-rendering:\s*([^;]+);/g), (match) => match[1]))
      .toEqual(['crisp-edges', 'pixelated'])
    const raster = '.three-interface .card-tile--raster .dom-card__art-frame img'
    expect(ruleBody(raster)).toContain('image-rendering: auto;')
    expect(css.indexOf(`${raster} {`)).toBeGreaterThan(css.indexOf(`${art} img {`))
  })

  it('bounds preview width by viewport height with safe-area and plain-value fallbacks', () => {
    const rule = ruleBody(`${preview} > .card-tile`)
    expect(rule).toContain('min(280px, 100%, max(120px, calc(100vh - 14rem)))')
    expect(rule).toContain('100dvh - 14rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)')
    expect(rule.indexOf('100dvh')).toBeGreaterThan(rule.indexOf('100vh'))
    const dialog = ruleBody(preview)
    expect(dialog).toContain('inset: 16px 12px;')
    expect(dialog).toContain('width: min(400px, calc(100% - 24px));')
    expect(dialog).toContain('env(safe-area-inset-left)')
    expect(dialog).toContain('env(safe-area-inset-right)')
  })

  it('keeps the close header visible when large text requires scrolling', () => {
    expect(ruleBody(`${preview} > header`)).toContain('position: sticky;')
    expect(ruleBody(`${preview} > header`)).toContain('top: 0;')
    expect(ruleBody('.three-interface .three-dialog')).toContain('overflow: auto;')
  })
})
