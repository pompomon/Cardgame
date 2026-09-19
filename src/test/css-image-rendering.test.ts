import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')

function normalizeCssWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

const styleCss = normalizeCssWhitespace(
  readFileSync(join(REPO_ROOT, 'src/renderers/three/interface.css'), 'utf8'),
)
const graphicsCss = normalizeCssWhitespace(
  readFileSync(join(REPO_ROOT, 'src/renderers/three/graphics.css'), 'utf8'),
)

function ruleBodyFor(css: string, selector: string): string {
  const normalizedSelector = normalizeCssWhitespace(selector)
  const escapedSelector = normalizedSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule for ${normalizedSelector}`).not.toBeNull()
  return (match?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
}

function ruleBody(selector: string): string {
  return ruleBodyFor(styleCss, selector)
}

function imageRenderingValues(selector: string): string[] {
  return Array.from(ruleBody(selector).matchAll(/image-rendering:\s*([^;]+);/g), (match) => match[1].trim())
}

describe('CSS image-rendering declarations', () => {
  it('keeps pixelated after crisp-edges for procedural icon fallbacks', () => {
    expect(imageRenderingValues('.three-interface .card-tile-icon')).toEqual(['crisp-edges', 'pixelated'])
  })

  it('keeps raster card-style images on smooth scaling overrides', () => {
    expect(imageRenderingValues('.three-interface .card-tile-icon--raster')).toEqual(['auto'])
    expect(imageRenderingValues('.three-interface .card-tile--raster .three-card__art-frame img')).toEqual(['auto'])
  })

  it('places raster icon overrides after the base icon rules', () => {
    const cardTileIconIndex = styleCss.indexOf('.three-interface .card-tile-icon {')
    const rasterOverrideIndex = styleCss.indexOf('.three-interface .card-tile-icon--raster {')

    expect(cardTileIconIndex).toBeGreaterThanOrEqual(0)
    expect(rasterOverrideIndex).toBeGreaterThan(cardTileIconIndex)
  })
})

describe('responsive Three.js copy', () => {
  it('keeps native controls touch-sized and allows long names and labels to wrap', () => {
    expect(ruleBody('.three-interface button, .three-interface select, .three-interface summary, .three-interface a'))
      .toMatch(/min-height:\s*44px/)
    expect(ruleBody('.three-interface button, .three-interface select, .three-interface textarea'))
      .toMatch(/overflow-wrap:\s*anywhere/)
    expect(ruleBody('.three-interface button, .three-interface select, .three-interface textarea'))
      .toMatch(/white-space:\s*normal/)
    expect(ruleBody('.three-interface .three-card__name')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(ruleBody('.three-interface .three-card__name')).toMatch(/white-space:\s*normal/)
  })

  it('keeps wrapped battlefield feedback in fixed overlays rather than card-row chrome', () => {
    const instruction = ruleBodyFor(graphicsCss, '.three-board-instruction')
    expect(instruction).toMatch(/position:\s*absolute/)
    expect(instruction).toMatch(/display:\s*grid/)
    expect(instruction).toMatch(/overflow-wrap:\s*anywhere/)
    expect(ruleBodyFor(graphicsCss, '.three-board-instruction-size')).toMatch(/visibility:\s*hidden/)
    expect(ruleBodyFor(graphicsCss, '.three-board-primary')).toMatch(/min-height:\s*44px/)
    expect(ruleBodyFor(graphicsCss, '.three-board-primary')).toMatch(/white-space:\s*normal/)
    expect(ruleBodyFor(graphicsCss, '.three-board-effect-caption')).toMatch(/overflow-wrap:\s*anywhere/)
  })
})
