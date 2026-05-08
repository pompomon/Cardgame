import { describe, expect, it } from 'vitest'
import { joinBasePath } from '../app/url-path'

describe('joinBasePath', () => {
  it('joins root base with nested relative path', () => {
    expect(joinBasePath('/', '/deep/link')).toBe('/deep/link')
  })

  it('joins non-root base with root relative path', () => {
    expect(joinBasePath('/Cardgame/', '/')).toBe('/Cardgame/')
  })

  it('normalizes missing slashes', () => {
    expect(joinBasePath('/Cardgame', 'deep/link')).toBe('/Cardgame/deep/link')
  })

  it('keeps root relative path when both are root', () => {
    expect(joinBasePath('/', '/')).toBe('/')
  })
})
