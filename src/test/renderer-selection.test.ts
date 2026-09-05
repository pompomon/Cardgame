import { describe, expect, it } from 'vitest'
import { isRendererKind, pickRendererKind, rendererSearch } from '../app/renderer-selection'

describe('renderer-selection', () => {
  it('selects renderer from query string when provided', () => {
    expect(pickRendererKind('?renderer=phaser', null)).toBe('phaser')
    expect(pickRendererKind('?renderer=dom', 'phaser')).toBe('dom')
    expect(pickRendererKind('?renderer=three', 'dom')).toBe('three')
    expect(pickRendererKind('?renderer=phaser', 'three')).toBe('phaser')
  })

  it('falls back to stored renderer when query string is missing', () => {
    expect(pickRendererKind('', 'phaser')).toBe('phaser')
    expect(pickRendererKind('?renderer=unknown', 'three')).toBe('three')
  })

  it('defaults to dom when query and storage are invalid', () => {
    expect(pickRendererKind('?renderer=unknown', 'invalid')).toBe('dom')
  })

  it('validates unknown choices without enum casts', () => {
    expect(isRendererKind('three')).toBe(true)
    expect(isRendererKind('webgl')).toBe(false)
    expect(isRendererKind(null)).toBe(false)
  })

  it('preserves unrelated query parameters when switching', () => {
    expect(rendererSearch('three', '?renderer=dom&seed=42')).toBe('?renderer=three&seed=42')
  })
})
