import { cardVisualPaletteFor } from './card-visuals'
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

function descriptor(
  kind: VisualEffectKind,
  actor: number,
  land: BasicLand,
  visualStyle: CardVisualStyle,
  details: Partial<Pick<
    VisualEffectDescriptor,
    'targetActor' | 'sourceInstanceId' | 'targetInstanceId' | 'targetCardId' | 'targetCardName'
  >> = {},
): VisualEffectDescriptor {
  return { kind, actor, land, visualStyle, palette: paletteFor(land, visualStyle), ...details }
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
      })
    case 'ability_swamp_discard':
      return descriptor('swamp_discard', event.actor, 'Swamp', visualStyle, {
        targetActor: event.target,
        sourceInstanceId: event.sourceInstanceId,
        targetCardId: event.targetCardId,
      })
    case 'ability_mountain_destroy':
      return descriptor('mountain_destroy', event.actor, 'Mountain', visualStyle, {
        targetActor: event.target,
        sourceInstanceId: event.sourceInstanceId,
        targetInstanceId: event.targetInstanceId,
        targetCardName: event.cardName,
      })
    case 'ability_plains_reuse':
      return descriptor('plains_reuse', event.actor, 'Plains', visualStyle, {
        sourceInstanceId: event.sourceInstanceId,
      })
    case 'counter_resolved':
      return descriptor('counter_resolved', event.actor, 'Island', visualStyle)
    default:
      return null
  }
}
