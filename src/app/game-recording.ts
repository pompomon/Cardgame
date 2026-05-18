import type { AiLevel, ControllerKind, Mode } from './types'
import type { BasicLand, GameAction, GamePhase, GameState, LogEvent, Winner } from '../game/types'
import { isAiLevel } from './ai-levels'
import { isGameAction } from './action-validation'
import { capTail, isRecordObject } from './validators'

export const GAME_RECORD_KIND = 'cardgame.recording'
export const GAME_RECORD_VERSION = 2

export type GameActionSource = 'human' | 'ai' | 'remote'

export interface GameRecordMetadata {
  seed: number
  mode: Mode
  controllers: [ControllerKind, ControllerKind]
  aiLevel: AiLevel
  startedAt: number
  updatedAt: number
  completed: boolean
}

export interface GameRecordStep {
  index: number
  source: GameActionSource
  action: GameAction
  state: GameState
  timestamp: number
}

export interface GameRecordFile {
  kind: typeof GAME_RECORD_KIND
  version: typeof GAME_RECORD_VERSION
  metadata: GameRecordMetadata
  initialState: GameState
  timeline: GameRecordStep[]
}

interface ParseSuccess {
  ok: true
  record: GameRecordFile
}

interface ParseFailure {
  ok: false
  error: string
}

export type ParseGameRecordResult = ParseSuccess | ParseFailure

const BASIC_LANDS: BasicLand[] = ['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']

function isBasicLandName(value: unknown): value is BasicLand {
  return typeof value === 'string' && BASIC_LANDS.includes(value as BasicLand)
}

function isActorIndex(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1
}

// Cap defends against malicious recordings inflating the structured stream
// (renderers iterate the whole array on every frame for the visual log /
// effect queue).
const MAX_PARSED_LOG_EVENTS = 10000

function isLogEventLike(value: unknown): value is LogEvent {
  if (!isRecordObject(value)) {
    return false
  }
  const kind = value.kind
  if (typeof kind !== 'string') {
    return false
  }
  switch (kind) {
    case 'game_started':
      return true
    case 'game_start_skip_draw':
      return isActorIndex(value.actor)
    case 'turn_start':
      return typeof value.turn === 'number' && isActorIndex(value.actor)
    case 'draw':
    case 'play_land':
    case 'ability_forest_return':
    case 'counter_resolved':
      return isActorIndex(value.actor) && isBasicLandName(value.cardName)
    case 'ability_swamp_discard':
    case 'ability_mountain_destroy':
      return isActorIndex(value.actor) && isActorIndex(value.target) && isBasicLandName(value.cardName)
    case 'ability_plains_reuse':
      return isActorIndex(value.actor) && isBasicLandName(value.reusedName)
    case 'counter_offered':
      return isActorIndex(value.responder) && isBasicLandName(value.cardName)
    case 'deck_empty_loss':
      return isActorIndex(value.actor)
    case 'game_end':
      return value.winner === null
        || value.winner === 'draw'
        || isActorIndex(value.winner)
    default:
      return false
  }
}

export function sanitizeLogEvents(raw: unknown): LogEvent[] {
  if (!Array.isArray(raw)) {
    return []
  }
  // Keep the tail (most recent events) when capping so legitimate long
  // recordings preserve the latest gameplay rather than discarding it.
  const limited = capTail(raw, MAX_PARSED_LOG_EVENTS)
  const out: LogEvent[] = []
  for (const entry of limited) {
    if (isLogEventLike(entry)) {
      out.push(entry)
    }
  }
  return out
}

function isCardLike(value: unknown): boolean {
  if (!isRecordObject(value)) {
    return false
  }
  return typeof value.id === 'string'
    && typeof value.type === 'string'
    && value.type === 'land'
    && typeof value.name === 'string'
    && BASIC_LANDS.includes(value.name as BasicLand)
}

function isBattlefieldEntryLike(value: unknown): boolean {
  if (!isRecordObject(value)) {
    return false
  }
  return typeof value.instanceId === 'string' && isCardLike(value.card)
}

function isPlayerLike(value: unknown): boolean {
  if (!isRecordObject(value)) {
    return false
  }

  return (value.id === 0 || value.id === 1)
    && Array.isArray(value.deck)
    && value.deck.every((entry) => isCardLike(entry))
    && Array.isArray(value.hand)
    && value.hand.every((entry) => isCardLike(entry))
    && Array.isArray(value.battlefield)
    && value.battlefield.every((entry) => isBattlefieldEntryLike(entry))
    && Array.isArray(value.graveyard)
    && value.graveyard.every((entry) => isCardLike(entry))
    && typeof value.landsPlayedThisTurn === 'number'
}

