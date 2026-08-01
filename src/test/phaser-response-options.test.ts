import { describe, expect, it } from 'vitest'
import type { CounterOption } from '../app/types'
import { buildCounterHandOptions } from '../renderers/phaser/response-options'

const counterOptions: CounterOption[] = [
  {
    action: { type: 'counter_land', actor: 0, discardCardId: 'discard-forest' },
    label: 'Counter with Island (discard Island + Forest)',
  },
  {
    action: { type: 'counter_land', actor: 0, discardCardId: 'discard-mountain' },
    label: 'Counter with Island (discard Island + Mountain)',
  },
]

describe('Phaser response options', () => {
  it('maps the required Island and each additional discard to hand cards', () => {
    const options = buildCounterHandOptions({
      actor: 0,
      pendingLandName: 'Swamp',
      players: [
        { handCards: [
          { id: 'counter-island', name: 'Island' },
          { id: 'discard-forest', name: 'Forest' },
          { id: 'discard-mountain', name: 'Mountain' },
        ] },
      ],
      legal: { counterOptions, canPassResponse: true },
    })

    expect(options.requiredIslandId).toBe('counter-island')
    expect(options.instruction).toBe('Counter Swamp: tap a highlighted card to discard with Island.')
    expect(options.choices).toEqual([
      {
        cardId: 'discard-forest',
        cardName: 'Forest',
        action: counterOptions[0].action,
        a11yLabel: counterOptions[0].label,
      },
      {
        cardId: 'discard-mountain',
        cardName: 'Mountain',
        action: counterOptions[1].action,
        a11yLabel: counterOptions[1].label,
      },
    ])
    expect(options.canPass).toBe(true)
  })

  it('ignores stale discard ids and uses safe display fallbacks', () => {
    const options = buildCounterHandOptions({
      actor: 0,
      pendingLandName: null,
      players: [{ handCards: [{ id: 'counter-island', name: 'Island' }] }],
      legal: { counterOptions: [counterOptions[0]], canPassResponse: false },
    })

    expect(options.requiredIslandId).toBe('counter-island')
    expect(options.instruction).toBe('Counter the land: tap a highlighted card to discard with Island.')
    expect(options.choices).toEqual([])
    expect(options.canPass).toBe(false)
  })

  it('uses the first Island as required and allows another Island as the discard', () => {
    const islandDiscard: CounterOption = {
      action: { type: 'counter_land', actor: 0, discardCardId: 'second-island' },
      label: 'Counter with Island (discard Island + Island)',
    }
    const options = buildCounterHandOptions({
      actor: 0,
      pendingLandName: 'Forest',
      players: [{ handCards: [
        { id: 'first-island', name: 'Island' },
        { id: 'second-island', name: 'Island' },
      ] }],
      legal: { counterOptions: [islandDiscard], canPassResponse: true },
    })

    expect(options.requiredIslandId).toBe('first-island')
    expect(options.choices).toEqual([{
      cardId: 'second-island',
      cardName: 'Island',
      action: islandDiscard.action,
      a11yLabel: islandDiscard.label,
    }])
  })
})
