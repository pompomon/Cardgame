import { actionClassKey, canonicalActionClasses } from '../../game/ai-action-classes'
import { getLegalActions } from '../../game/engine'
import type { BasicLand, Card, GameAction, GameState, PlayerState } from '../../game/types'
import { pendingLandWins, type DecisionRecord, type TournamentPolicy } from './ai-tournament'
import { reverseZoneOrder } from './seeded-games'

// Behaviour diagnostics over recorded decisions. Target quality compares the
// chosen target with the greedy best one by board progress, so it measures
// how often a policy deviates from greed, not whether a deviation is right.

export interface RateCounter {
  total: number
  hits: number
}

export interface BehaviourDiagnostics {
  readonly decisions: number
  /** Counters chosen when the pending land wins on resolution. */
  readonly counterWinning: RateCounter
  /** Counters chosen when the pending land does not win on resolution. */
  readonly counterOther: RateCounter
  /** Turns ended in the main phase while a land could still be played. */
  readonly hold: RateCounter
  /** Mountain effects (direct or reused) on a target that cuts enemy progress most. */
  readonly mountainBest: RateCounter
  /** Swamp discards of a card that would raise enemy progress, when one exists. */
  readonly swampProgressCard: RateCounter
  /** Forest returns of a card that would raise own progress, when one exists. */
  readonly forestProgressCard: RateCounter
  /** Plains plays by reused land name. */
  readonly plainsReuse: Partial<Record<BasicLand, number>>
}

export interface SeedDiagnostics {
  /** Decisions with two or more action classes that were re-run. */
  readonly states: number
  /** Of those, decisions that gave two or more classes across the seeds. */
  readonly varied: number
  /** Decisions whose class changed when zone order was reversed. */
  readonly orderChanged: number
}

/** max(distinct names, copies of the most common name) on a battlefield. */
export function boardProgress(names: readonly BasicLand[]): number {
  const counts = new Map<BasicLand, number>()
  let best = 0
  for (const name of names) {
    const count = (counts.get(name) ?? 0) + 1
    counts.set(name, count)
    best = Math.max(best, count)
  }
  return Math.max(counts.size, best)
}

function battlefieldNames(player: PlayerState): BasicLand[] {
  return player.battlefield.map((entry) => entry.card.name)
}

function raisesProgress(player: PlayerState, card: Card): boolean {
  const names = battlefieldNames(player)
  return boardProgress([...names, card.name]) > boardProgress(names)
}

function counter(): RateCounter {
  return { total: 0, hits: 0 }
}

function recordMountain(diagnostics: BehaviourDiagnostics, enemy: PlayerState, targetId: string | undefined): void {
  if (targetId === undefined || enemy.battlefield.length === 0) {
    return
  }
  const names = battlefieldNames(enemy)
  const progressWithout = (instanceId: string) =>
    boardProgress(enemy.battlefield.filter((entry) => entry.instanceId !== instanceId).map((entry) => entry.card.name))
  const best = Math.min(...enemy.battlefield.map((entry) => progressWithout(entry.instanceId)))
  if (best >= boardProgress(names)) {
    return
  }
  diagnostics.mountainBest.total += 1
  if (progressWithout(targetId) === best) {
    diagnostics.mountainBest.hits += 1
  }
}

function recordDecision(diagnostics: BehaviourDiagnostics, state: GameState, action: GameAction): void {
  const actor = action.actor
  const own = state.players[actor]
  const enemy = state.players[1 - actor]
  const legal = getLegalActions(state, actor)
  if (state.phase === 'respond' && legal.some((candidate) => candidate.type === 'counter_land')) {
    const bucket = pendingLandWins(state) ? diagnostics.counterWinning : diagnostics.counterOther
    bucket.total += 1
    bucket.hits += action.type === 'counter_land' ? 1 : 0
    return
  }
  if (state.phase === 'main' && legal.some((candidate) => candidate.type === 'play_land')) {
    diagnostics.hold.total += 1
    diagnostics.hold.hits += action.type === 'end_turn' ? 1 : 0
  }
  if (action.type === 'play_land') {
    const card = own.hand.find((entry) => entry.id === action.cardId)
    if (card?.name === 'Mountain') {
      recordMountain(diagnostics, enemy, action.effectTargetId)
    } else if (card?.name === 'Forest' && action.effectTargetId !== undefined) {
      const useful = own.graveyard.filter((entry) => raisesProgress(own, entry))
      if (useful.length > 0) {
        diagnostics.forestProgressCard.total += 1
        diagnostics.forestProgressCard.hits += useful.some((entry) => entry.id === action.effectTargetId) ? 1 : 0
      }
    } else if (card?.name === 'Plains' && action.effectTargetId !== undefined) {
      const reused = own.battlefield.find((entry) => entry.instanceId === action.effectTargetId)
      if (reused) {
        diagnostics.plainsReuse[reused.card.name] = (diagnostics.plainsReuse[reused.card.name] ?? 0) + 1
      }
    }
  }
  if (action.type === 'resolve_plains_reuse' && state.pendingPlainsReuse?.reusedCardName === 'Mountain') {
    recordMountain(diagnostics, enemy, action.effectTargetId)
  }
  if (action.type === 'resolve_swamp_discard') {
    const useful = enemy.hand.filter((entry) => raisesProgress(enemy, entry))
    if (useful.length > 0 && useful.length < enemy.hand.length) {
      diagnostics.swampProgressCard.total += 1
      diagnostics.swampProgressCard.hits += useful.some((entry) => entry.id === action.effectTargetId) ? 1 : 0
    }
  }
}

