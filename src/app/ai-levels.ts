import type { AiLevel } from './types'

export const AI_LEVEL_OPTIONS: ReadonlyArray<{ value: AiLevel; label: string }> = [
  { value: 'basic', label: 'Basic' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'hard', label: 'Hard' },
]

export function isAiLevel(value: unknown): value is AiLevel {
  return value === 'basic' || value === 'advanced' || value === 'hard'
}
