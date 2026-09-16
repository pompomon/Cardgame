import type { VisualEffectDescriptor } from '../../app/visual-effects'
import type { DragStatePhase } from './drag-state'

export type DropFeedbackState = 'disabled' | 'hidden' | 'invalid' | 'target' | 'valid'

export interface DropFeedbackInput {
  readonly dragPhase: DragStatePhase
  readonly hasLegalDrop: boolean
  readonly isPointerInsideDropZone: boolean
  readonly hasTargets: boolean
}

export interface EffectFeedback {
  readonly label: string
  readonly tint: number
}

export function dropFeedbackState(input: DropFeedbackInput): DropFeedbackState {
  if (input.dragPhase !== 'dragging') {
    return input.hasTargets ? 'target' : 'hidden'
  }
  if (!input.hasLegalDrop) {
    return 'disabled'
  }
  return input.isPointerInsideDropZone ? 'valid' : 'invalid'
}

export function effectFeedbackForDescriptor(
  descriptor: Pick<VisualEffectDescriptor, 'kind' | 'palette' | 'caption'> | null,
): EffectFeedback {
  if (!descriptor) {
    return { label: '', tint: 0xffffff }
  }
  const tint = /^#[0-9a-f]{6}$/i.test(descriptor.palette.secondary)
    ? Number.parseInt(descriptor.palette.secondary.slice(1), 16)
    : 0xffffff
  if (typeof descriptor.caption === 'string' && descriptor.caption.length > 0) {
    return { label: descriptor.caption, tint }
  }
  switch (descriptor.kind) {
    case 'play_land':
      return { label: 'Summoned', tint }
    case 'forest_return':
      return { label: 'Reclaimed', tint }
    case 'swamp_discard':
      return { label: 'Memory drained', tint }
    case 'mountain_destroy':
      return { label: 'Banished to discard pile', tint }
    case 'plains_reuse':
      return { label: 'Ability mimicked', tint }
    case 'counter_resolved':
      return { label: 'Intercepted', tint }
    default:
      return { label: 'Action resolved', tint }
  }
}