export function behaviourDiagnostics(records: readonly DecisionRecord[]): BehaviourDiagnostics {
  const diagnostics: BehaviourDiagnostics = {
    decisions: records.length,
    counterWinning: counter(),
    counterOther: counter(),
    hold: counter(),
    mountainBest: counter(),
    swampProgressCard: counter(),
    forestProgressCard: counter(),
    plainsReuse: {},
  }
  for (const record of records) {
    recordDecision(diagnostics, record.state, record.action)
  }
  return diagnostics
}

export interface SeedDiagnosticsOptions {
  /** Game seeds per decision; the first is the recorded one. */
  readonly seedsPerState?: number
  /** Re-runs every `stride`-th decision only, to bound the cost. */
  readonly stride?: number
  /** Keeps only decisions this predicate accepts, such as calm states. */
  readonly include?: (state: GameState, actor: number) => boolean
}

/**
 * Re-runs a policy on recorded decisions with other game seeds and with zone
 * order reversed. Decisions with a single action class are skipped.
 */
export function seedDiagnostics(
  policy: TournamentPolicy,
  records: readonly DecisionRecord[],
  options: SeedDiagnosticsOptions = {},
): SeedDiagnostics {
  const seedsPerState = options.seedsPerState ?? 8
  const stride = Math.max(1, options.stride ?? 1)
  let states = 0
  let varied = 0
  let orderChanged = 0
  for (let index = 0; index < records.length; index += stride) {
    const { state, action, gameSeed } = records[index]
    const actor = action.actor
    if (options.include && !options.include(state, actor)) {
      continue
    }
    if (canonicalActionClasses(state, getLegalActions(state, actor)).length < 2) {
      continue
    }
    states += 1
    const recordedClass = actionClassKey(state, action)
    const classes = new Set([recordedClass])
    for (let offset = 1; offset < seedsPerState; offset += 1) {
      const choice = policy(state, actor, gameSeed + offset * 7919)
      classes.add(choice ? actionClassKey(state, choice) : 'none')
    }
    varied += classes.size >= 2 ? 1 : 0
    const reversed = reverseZoneOrder(state)
    const reversedChoice = policy(reversed, actor, gameSeed)
    if ((reversedChoice ? actionClassKey(reversed, reversedChoice) : 'none') !== recordedClass) {
      orderChanged += 1
    }
  }
  return { states, varied, orderChanged }
}

function rate(value: RateCounter): string {
  return value.total === 0 ? 'n/a' : `${((value.hits / value.total) * 100).toFixed(1)}% (${value.hits}/${value.total})`
}

export function formatBehaviourDiagnostics(label: string, diagnostics: BehaviourDiagnostics): string {
  const plains = Object.entries(diagnostics.plainsReuse)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ') || 'none'
  return `| ${label} | ${diagnostics.decisions} | ${rate(diagnostics.counterWinning)} | ${rate(diagnostics.counterOther)} | ${rate(diagnostics.hold)} | ${rate(diagnostics.mountainBest)} | ${rate(diagnostics.swampProgressCard)} | ${rate(diagnostics.forestProgressCard)} | ${plains} |`
}

export const BEHAVIOUR_TABLE_HEADER = [
  '| Policy | Decisions | Counter: winning land | Counter: other land | Hold | Mountain best target | Swamp progress card | Forest progress card | Plains reuse |',
  '|---|---|---|---|---|---|---|---|---|',
].join('\n')

export function formatSeedDiagnostics(label: string, diagnostics: SeedDiagnostics): string {
  const share = (value: number) => (diagnostics.states === 0 ? 'n/a' : `${((value / diagnostics.states) * 100).toFixed(1)}%`)
  return `| ${label} | ${diagnostics.states} | ${share(diagnostics.varied)} (${diagnostics.varied}) | ${share(diagnostics.orderChanged)} (${diagnostics.orderChanged}) |`
}

export const SEED_TABLE_HEADER = [
  '| Policy | Re-run decisions | Varied across seeds | Changed by zone order |',
  '|---|---|---|---|',
].join('\n')
