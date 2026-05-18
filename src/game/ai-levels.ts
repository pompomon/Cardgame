// Canonical AI-level registry for the engine layer.
//
// `AI_LEVELS` is the single source of truth: the `AiLevel` union type is
// derived from it, and `isAiLevel` validates against the same tuple.
// Adding a new level here automatically updates the type, the guard, and
// (transitively) the lobby option list exposed by `src/app/ai-levels.ts`.
//
// This module lives in `src/game/` so the engine and AI policies can refer
// to `AiLevel` without importing from `src/app/` (see
// `docs/agent/adr/0001-layering.md`).

export const AI_LEVELS = ['basic', 'advanced', 'hard'] as const

export type AiLevel = typeof AI_LEVELS[number]

export const DEFAULT_AI_LEVEL: AiLevel = 'basic'

export function isAiLevel(value: unknown): value is AiLevel {
  return typeof value === 'string' && (AI_LEVELS as readonly string[]).includes(value)
}
