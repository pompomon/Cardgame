import { describe, expect, it } from 'vitest'
import type { CounterOption } from '../app/types'
import { buildResponsePickerOptions } from '../renderers/phaser/response-options'

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
  it('shows the target and complete additional discard on separate lines', () => {
    const options = buildResponsePickerOptions({
      actor: 0,
      pendingLandName: 'Swamp',
      players: [
        { handCards: [
          { id: 'discard-forest', name: 'Forest' },
          { id: 'discard-mountain', name: 'Mountain' },
        ] },
      ],
      legal: { counterOptions, canPassResponse: true },
    })

    expect(options.map((option) => option.label)).toEqual([
      'Counter Swamp\nDiscard Island + Forest',
      'Counter Swamp\nDiscard Island + Mountain',
      'Pass',
    ])
    expect(options[0].a11yLabel).toBe(counterOptions[0].label)
  })

  it('uses safe fallbacks when target or discard names cannot be resolved', () => {
    const [option] = buildResponsePickerOptions({
      actor: 0,
      pendingLandName: null,
      players: [{ handCards: [] }],
      legal: { counterOptions: [counterOptions[0]], canPassResponse: false },
    })

    expect(option.label).toBe('Counter a land\nDiscard Island + another card')
    expect(option.a11yLabel).toBe(counterOptions[0].label)
  })
})
