import type { AdventureNodeSummary, AdventureUiState, Mode } from './types'

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

/** The current tier's open nodes: one retry/convergence node or two fork choices. */
export function upcomingAdventureNodes(adventure: AdventureUiState | undefined): readonly AdventureNodeSummary[] {
  const tier = adventure?.tiers[adventure.currentTier - 1]
  return tier ? tier.nodes.filter((node) => node.status === 'current' || node.status === 'available') : []
}

/** The nodes that can start now: the open nodes, unless a reward must be resolved first. */
export function actionableAdventureNodes(adventure: AdventureUiState | undefined): readonly AdventureNodeSummary[] {
  return adventure?.stage === 'reward' ? [] : upcomingAdventureNodes(adventure)
}

/** Player-facing next opponent, listing both labels at an uncommitted fork. */
export function describeNextAdventureOpponent(adventure: AdventureUiState | undefined): string | null {
  const nodes = upcomingAdventureNodes(adventure)
  if (nodes.length === 0) {
    return null
  }
  if (nodes.length === 1) {
    return nodes[0].opponent.label
  }
  return `Choose ${nodes.map((node) => node.opponent.label).join(' or ')}`
}
