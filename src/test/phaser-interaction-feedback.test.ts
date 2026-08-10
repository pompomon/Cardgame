import { describe, expect, it } from 'vitest'
import {
  dropFeedbackState,
  effectFeedbackForDescriptor,
} from '../renderers/phaser/interaction-feedback'

describe('Phaser interaction feedback', () => {
  it('maps drag, disabled, and target states without consulting game rules', () => {
    expect(dropFeedbackState({
      dragPhase: 'idle',
      hasLegalDrop: false,
      isPointerInsideDropZone: false,
      hasTargets: false,
    })).toBe('hidden')
    expect(dropFeedbackState({
      dragPhase: 'dragging',
      hasLegalDrop: true,
      isPointerInsideDropZone: true,
      hasTargets: false,
    })).toBe('valid')
    expect(dropFeedbackState({
      dragPhase: 'dragging',
      hasLegalDrop: true,
      isPointerInsideDropZone: false,
      hasTargets: false,
    })).toBe('invalid')
    expect(dropFeedbackState({
      dragPhase: 'dragging',
      hasLegalDrop: false,
      isPointerInsideDropZone: true,
      hasTargets: false,
    })).toBe('disabled')
    expect(dropFeedbackState({
      dragPhase: 'idle',
      hasLegalDrop: false,
      isPointerInsideDropZone: false,
      hasTargets: true,
    })).toBe('target')
  })

  it('maps shared effect descriptors and falls back safely for unknown kinds', () => {
    expect(effectFeedbackForDescriptor({
      kind: 'mountain_destroy',
      palette: { primary: '#000000', secondary: '#ff3300', glow: '#ffffff' },
    })).toEqual({ label: 'Mountain destroyed a land', tint: 0xff3300 })
    expect(effectFeedbackForDescriptor(null)).toEqual({ label: '', tint: 0xffffff })
    expect(effectFeedbackForDescriptor({
      kind: 'future_effect',
      palette: { primary: '#000000', secondary: 'bad', glow: '#ffffff' },
    } as never)).toEqual({ label: 'Action resolved', tint: 0xffffff })
  })
})
