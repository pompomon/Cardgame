import { describe, expect, it } from 'vitest'
import { pickRendererKind } from '../app/renderer-selection'

describe('renderer-selection', () => {
  it('selects renderer from query string when provided', () => {
    expect(pickRendererKind('?renderer=phaser', null)).toBe('phaser')
    expect(pickRendererKind('?renderer=dom', 'phaser')).toBe('dom')
  })

  it('falls back to stored renderer when query string is missing', () => {
    expect(pickRendererKind('', 'phaser')).toBe('phaser')
  })

  it('defaults to dom when query and storage are invalid', () => {
    expect(pickRendererKind('?renderer=unknown', 'invalid')).toBe('dom')
  })
})
