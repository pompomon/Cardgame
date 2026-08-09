import { describe, expect, it } from 'vitest'
import type { GameUiState } from '../app/types'
import type { VisualEffectDescriptor } from '../app/visual-effects'
import {
  buildInteractionFeedbackModel,
  interactionFeedbackStyle,
  phaserEffectTint,
  type InteractionFeedbackCard,
  type InteractionFeedbackState,
} from '../renderers/phaser/interaction-feedback'
import { buildLayout } from '../renderers/phaser/layout'

const layout = buildLayout(1280, 720, 'horizontal')

function game(overrides: Partial<GameUiState> = {}): GameUiState {
  return {
    turn: 1,
    phase: 'main',
    winnerText: '',
    actor: 0,
    actorControl: 'human',
    canInput: true,
    pendingLandName: null,
    pendingPlainsReuseName: null,
    players: [
      {
        id: 0,
        handCount: 2,
        deckCount: 10,
        graveyardCount: 0,
        handCards: [
          { id: 'forest', name: 'Forest' },
          { id: 'island', name: 'Island' },
        ],
        graveyardCards: [],
        battlefield: [],
      },
      {
        id: 1,
        handCount: 0,
        deckCount: 10,
        graveyardCount: 0,
        handCards: [],
        graveyardCards: [],
        battlefield: [],
      },
    ],
    legal: {
      playLandByCard: {
        forest: [{
          action: { type: 'play_land', actor: 0, cardId: 'forest' },
          label: 'Play Forest',
        }],
      },
      counterOptions: [],
      swampDiscardOptions: [],
      plainsReuseOptions: [],
      canEndTurn: true,
      canPassResponse: false,
    },
    log: [],
    events: [],
    isReplay: false,
    revealedEnemyHandForSwamp: null,
    ...overrides,
  }
}

function handCard(
  cardId: string,
  x: number,
  options: Partial<InteractionFeedbackCard> = {},
): InteractionFeedbackCard {
  return {
    cardId,
    instanceId: null,
    zone: 'hand',
    x,
    y: layout.handCardsY,
    width: layout.handCardWidth,
    height: layout.handCardHeight,
    highlight: false,
    draggable: false,
    ...options,
  }
}

describe('Phaser interaction feedback model', () => {
  it('derives playable cards and active drop areas only from projected legal actions', () => {
    const model = buildInteractionFeedbackModel({
      game: game(),
      cards: [
        handCard('forest', 300, { draggable: true }),
        handCard('island', 400, { draggable: true }),
      ],
      layout,
      presentedActor: 0,
    })

    expect([...model.playableCardIds]).toEqual(['forest'])
    expect(model.battlefield).toMatchObject({
      state: 'valid',
      label: 'Drop playable card on your battlefield',
    })
    expect(model.hand.state).toBe('valid')
    expect(model.markers).toEqual([
      expect.objectContaining({
        key: 'hand:forest',
        cardId: 'forest',
        kind: 'playable-card',
        state: 'valid',
      }),
    ])
  })

  it('shows a disabled main-phase affordance when no projected play is legal', () => {
    const current = game({
      legal: {
        playLandByCard: {},
        counterOptions: [],
        swampDiscardOptions: [],
        plainsReuseOptions: [],
        canEndTurn: true,
        canPassResponse: false,
      },
    })
    const model = buildInteractionFeedbackModel({
      game: current,
      cards: [handCard('forest', 300)],
      layout,
      presentedActor: 0,
    })

    expect(model.battlefield.state).toBe('disabled')
    expect(model.battlefield.label).toBe('No playable cards')
    expect(model.hand.state).toBe('disabled')
    expect(model.markers).toEqual([])
  })

  it('hides drop affordances when the presented board cannot accept input', () => {
    const model = buildInteractionFeedbackModel({
      game: game({ canInput: false }),
      cards: [handCard('forest', 300, { draggable: true })],
      layout,
      presentedActor: 0,
    })
    const stalePresentation = buildInteractionFeedbackModel({
      game: game(),
      cards: [handCard('forest', 300, { draggable: true })],
      layout,
      presentedActor: 1,
    })

    expect(model.battlefield.state).toBe('hidden')
    expect(model.hand.state).toBe('hidden')
    expect(stalePresentation.battlefield.state).toBe('hidden')
    expect(model.playableCardIds.size).toBe(0)
  })

  it('emits reusable target, response-action, and selected-source markers', () => {
    const cards: InteractionFeedbackCard[] = [
      handCard('forest', 300),
      handCard('island', 400, { highlight: true }),
      {
        cardId: 'enemy-card',
        instanceId: 'enemy-instance',
        zone: 'battlefield',
        x: 500,
        y: 200,
        width: layout.cardWidth,
        height: layout.cardHeight,
        highlight: true,
        draggable: false,
      },
    ]
    const model = buildInteractionFeedbackModel({
      game: game({ phase: 'respond' }),
      cards,
      layout,
      presentedActor: 0,
      selectedCardId: 'forest',
    })

    expect(model.markers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'hand:island',
        kind: 'action',
        state: 'valid',
      }),
      expect.objectContaining({
        key: 'battlefield:enemy-instance',
        kind: 'target',
        state: 'valid',
      }),
      expect.objectContaining({
        key: 'hand:forest',
        kind: 'playable-card',
        state: 'selected',
      }),
    ]))
  })
})

describe('Phaser interaction feedback presentation mapping', () => {
  it('defines every contextual state and safely hides unknown future states', () => {
    const states: InteractionFeedbackState[] = [
      'hidden',
      'disabled',
      'valid',
      'invalid',
      'hover',
      'selected',
    ]
    for (const state of states) {
      expect(interactionFeedbackStyle(state)).toEqual(expect.objectContaining({
        fillAlpha: expect.any(Number),
        strokeAlpha: expect.any(Number),
        textColor: expect.any(String),
      }))
    }
    expect(interactionFeedbackStyle('future-state' as never).strokeAlpha).toBe(0)
  })

  it('maps shared app effect palettes to Phaser tints with an unknown-kind fallback', () => {
    const descriptor: Pick<VisualEffectDescriptor, 'kind' | 'palette'> = {
      kind: 'mountain_destroy',
      palette: {
        primary: '#ff0000',
        secondary: '#aabbcc',
        glow: '#ffffff',
      },
    }
    expect(phaserEffectTint(descriptor)).toBe(0xaabbcc)
    expect(phaserEffectTint({
      ...descriptor,
      kind: 'future-effect',
    } as never)).toBe(0xffffff)
  })
})
