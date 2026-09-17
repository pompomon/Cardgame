import { describe, expect, it } from 'vitest'
import { buildCounterHandOptions } from '../app/response-options'

describe('response options', () => {
  it('keeps the first mechanical Island as the required Signal Siren', () => {
    const options = buildCounterHandOptions({
      actor: 0,
      pendingLandName: 'Mountain',
      pendingLandDisplayName: 'Rooftop Gargoyle',
      players: [{
        handCards: [
          {
            id: 'required',
            name: 'Island',
            serializedKey: 'Island',
            displayName: 'Signal Siren',
          },
          {
            id: 'discard',
            name: 'Swamp',
            serializedKey: 'Swamp',
            displayName: 'Memory Vampire',
          },
          {
            id: 'second-island',
            name: 'Island',
            serializedKey: 'Island',
            displayName: 'Signal Siren',
          },
        ],
      }, { handCards: [] }],
      legal: {
        counterOptions: [
          {
            action: { type: 'counter_land', actor: 0, discardCardId: 'discard' },
            label: 'Intercept with Signal Siren (discard Signal Siren + Memory Vampire)',
          },
          {
            action: { type: 'counter_land', actor: 0, discardCardId: 'second-island' },
            label: 'Intercept with Signal Siren (discard Signal Siren + Signal Siren)',
          },
        ],
        canPassResponse: true,
      },
    })

    expect(options.requiredIslandId).toBe('required')
    expect(options.requiredCardDisplayName).toBe('Signal Siren')
    expect(options.choices.map((choice) => ({
      cardId: choice.cardId,
      serializedKey: choice.serializedKey,
      displayName: choice.displayName,
      a11yLabel: choice.a11yLabel,
    }))).toEqual([
      {
        cardId: 'discard',
        serializedKey: 'Swamp',
        displayName: 'Memory Vampire',
        a11yLabel: 'Intercept with Signal Siren (discard Signal Siren + Memory Vampire)',
      },
      {
        cardId: 'second-island',
        serializedKey: 'Island',
        displayName: 'Signal Siren',
        a11yLabel: 'Intercept with Signal Siren (discard Signal Siren + Signal Siren)',
      },
    ])
    expect(options.instruction).toBe(
      'Intercept the summon of Rooftop Gargoyle? Discard Signal Siren and one other highlighted card, or choose Let It Through.',
    )
    expect(options.requiredCardHint).toBe(
      'Signal Siren is included automatically; choose the other card to discard.',
    )
    expect(options.canPass).toBe(true)
    expect(options.passLabel).toBe('Let It Through')
  })

  it('uses serialized identity rather than display copy to find the required card', () => {
    const options = buildCounterHandOptions({
      actor: 0,
      pendingLandName: 'Forest',
      players: [{
        handCards: [
          {
            id: 'required',
            name: 'legacy-alias',
            serializedKey: 'Island',
            displayName: 'Localized Signal Siren',
          },
          {
            id: 'discard',
            name: 'legacy-discard',
            serializedKey: 'Forest',
            displayName: 'Localized Gravebloom Dryad',
          },
        ],
      }, { handCards: [] }],
      legal: {
        counterOptions: [{
          action: { type: 'counter_land', actor: 0, discardCardId: 'discard' },
          label: 'Accessible intercept choice',
        }],
        canPassResponse: false,
      },
    })

    expect(options.requiredIslandId).toBe('required')
    expect(options.requiredCardDisplayName).toBe('Localized Signal Siren')
    expect(options.choices[0]).toMatchObject({
      cardId: 'discard',
      serializedKey: 'Forest',
      displayName: 'Localized Gravebloom Dryad',
      a11yLabel: 'Accessible intercept choice',
    })
    expect(options.instruction).toBe(
      'Intercept the summon of Gravebloom Dryad? Discard Localized Signal Siren and one other highlighted card, or choose Let It Through.',
    )
    expect(options.requiredCardHint).toBe(
      'Localized Signal Siren is included automatically; choose the other card to discard.',
    )
    expect(options.canPass).toBe(false)
    expect(options.passLabel).toBe('Let It Through')
  })
})
