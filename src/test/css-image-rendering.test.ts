import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')
const styleCss = readFileSync(join(REPO_ROOT, 'src/style.css'), 'utf8')

function ruleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styleCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull()
  return (match?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
}

function imageRenderingValues(selector: string): string[] {
  return Array.from(ruleBody(selector).matchAll(/image-rendering:\s*([^;]+);/g), (match) => match[1].trim())
}

describe('CSS image-rendering declarations', () => {
  it('keeps pixelated after crisp-edges for procedural icon fallbacks', () => {
    expect(imageRenderingValues('.action-icon')).toEqual(['crisp-edges', 'pixelated'])
    expect(imageRenderingValues('.card-tile-icon')).toEqual(['crisp-edges', 'pixelated'])
  })

  it('keeps raster card-style images on smooth scaling overrides', () => {
    expect(imageRenderingValues('.action-icon.action-icon--raster,\n.card-tile-icon.card-tile-icon--raster')).toEqual(['auto'])
    expect(imageRenderingValues('.card-tile--raster .card-tile-bg')).toEqual(['auto'])
  })

  it('places raster icon overrides after the base icon rules', () => {
    const actionIconIndex = styleCss.indexOf('.action-icon {')
    const cardTileIconIndex = styleCss.indexOf('.card-tile-icon {')
    const rasterOverrideIndex = styleCss.indexOf('.action-icon.action-icon--raster,\n.card-tile-icon.card-tile-icon--raster')

    expect(actionIconIndex).toBeGreaterThanOrEqual(0)
    expect(cardTileIconIndex).toBeGreaterThan(actionIconIndex)
    expect(rasterOverrideIndex).toBeGreaterThan(cardTileIconIndex)
  })
})
