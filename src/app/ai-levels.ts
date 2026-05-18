// Lobby/UI-facing AI level metadata.
//
// The canonical `AiLevel` union, default value, and guard live in
// `src/game/ai-levels.ts`. This module re-exports them so existing app/
// renderer imports keep working, and adds the renderer-facing
// `{value,label}` options array derived from the same canonical tuple —
// adding an entry to `AI_LEVELS` automatically requires only a label here.

import { AI_LEVELS, DEFAULT_AI_LEVEL, isAiLevel, type AiLevel } from '../game/ai-levels'

export { AI_LEVELS, DEFAULT_AI_LEVEL, isAiLevel }
export type { AiLevel }

const AI_LEVEL_LABELS: Record<AiLevel, string> = {
  basic: 'Basic',
  advanced: 'Advanced',
  hard: 'Hard',
}

export const AI_LEVEL_OPTIONS: ReadonlyArray<{ value: AiLevel; label: string }> =
  AI_LEVELS.map((value) => ({ value, label: AI_LEVEL_LABELS[value] }))
