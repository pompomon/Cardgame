import { cardVisualPaletteFor } from './card-visuals'
import { cardCatalogEntry, displayCardName } from './card-catalog'
import type { CardVisualStyle } from './types'
import type { BasicLand, LogEvent } from '../game/types'

export type VisualEffectKind =
  | 'play_land'
  | 'forest_return'
  | 'swamp_discard'
  | 'mountain_destroy'
  | 'plains_reuse'
  | 'counter_resolved'

export interface VisualEffectPalette {
  primary: string
  secondary: string
  glow: string
}

export interface VisualEffectDescriptor {
  kind: VisualEffectKind
  actor: number
  targetActor?: number
  land: BasicLand
  sourceInstanceId?: string
  targetInstanceId?: string
  targetCardId?: string
  targetCardName?: BasicLand
  counterCards?: readonly [BasicLand, BasicLand]
  sourceDisplayName?: string
  targetDisplayName?: string
  caption?: string
  visualStyle: CardVisualStyle
  palette: VisualEffectPalette
}

function paletteFor(land: BasicLand, visualStyle: CardVisualStyle): VisualEffectPalette {
  const palette = cardVisualPaletteFor(land, visualStyle)
  return {
    primary: palette.iconPrimary,
    secondary: palette.iconSecondary,
    glow: palette.cardStroke,
  }
}

export function visualEffectCaption(kind: VisualEffectKind): string {
  switch (kind) {
    case 'play_land':
      return 'Summoned'
    case 'forest_return':
      return cardCatalogEntry('Forest').primaryAbility.effectCaption
    case 'swamp_discard':
      return cardCatalogEntry('Swamp').primaryAbility.effectCaption
    case 'mountain_destroy':
      return cardCatalogEntry('Mountain').primaryAbility.effectCaption
    case 'plains_reuse':
      return cardCatalogEntry('Plains').primaryAbility.effectCaption
    case 'counter_resolved':
      return cardCatalogEntry('Island').responseAbility!.effectCaption
    default:
      return 'Action resolved'
  }
}

function descriptor(
  kind: VisualEffectKind,
  actor: number,
  land: BasicLand,
  visualStyle: CardVisualStyle,
  details: Partial<Pick<
    VisualEffectDescriptor,
    'targetActor' | 'sourceInstanceId' | 'targetInstanceId' | 'targetCardId' | 'targetCardName'
      | 'targetDisplayName' | 'counterCards'
  >> = {},
): VisualEffectDescriptor {
  return {
    kind,
    actor,
    land,
    sourceDisplayName: displayCardName(land),
    caption: visualEffectCaption(kind),
    visualStyle,
    palette: paletteFor(land, visualStyle),
    ...details,
  }
}

export function visualEffectForEvent(
  event: LogEvent,
  visualStyle: CardVisualStyle,
): VisualEffectDescriptor | null {
  switch (event.kind) {
    case 'play_land':
      return descriptor('play_land', event.actor, event.cardName, visualStyle, {
        sourceInstanceId: event.sourceInstanceId,
      })
    case 'ability_forest_return':
      return descriptor('forest_return', event.actor, 'Forest', visualStyle, {
        sourceInstanceId: event.sourceInstanceId,
        targetCardId: event.targetCardId,
        targetCardName: event.cardName,
        targetDisplayName: displayCardName(event.cardName),
      })
    case 'ability_swamp_discard':
      return descriptor('swamp_discard', event.actor, 'Swamp', visualStyle, {
        targetActor: event.target,
        sourceInstanceId: event.sourceInstanceId,
        targetCardId: event.targetCardId,
        targetCardName: event.cardName,
        targetDisplayName: displayCardName(event.cardName),
      })
    case 'ability_mountain_destroy':
      return descriptor('mountain_destroy', event.actor, 'Mountain', visualStyle, {
        targetActor: event.target,
        sourceInstanceId: event.sourceInstanceId,
        targetInstanceId: event.targetInstanceId,
        targetCardName: event.cardName,
        targetDisplayName: displayCardName(event.cardName),
      })
    case 'ability_plains_reuse':
      return descriptor('plains_reuse', event.actor, 'Plains', visualStyle, {
        sourceInstanceId: event.sourceInstanceId,
        targetCardName: event.reusedName,
        targetDisplayName: displayCardName(event.reusedName),
      })
    case 'counter_resolved':
      return descriptor('counter_resolved', event.actor, 'Island', visualStyle, {
        counterCards: event.discardCardName ? ['Island', event.discardCardName] : undefined,
        targetCardName: event.cardName,
        targetDisplayName: displayCardName(event.cardName),
      })
    default:
      return null
  }
}
