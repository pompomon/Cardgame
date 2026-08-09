import type { GameUiState } from '../../app/types'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import {
  COLOR_BATTLEFIELD_ACTIVE_STROKE,
  COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  COLOR_BORDER_SUBTLE,
  COLOR_CARD_HIGHLIGHT_STROKE,
  COLOR_ERROR_TEXT,
  COLOR_SUCCESS_TEXT,
  UI_THEME,
} from './theme'
import type { SceneLayout } from './layout'
import { colorHexToNumber } from './ui-utils'

export type InteractionFeedbackState =
  | 'hidden'
  | 'disabled'
  | 'valid'
  | 'invalid'
  | 'hover'
  | 'selected'

export type InteractionMarkerKind = 'playable-card' | 'target' | 'action'

export interface InteractionFeedbackStyle {
  readonly fillColor: number
  readonly fillAlpha: number
  readonly strokeColor: number
  readonly strokeAlpha: number
  readonly strokeWidth: number
  readonly textColor: string
}

export interface InteractionFeedbackBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface InteractionFeedbackArea {
  readonly bounds: InteractionFeedbackBounds
  readonly state: InteractionFeedbackState
  readonly label: string
}

export interface InteractionFeedbackCard {
  readonly cardId: string
  readonly instanceId: string | null
  readonly zone: 'hand' | 'battlefield'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly highlight: boolean
  readonly draggable: boolean
}

export interface InteractionFeedbackMarker {
  readonly key: string
  readonly cardId: string
  readonly kind: InteractionMarkerKind
  readonly bounds: InteractionFeedbackBounds
  readonly state: InteractionFeedbackState
}

export interface InteractionFeedbackModel {
  readonly battlefield: InteractionFeedbackArea
  readonly hand: InteractionFeedbackArea
  readonly markers: readonly InteractionFeedbackMarker[]
  readonly playableCardIds: ReadonlySet<string>
}

export interface BuildInteractionFeedbackOptions {
  readonly game: GameUiState
  readonly cards: readonly InteractionFeedbackCard[]
  readonly layout: SceneLayout
  readonly presentedActor: number
  readonly selectedCardId?: string | null
}

const HIDDEN_STYLE: InteractionFeedbackStyle = Object.freeze({
  fillColor: 0x000000,
  fillAlpha: 0,
  strokeColor: 0x000000,
  strokeAlpha: 0,
  strokeWidth: 0,
  textColor: UI_THEME.secondaryText,
})

const DISABLED_STYLE: InteractionFeedbackStyle = Object.freeze({
  fillColor: COLOR_BORDER_SUBTLE,
  fillAlpha: 0.04,
  strokeColor: COLOR_BORDER_SUBTLE,
  strokeAlpha: 0.36,
  strokeWidth: 1,
  textColor: UI_THEME.secondaryText,
})

const VALID_STYLE: InteractionFeedbackStyle = Object.freeze({
  fillColor: COLOR_BATTLEFIELD_ACTIVE_STROKE,
  fillAlpha: 0.08,
  strokeColor: COLOR_BATTLEFIELD_ACTIVE_STROKE,
  strokeAlpha: 0.82,
  strokeWidth: 2,
  textColor: COLOR_SUCCESS_TEXT,
})

const INVALID_STYLE: InteractionFeedbackStyle = Object.freeze({
  fillColor: COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  fillAlpha: 0.12,
  strokeColor: COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  strokeAlpha: 0.9,
  strokeWidth: 3,
  textColor: COLOR_ERROR_TEXT,
})

const HOVER_STYLE: InteractionFeedbackStyle = Object.freeze({
  fillColor: COLOR_CARD_HIGHLIGHT_STROKE,
  fillAlpha: 0.14,
  strokeColor: COLOR_CARD_HIGHLIGHT_STROKE,
  strokeAlpha: 1,
  strokeWidth: 3,
  textColor: '#fff4ad',
})

const SELECTED_STYLE: InteractionFeedbackStyle = Object.freeze({
  fillColor: COLOR_CARD_HIGHLIGHT_STROKE,
  fillAlpha: 0.1,
  strokeColor: COLOR_CARD_HIGHLIGHT_STROKE,
  strokeAlpha: 1,
  strokeWidth: 3,
  textColor: '#fff4ad',
})