function isPhase(value: unknown): value is GamePhase {
  return value === 'main' || value === 'respond' || value === 'plains_target' || value === 'gameOver'
}

function isWinner(value: unknown): value is Winner {
  if (value === null || value === 'draw') {
    return true
  }
  return value === 0 || value === 1
}

function isGameStateLike(value: unknown): value is GameState {
  if (!isRecordObject(value)) {
    return false
  }

  if (!Array.isArray(value.players) || value.players.length !== 2 || !value.players.every((entry) => isPlayerLike(entry))) {
    return false
  }
  if (value.players[0].id !== 0 || value.players[1].id !== 1) {
    return false
  }

  if (!isPhase(value.phase) || !isWinner(value.winner)) {
    return false
  }

  if (value.pendingLandPlay !== null) {
    if (!isRecordObject(value.pendingLandPlay)) {
      return false
    }
    const pending = value.pendingLandPlay as Record<string, unknown>
    if (pending.actor !== 0 && pending.actor !== 1) {
      return false
    }
    if (!isCardLike(pending.card)) {
      return false
    }
    if (pending.effectTargetId !== undefined && typeof pending.effectTargetId !== 'string') {
      return false
    }
  }

  const pendingPlainsReuse = value.pendingPlainsReuse
  if (value.phase === 'plains_target') {
    if (pendingPlainsReuse === undefined || pendingPlainsReuse === null) {
      return false
    }
  } else if (pendingPlainsReuse !== undefined && pendingPlainsReuse !== null) {
    return false
  }

  if (pendingPlainsReuse !== undefined && pendingPlainsReuse !== null) {
    if (!isRecordObject(pendingPlainsReuse)) {
      return false
    }
    const pendingReuse = pendingPlainsReuse as Record<string, unknown>
    if ((pendingReuse.actor !== 0 && pendingReuse.actor !== 1)
      || typeof pendingReuse.reusedInstanceId !== 'string'
      || typeof pendingReuse.reusedCardName !== 'string'
      || pendingReuse.reusedCardName === 'Plains'
      || !BASIC_LANDS.includes(pendingReuse.reusedCardName as BasicLand)) {
      return false
    }
  }

  return typeof value.turn === 'number'
    && (value.currentPlayer === 0 || value.currentPlayer === 1)
    && typeof value.nextInstanceId === 'number'
    && Array.isArray(value.log)
    && value.log.every((entry) => typeof entry === 'string')
}

function isGameActionLike(payload: unknown): payload is GameAction {
  // Delegate shape-checking to the shared `isGameAction` so the
  // controller and recording importer agree on the contract — and stay in
  // sync automatically whenever `GameAction` grows a new branch. Imported
  // recordings additionally constrain the actor to the 2-player engine's
  // valid indices (the controller's broader `actor: number` check is
  // sufficient for in-process callers).
  return isGameAction(payload) && (payload.actor === 0 || payload.actor === 1)
}

function normalizeStateSchema(state: GameState): GameState {
  // Older recordings (pre-LogEvent) didn't persist a structured event stream.
  // Default it to an empty array so legacy snapshots still load and
  // type-check; renderers should treat the structured stream as best-effort
  // and fall back to `log` strings for back-filled records. Untrusted JSON
  // can also smuggle malformed entries here, so each entry is shape-checked
  // and the array is capped to keep renderers safe.
  const rawEvents = (state as { events?: unknown }).events
  return {
    ...state,
    pendingPlainsReuse: state.pendingPlainsReuse ?? null,
    events: sanitizeLogEvents(rawEvents),
  }
}

function isPlainsPlayActionForPreviousState(previous: GameState, action: GameAction): boolean {
  if (action.type !== 'play_land') {
    return false
  }
  const card = previous.players[action.actor]?.hand.find((entry) => entry.id === action.cardId)
  return card?.name === 'Plains'
}

function parseLegacyReuseTargetId(
  reuseTargetId: string | undefined,
): { normalizedReuseTargetId: string | null; nestedTargetId?: string } {
  if (!reuseTargetId) {
    return { normalizedReuseTargetId: null }
  }
  const separatorIndex = reuseTargetId.indexOf('::')
  if (separatorIndex < 0) {
    return { normalizedReuseTargetId: reuseTargetId }
  }
  const normalizedReuseTargetId = reuseTargetId.slice(0, separatorIndex)
  const nestedTargetId = reuseTargetId.slice(separatorIndex + 2)
  return {
    normalizedReuseTargetId: separatorIndex > 0 ? normalizedReuseTargetId : null,
    nestedTargetId: nestedTargetId || undefined,
  }
}

