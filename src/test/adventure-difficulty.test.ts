import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADVENTURE_DECK_BANDS } from '../app/adventure-difficulty'
import { ADVENTURE_DECK_BAND_ORDER, buildAdventureOpponentPools } from '../app/adventure-map'
import { AI_LEVELS } from '../game/ai-levels'

describe('Adventure deck bands', () => {
  it('bands every non-boss pool deck, and nothing else, at every AI level', () => {
    const poolIds = buildAdventureOpponentPools(0).nonBoss.map((opponent) => opponent.id).sort()

    expect(Object.keys(ADVENTURE_DECK_BANDS).sort()).toEqual([...AI_LEVELS].sort())
    for (const level of AI_LEVELS) {
      const bands = ADVENTURE_DECK_BANDS[level]
      expect(Object.keys(bands).sort(), level).toEqual(poolIds)
      for (const [deckId, band] of Object.entries(bands)) {
        expect(ADVENTURE_DECK_BAND_ORDER, `${level} ${deckId}`).toContain(band)
      }
    }
  })
})

describe('adventure difficulty module boundary', () => {
  const source = readFileSync(resolve(__dirname, '..', 'app', 'adventure-difficulty.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('imports only the AI levels and the Adventure map types', () => {
    const specifiers = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])

    expect(new Set(specifiers)).toEqual(new Set(['../game/ai-levels', './adventure-map']))
  })

  it('reads no randomness, clock, storage or DOM', () => {
    for (const forbidden of [
      /\bMath\.random\b/,
      /\bDate\b/,
      /\bperformance\b/,
      /\bcrypto\b/,
      /\blocalStorage\b/,
      /\bdocument\b/,
      /\bwindow\b/,
    ]) {
      expect(code).not.toMatch(forbidden)
    }
  })
})
