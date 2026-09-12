import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'interface.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
const rendererCss = readFileSync(join(__dirname, '..', 'renderers', 'three', 'renderer.css'), 'utf8')
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

function ruleBodyContaining(selector: string, declaration: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  const body = matches.map((match) => match[1]).find((candidate) => candidate.includes(declaration))
  expect(body, `Missing ${declaration} in a ${selector} rule`).toBeDefined()
  return body ?? ''
}

describe('Three.js native card and preview layout', () => {
  it('keeps gameplay in a viewport shell and lets the Cards dialog scroll internally', () => {
    expect(rendererCss).toMatch(/\.three-root\.three-root--game \{[^}]*height: 100dvh;/)
    expect(rendererCss).toMatch(/\.three-root\.three-root--game \{[^}]*overflow: hidden;/)
    expect(rendererCss).toMatch(/\.three-root\.three-root--game \{[^}]*grid-template-rows: clamp\(96px, 16dvh, 144px\) minmax\(0, 1fr\);/)
    expect(rendererCss).toMatch(/\.three-root--game \.three-hud-mount \{[^}]*height: 100%;[^}]*overflow: auto;[^}]*scrollbar-gutter: stable;/)
    expect(rendererCss).toMatch(/\.three-root--game \.three-controls \{[^}]*position: fixed;/)
    expect(rendererCss).not.toContain('--three-board-min-height')
    const hud = ruleBodyContaining('.three-interface .three-hud', 'min-height: 100%;')
    expect(hud).toContain('min-height: 100%;')
    expect(hud).toContain('font-size: 0.8125rem;')
    expect(hud).toContain('line-height: 1.25;')
    expect(ruleBody('.three-interface .three-hud p')).toContain('margin: 2px 0;')
    expect(css).toMatch(/\.three-interface button,[^{]*\{[^}]*min-height: 44px;/)
    expect(ruleBody('.three-interface .three-dialog')).toContain('overflow: auto;')
    const cardsDialog = ruleBody('.three-interface .three-dialog[data-modal="cards"]')
    expect(cardsDialog).toContain('inset: 16px 12px;')
    expect(cardsDialog).toContain('width: min(1100px, calc(100% - 24px));')
    expect(cardsDialog).toContain('env(safe-area-inset-left)')
    expect(cardsDialog).toContain('env(safe-area-inset-right)')
  })

  it('keeps hover previews decorative, input-transparent and height-bounded', () => {
    const hover = '.three-interface .three-hover-preview'
    expect(ruleBody(hover)).toContain('pointer-events: none;')
    expect(ruleBody(`${hover} *`)).toContain('pointer-events: none;')
    expect(ruleBody(hover)).toContain('position: fixed;')
    expect(ruleBody(hover)).toContain('70dvh - 6rem')
    expect(ruleBody(`${hover} > .card-tile`)).toContain('width: 100%;')
    expect(ruleBody('.three-interface .three-log-scroll')).toContain('overflow: auto;')
    expect(ruleBody('.three-interface .three-log-scroll')).toContain('max-height: min(320px, 45svh);')
  })

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
