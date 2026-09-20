import { visualEffectCaption, type VisualEffectDescriptor } from '../../app/visual-effects'
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
  return { label: visualEffectCaption(descriptor.kind), tint }
}