export function interactionFeedbackStyle(
  state: InteractionFeedbackState,
): InteractionFeedbackStyle {
  switch (state) {
    case 'disabled':
      return DISABLED_STYLE
    case 'valid':
      return VALID_STYLE
    case 'invalid':
      return INVALID_STYLE
    case 'hover':
      return HOVER_STYLE
    case 'selected':
      return SELECTED_STYLE
    case 'hidden':
    default:
      return HIDDEN_STYLE
  }
}

export function phaserEffectTint(
  descriptor: Pick<VisualEffectDescriptor, 'kind' | 'palette'>,
): number {
  switch (descriptor.kind) {
    case 'play_land':
    case 'forest_return':
    case 'swamp_discard':
    case 'mountain_destroy':
    case 'plains_reuse':
    case 'counter_resolved':
      return colorHexToNumber(descriptor.palette.secondary)
    default:
      return 0xffffff
  }
}

function markerFor(
  card: InteractionFeedbackCard,
  kind: InteractionMarkerKind,
  state: InteractionFeedbackState,
): InteractionFeedbackMarker {
  const identity = card.zone === 'battlefield'
    ? card.instanceId ?? card.cardId
    : card.cardId
  return {
    key: `${card.zone}:${identity}`,
    cardId: card.cardId,
    kind,
    state,
    bounds: {
      x: card.x,
      y: card.y,
      width: card.width,
      height: card.height,
    },
  }
}

export function buildInteractionFeedbackModel(
  options: BuildInteractionFeedbackOptions,
): InteractionFeedbackModel {
  const { game, cards, layout, presentedActor } = options
  const canUseMainActions = presentedActor === game.actor
    && game.canInput
    && game.phase === 'main'
  const playableCardIds = new Set<string>()
  const markersByKey = new Map<string, InteractionFeedbackMarker>()

  if (canUseMainActions) {
    for (const card of cards) {
      if (
        card.zone === 'hand'
        && card.draggable
        && (game.legal.playLandByCard[card.cardId]?.length ?? 0) > 0
      ) {
        playableCardIds.add(card.cardId)
        const marker = markerFor(card, 'playable-card', 'valid')
        markersByKey.set(marker.key, marker)
      }
    }
  }

  if (presentedActor === game.actor && game.canInput) {
    for (const card of cards) {
      if (!card.highlight) {
        continue
      }
      const marker = markerFor(
        card,
        card.zone === 'battlefield' ? 'target' : 'action',
        'valid',
      )
      markersByKey.set(marker.key, marker)
    }
  }

  if (options.selectedCardId) {
    const selected = cards.find((card) => (
      card.zone === 'hand' && card.cardId === options.selectedCardId
    ))
    if (selected) {
      const marker = markerFor(selected, 'playable-card', 'selected')
      markersByKey.set(marker.key, marker)
    }
  }

  const battlefieldBounds = {
    x: layout.boardColumnLeft + layout.boardColumnWidth / 2,
    y: layout.activeBattlefieldY + layout.activeBattlefieldHeight / 2,
    width: layout.boardColumnWidth,
    height: layout.activeBattlefieldHeight,
  }
  const handBounds = {
    x: layout.handColumnLeft + layout.handColumnWidth / 2,
    y: layout.handCardsY,
    width: layout.handColumnWidth,
    height: layout.handCardHeight + 8,
  }
  const hasPlayableCards = playableCardIds.size > 0
  const areaState: InteractionFeedbackState = canUseMainActions
    ? hasPlayableCards ? 'valid' : 'disabled'
    : 'hidden'

  return {
    battlefield: {
      bounds: battlefieldBounds,
      state: areaState,
      label: hasPlayableCards
        ? 'Drop playable card on your battlefield'
        : canUseMainActions ? 'No playable cards' : '',
    },
    hand: {
      bounds: handBounds,
      state: areaState,
      label: hasPlayableCards ? 'Playable cards' : '',
    },
    markers: [...markersByKey.values()],
    playableCardIds,
  }
}
