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

function ruleBody(selector: string): string {
  const normalizedSelector = normalizeCssWhitespace(selector)
  const escapedSelector = normalizedSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styleCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule for ${normalizedSelector}`).not.toBeNull()
  return (match?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
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
