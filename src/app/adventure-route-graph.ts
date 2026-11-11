/**
 * Adventure route graph: lane positions and line styles for drawing the
 * projected route as a branching map.
 *
 * This is a pure leaf module with type-only imports. It reads the tier
 * summaries that `view-model.ts` projects and never touches the run, the DOM
 * or storage.
 */
import type { AdventureNodeLane, AdventureNodeStatus } from './adventure-map'
import type { AdventureTierSummary } from './types'

/**
 * How a line between two tiers is drawn: the route taken, the next step, a
 * branch not taken, or the route ahead.
 */
export type AdventureRouteEdgeState = 'traveled' | 'next' | 'bypassed' | 'future'
/**
 * How the narrow trail's rail is drawn. The trail stacks every node in one
 * column, so its rail shows progress rather than branches: the route taken
 * down to the last completed node, the next step on to the last playable
 * node, and the route ahead after that.
 */
export type AdventureRouteTrailState = 'traveled' | 'next' | 'future'
/** A lane's horizontal position, as a percentage of the route column. */
export type AdventureRouteLaneX = 25 | 50 | 75

export interface AdventureRouteGraphNode {
  readonly nodeId: string
  readonly x: AdventureRouteLaneX
  /** The style of the line below the token, or null when no line leaves it. */
  readonly stem: AdventureRouteEdgeState | null
  /** The trail's rail above the token: the stretch from the token before it, or from the top of the route. */
  readonly trailIn: AdventureRouteTrailState
  /** The trail's rail below the token, or null for the last node. */
  readonly trailOut: AdventureRouteTrailState | null
}

export interface AdventureRouteEdge {
  /** null for the start dot above tier 1. */
  readonly fromNodeId: string | null
  readonly toNodeId: string
  readonly fromX: AdventureRouteLaneX
  readonly toX: AdventureRouteLaneX
  readonly state: AdventureRouteEdgeState
}

export interface AdventureRouteGraphRow {
  readonly tierIndex: number
  readonly nodes: readonly AdventureRouteGraphNode[]
  /** The lines that enter this tier from the previous one, or from the start. */
  readonly incoming: readonly AdventureRouteEdge[]
  /** The trail's rail past this tier's name, or null when no node follows it. */
  readonly trail: AdventureRouteTrailState | null
}

interface RouteLineSource {
  readonly nodeId: string | null
  readonly x: AdventureRouteLaneX
  readonly status: AdventureNodeStatus | 'start'
}

const START_X: AdventureRouteLaneX = 50

export function adventureRouteLaneX(lane: AdventureNodeLane): AdventureRouteLaneX {
  switch (lane) {
    case 'left':
      return 25
    case 'center':
      return 50
    case 'right':
      return 75
    default:
      // An unknown lane is drawn in the center.
      return 50
  }
}

/**
 * The style of a line from `from` (a node status, or the start dot) to a node
 * of the next tier. A line touching a bypassed node is `bypassed`; a line out
 * of the start or a completed node is `traveled` into a completed node and
 * `next` into a playable one; every other line is `future`.
 */
export function adventureRouteEdgeState(
  from: AdventureNodeStatus | 'start',
  to: AdventureNodeStatus,
): AdventureRouteEdgeState {
  if (from === 'bypassed' || to === 'bypassed') {
    return 'bypassed'
  }
  if (from !== 'start' && from !== 'completed') {
    return 'future'
  }
  switch (to) {
    case 'completed':
      return 'traveled'
    case 'current':
    case 'available':
      return 'next'
    default:
      // Locked and unknown statuses are the route ahead.
      return 'future'
  }
}

function stemState(outgoing: readonly AdventureRouteEdgeState[]): AdventureRouteEdgeState | null {
  if (outgoing.length === 0) {
    return null
  }
  if (outgoing.includes('traveled')) {
    return 'traveled'
  }
  if (outgoing.includes('next')) {
    return 'next'
  }
  return outgoing.every((state) => state === 'bypassed') ? 'bypassed' : 'future'
}

// Tier summaries are frozen and kept identity-stable by the view model, so a
// tier array always maps to the same graph.
const graphCache = new WeakMap<readonly AdventureTierSummary[], readonly AdventureRouteGraphRow[]>()

/**
 * The trail's rail state for each node in column order: tier by tier, and
 * each tier's nodes in order. The stretch ending at a node is `traveled` up
 * to the last completed node, `next` up to the last current or available
 * node after it, and `future` beyond.
 */
function trailStates(tiers: readonly AdventureTierSummary[]): AdventureRouteTrailState[] {
  const statuses = tiers.flatMap((tier) => tier.nodes.map((node) => node.status))
  const lastCompleted = statuses.lastIndexOf('completed')
  const lastPlayable = Math.max(statuses.lastIndexOf('current'), statuses.lastIndexOf('available'))
  return statuses.map((_, index) => (index <= lastCompleted ? 'traveled' : index <= lastPlayable ? 'next' : 'future'))
}

/**
 * One row per tier, in order. Every node joins every node of the next tier,
 * and tier 1's nodes join the start dot. Rows, nodes and lines are frozen.
 */
export function adventureRouteGraph(tiers: readonly AdventureTierSummary[]): readonly AdventureRouteGraphRow[] {
  const cached = graphCache.get(tiers)
  if (cached) {
    return cached
  }
  const trail = trailStates(tiers)
  // The column position of each tier's first node, or of the next node after an empty tier.
  let first = 0
  const rows = Object.freeze(tiers.map((tier, index): AdventureRouteGraphRow => {
    const start = first
    first += tier.nodes.length
    const sources: readonly RouteLineSource[] = index === 0
      ? [{ nodeId: null, x: START_X, status: 'start' }]
      : tiers[index - 1].nodes.map((node) => ({ nodeId: node.id, x: adventureRouteLaneX(node.lane), status: node.status }))
    const incoming = sources.flatMap((source) => tier.nodes.map((node) => Object.freeze({
      fromNodeId: source.nodeId,
      toNodeId: node.id,
      fromX: source.x,
      toX: adventureRouteLaneX(node.lane),
      state: adventureRouteEdgeState(source.status, node.status),
    })))
    const targets = tiers[index + 1]?.nodes ?? []
    return Object.freeze({
      tierIndex: tier.tierIndex,
      nodes: Object.freeze(tier.nodes.map((node, slot) => Object.freeze({
        nodeId: node.id,
        x: adventureRouteLaneX(node.lane),
        stem: stemState(targets.map((target) => adventureRouteEdgeState(node.status, target.status))),
        trailIn: trail[start + slot],
        trailOut: trail[start + slot + 1] ?? null,
      }))),
      incoming: Object.freeze(incoming),
      trail: trail[start] ?? null,
    })
  }))
  graphCache.set(tiers, rows)
  return rows
}