function plainsReuseFollowUpAction(
  previous: GameState,
  actor: number,
  reuseTargetId: string | undefined,
): Extract<GameAction, { type: 'resolve_plains_reuse' }> | null {
  if (!reuseTargetId) {
    return null
  }
  const { normalizedReuseTargetId, nestedTargetId } = parseLegacyReuseTargetId(reuseTargetId)
  if (!normalizedReuseTargetId) {
    return null
  }
  const reused = previous.players[actor].battlefield.find(
    (entry) => entry.instanceId === normalizedReuseTargetId && entry.card.name !== 'Plains',
  )
  if (!reused) {
    return null
  }
  const opponent = previous.players[actor === 0 ? 1 : 0]
  let hasNestedTargets = false
  if (reused.card.name === 'Forest') {
    hasNestedTargets = previous.players[actor].graveyard.length > 0
  } else if (reused.card.name === 'Mountain') {
    hasNestedTargets = opponent.battlefield.length > 0
  } else if (reused.card.name === 'Swamp') {
    hasNestedTargets = opponent.hand.length > 0
  }
  if (!hasNestedTargets) {
    return null
  }
  return nestedTargetId
    ? { type: 'resolve_plains_reuse', actor, effectTargetId: nestedTargetId }
    : { type: 'resolve_plains_reuse', actor }
}

function upgradeLegacyPlainsTimeline(
  initialState: GameState,
  timeline: GameRecordStep[],
): GameRecordStep[] {
  const upgraded: GameRecordStep[] = []
  let previous = initialState
  for (const step of timeline) {
    const normalizedStep = {
      ...step,
      index: upgraded.length + 1,
      state: normalizeStateSchema(step.state),
    }
    upgraded.push(normalizedStep)

    const pendingLegacyPlains = previous.pendingLandPlay?.card.name === 'Plains' ? previous.pendingLandPlay : null
    const legacyPlainsPlayEffectTarget = step.action.type === 'play_land' && isPlainsPlayActionForPreviousState(previous, step.action)
      ? step.action.effectTargetId
      : undefined
    const completedLegacyPlainsResolution = normalizedStep.state.pendingLandPlay === null
      && normalizedStep.state.pendingPlainsReuse === null
    const synthesizedResolveAction = step.action.type === 'pass_response' && pendingLegacyPlains !== null
      ? plainsReuseFollowUpAction(previous, pendingLegacyPlains.actor, pendingLegacyPlains.effectTargetId)
      : legacyPlainsPlayEffectTarget !== undefined
        ? plainsReuseFollowUpAction(previous, step.action.actor, legacyPlainsPlayEffectTarget)
        : null

    if (completedLegacyPlainsResolution && synthesizedResolveAction) {
      upgraded.push({
        index: upgraded.length + 1,
        source: step.source,
        action: synthesizedResolveAction,
        state: normalizeStateSchema(step.state),
        timestamp: step.timestamp,
      })
    }

    previous = normalizedStep.state
  }
  return upgraded
}

function isControllerKind(value: unknown): value is ControllerKind {
  return value === 'human' || value === 'ai' || value === 'remote'
}

function isMode(value: unknown): value is Mode {
  return value === 'local-hvh'
    || value === 'local-hvai'
    || value === 'local-aivai'
    || value === 'adventure-hvai'
    || value === 'p2p-host'
    || value === 'p2p-join'
}

function parseAiLevel(value: unknown): AiLevel | null {
  if (value === undefined) {
    return 'basic'
  }
  return isAiLevel(value) ? value : null
}

function isSource(value: unknown): value is GameActionSource {
  return value === 'human' || value === 'ai' || value === 'remote'
}

export function createGameRecord(
  seed: number,
  mode: Mode,
  controllers: [ControllerKind, ControllerKind],
  aiLevel: AiLevel,
  initialState: GameState,
  now = Date.now(),
): GameRecordFile {
  return {
    kind: GAME_RECORD_KIND,
    version: GAME_RECORD_VERSION,
    metadata: {
      seed,
      mode,
      controllers: [...controllers] as [ControllerKind, ControllerKind],
      aiLevel,
      startedAt: now,
      updatedAt: now,
      completed: initialState.phase === 'gameOver',
    },
    initialState: structuredClone(initialState),
    timeline: [],
  }
}

