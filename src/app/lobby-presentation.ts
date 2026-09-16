import type { AiLevel } from '../game/ai-levels'
import { AI_LEVEL_OPTIONS } from './ai-levels'
import type { AdventureUiState, Mode } from './types'

export const LOBBY_MODE_OPTIONS: ReadonlyArray<{ readonly mode: Mode; readonly label: string }> = [
  { mode: 'local-hvh', label: 'Local Human vs Human' },
  { mode: 'local-hvai', label: 'Local Human vs AI' },
  { mode: 'local-aivai', label: 'Local AI vs AI' },
  { mode: 'adventure-hvai', label: 'Adventure (Human vs AI)' },
  { mode: 'p2p-host', label: 'P2P Host' },
  { mode: 'p2p-join', label: 'P2P Join' },
]

export function isAdventureResumable(adventure: AdventureUiState | undefined): boolean {
  return !!adventure?.hasSavedRun && (adventure.status === 'paused' || adventure.status === 'active')
}

export function hasSavedAdventureRun(adventure: AdventureUiState | undefined): boolean {
  return !!adventure?.hasSavedRun
}

export function selectedAiLevelLabel(aiLevel: AiLevel | undefined): string {
  const selected = aiLevel ?? 'basic'
  return AI_LEVEL_OPTIONS.find((option) => option.value === selected)?.label ?? 'Basic'
}