export function appendGameRecordStep(
  record: GameRecordFile,
  action: GameAction,
  state: GameState,
  source: GameActionSource,
  now = Date.now(),
): GameRecordFile {
  const timeline = [
    ...record.timeline,
    {
      index: record.timeline.length + 1,
      action: structuredClone(action),
      state: structuredClone(state),
      source,
      timestamp: now,
    },
  ]
  return {
    ...record,
    timeline,
    metadata: {
      ...record.metadata,
      updatedAt: now,
      completed: state.phase === 'gameOver',
    },
  }
}

export function snapshotFromRecord(record: GameRecordFile, step: number): GameState {
  if (step <= 0) {
    return structuredClone(record.initialState)
  }
  const safeStep = Math.min(step, record.timeline.length)
  if (safeStep <= 0) {
    return structuredClone(record.initialState)
  }
  return structuredClone(record.timeline[safeStep - 1].state)
}

export function serializeGameRecord(record: GameRecordFile): string {
  return JSON.stringify(record, null, 2)
}

export function parseGameRecordJson(text: string): ParseGameRecordResult {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Invalid JSON format.' }
  }

  if (!isRecordObject(payload)) {
    return { ok: false, error: 'Record payload must be an object.' }
  }

  if (payload.kind !== GAME_RECORD_KIND) {
    return { ok: false, error: 'Unsupported record kind.' }
  }
  const version = payload.version
  if (version !== 1 && version !== GAME_RECORD_VERSION) {
    return { ok: false, error: `Unsupported record version: ${String(payload.version)}.` }
  }

  if (!isRecordObject(payload.metadata)) {
    return { ok: false, error: 'Missing metadata.' }
  }
  const metadata = payload.metadata
  const controllers = metadata.controllers
  if (!Array.isArray(controllers)
    || controllers.length !== 2
    || !isControllerKind(controllers[0])
    || !isControllerKind(controllers[1])) {
    return { ok: false, error: 'Invalid controllers metadata.' }
  }
  if (!isMode(metadata.mode)) {
    return { ok: false, error: 'Invalid game mode metadata.' }
  }
  const aiLevel = parseAiLevel(metadata.aiLevel)
  if (!aiLevel) {
    return { ok: false, error: 'Invalid AI level metadata.' }
  }
  if (typeof metadata.seed !== 'number'
    || typeof metadata.startedAt !== 'number'
    || typeof metadata.updatedAt !== 'number'
    || typeof metadata.completed !== 'boolean') {
    return { ok: false, error: 'Invalid metadata fields.' }
  }

  if (!isGameStateLike(payload.initialState)) {
    return { ok: false, error: 'Invalid initial game state.' }
  }

  if (!Array.isArray(payload.timeline)) {
    return { ok: false, error: 'Timeline must be an array.' }
  }
  for (let index = 0; index < payload.timeline.length; index += 1) {
    const step = payload.timeline[index]
    if (!isRecordObject(step)) {
      return { ok: false, error: `Invalid timeline step at index ${index}.` }
    }
    if (typeof step.index !== 'number' || step.index !== index + 1) {
      return { ok: false, error: `Invalid step index at timeline position ${index}.` }
    }
    if (!isSource(step.source)) {
      return { ok: false, error: `Invalid step source at timeline position ${index}.` }
    }
    if (!isGameActionLike(step.action)) {
      return { ok: false, error: `Invalid action at timeline position ${index}.` }
    }
    if (!isGameStateLike(step.state)) {
      return { ok: false, error: `Invalid state at timeline position ${index}.` }
    }
    if (typeof step.timestamp !== 'number') {
      return { ok: false, error: `Invalid timestamp at timeline position ${index}.` }
    }
  }

  const initialState = normalizeStateSchema(payload.initialState as GameState)
  const parsedTimeline = payload.timeline.map((step) => {
    const entry = step as Record<string, unknown>
    return {
      index: entry.index as number,
      source: entry.source as GameActionSource,
      action: entry.action as GameAction,
      state: normalizeStateSchema(entry.state as GameState),
      timestamp: entry.timestamp as number,
    }
  })

  const timeline = version === 1
    ? upgradeLegacyPlainsTimeline(initialState, parsedTimeline)
    : parsedTimeline

  const sanitizedRecord: GameRecordFile = {
    kind: GAME_RECORD_KIND,
    version: GAME_RECORD_VERSION,
    metadata: {
      seed: metadata.seed,
      mode: metadata.mode,
      controllers: [controllers[0], controllers[1]],
      aiLevel,
      startedAt: metadata.startedAt,
      updatedAt: metadata.updatedAt,
      completed: metadata.completed,
    },
    initialState,
    timeline,
  }

  return {
    ok: true,
    record: structuredClone(sanitizedRecord),
  }
}
