import { canAct, getLegalActions } from '../game/engine'
import type { GameAction, GameState, LogEvent } from '../game/types'
import { activeActor } from './active-actor'
import { adventureRouteNodes, type AdventureOpponentDeck, type AdventureRunState } from './adventure'
import { parseAdventureNodeId } from './adventure-map'
import { adventureRelicCharges, adventureRewardCatalogEntry, type AdventureRewardId } from './adventure-rewards'
import {
  displayAdventureOpponentLabel,
  labelGameAction,
  projectPlayersForPresentation,
  revealedEnemyHandForSwamp,
} from './game-presentation'
import { displayCardName } from './card-catalog'
import { getCurrentTutorialStep } from './tutorial'
import type {
  AdventureEncounterResult,
  AdventureOpponentSummary,
  AdventureRelicSummary,
  AdventureResultSummary,
  AdventureRewardChoiceContext,
  AdventureRewardOfferSummary,
  AdventureTierSummary,
  AdventureUiState,
  AppState,
  AppViewModel,
  CounterOption,
  PlayLandOption,
  SwampDiscardOption,
} from './types'

const EMPTY_ADVENTURE_TIERS: readonly AdventureTierSummary[] = Object.freeze([])
const EMPTY_ADVENTURE_RELICS: readonly AdventureRelicSummary[] = Object.freeze([])
const UNIQUE_RELIC_CONTEXT: AdventureRewardChoiceContext = Object.freeze({ kind: 'unique-relic' })

function projectAdventureOpponent(opponent: AdventureOpponentDeck): AdventureOpponentSummary {
  return Object.freeze({
    id: opponent.id,
    label: displayAdventureOpponentLabel(opponent.kind, opponent.lands),
    kind: opponent.kind,
    lands: Object.freeze([...opponent.lands]),
  })
}

function adventureRouteKey(run: AdventureRunState): string {
  return [
    run.status,
    run.stage ?? '-',
    run.currentTierIndex,
    run.selectedNodeId ?? '-',
    run.completedNodeIds.join(','),
  ].join('|')
}

// Route projection validates the whole map, so it is cached per run object
// and route position. Transitions replace the run object; the map is never
// changed in place.
const adventureTierCache = new WeakMap<AdventureRunState, { key: string; tiers: readonly AdventureTierSummary[] }>()

function projectAdventureTiers(run: AdventureRunState): readonly AdventureTierSummary[] {
  const key = adventureRouteKey(run)
  const cached = adventureTierCache.get(run)
  if (cached && cached.key === key) {
    return cached.tiers
  }
  const tiers = Object.freeze(adventureRouteNodes(run).map((nodes, tierIndex) => Object.freeze({
    tierIndex,
    nodes: Object.freeze(nodes.map((node, laneIndex) => Object.freeze({
      id: node.id,
      tierIndex: node.tierIndex,
      lane: node.lane,
      status: node.status,
      boss: node.boss,
      opponent: projectAdventureOpponent(run.map.tiers[tierIndex].nodes[laneIndex].opponent),
    }))),
  })))
  adventureTierCache.set(run, { key, tiers })
  return tiers
}

function projectAdventureResult(
  run: AdventureRunState,
  result: AdventureEncounterResult | null,
): AdventureResultSummary | null {
  if (!result) {
    return null
  }
  const opponent = run.map.tiers[result.tierIndex]?.nodes.find((node) => node.id === result.nodeId)?.opponent
  return Object.freeze({
    outcome: result.outcome,
    tierIndex: result.tierIndex,
    opponentLabel: opponent ? displayAdventureOpponentLabel(opponent.kind, opponent.lands) : 'Adventure opponent',
    score: result.score,
    chanceLossPrevented: result.chanceLossPrevented,
    streakResetPrevented: result.streakResetPrevented,
  })
}

// Relic copy comes from the reward catalog, never from saved data.
function projectAdventureRelics(run: AdventureRunState): readonly AdventureRelicSummary[] {
  if (run.relics.length === 0) {
    return EMPTY_ADVENTURE_RELICS
  }
  return Object.freeze(run.relics.map((relic) => {
    const entry = adventureRewardCatalogEntry(relic.id)
    return Object.freeze({
      id: relic.id,
      name: entry.name,
      rulesText: entry.rulesText,
      charges: 'charges' in relic ? relic.charges : null,
      maxCharges: entry.acquisition.kind === 'charged-relic' ? entry.acquisition.maxCharges : null,
    })
  }))
}

function projectRewardChoiceContext(run: AdventureRunState, id: AdventureRewardId): AdventureRewardChoiceContext {
  const acquisition = adventureRewardCatalogEntry(id).acquisition
  switch (acquisition.kind) {
    case 'boon':
      return Object.freeze({
        kind: 'boon',
        picks: run.rewardHistory.filter((entry) => entry.rewardId === id).length,
        maxPicks: acquisition.maxPicks,
      })
    case 'charged-relic':
      return Object.freeze({ kind: 'charged-relic', charges: adventureRelicCharges(run.relics, id), maxCharges: acquisition.maxCharges })
    case 'unique-relic':
      return UNIQUE_RELIC_CONTEXT
    default:
      // An unknown acquisition shows no holding count.
      return UNIQUE_RELIC_CONTEXT
  }
}

function projectAdventureRewardOffer(run: AdventureRunState): AdventureRewardOfferSummary | null {
  const offer = run.pendingReward
  if (offer === null) {
    return null
  }
  const source = parseAdventureNodeId(offer.sourceNodeId)
  return Object.freeze({
    offerId: offer.offerId,
    sourceTier: (source?.tierIndex ?? 0) + 1,
    choices: Object.freeze(offer.choices.map((id) => {
      const entry = adventureRewardCatalogEntry(id)
      return Object.freeze({
        id,
        name: entry.name,
        rulesText: entry.rulesText,
        context: projectRewardChoiceContext(run, id),
      })
    })),
  })
}

function projectAdventureUiState(state: AppState): AdventureUiState {
  const { run, highScore, hasSavedRun, pendingCompletion, lastResult } = state.adventure
  if (!run) {
    return Object.freeze({
      runId: null,
      baseSeed: 0,
      status: 'inactive',
      stage: null,
      currentTier: 0,
      attemptOrdinal: 0,
      remainingChances: 0,
      winStreak: 0,
      totalRoundsPlayed: 0,
      totalCardsPlayed: 0,
      tiers: EMPTY_ADVENTURE_TIERS,
      activeGameSeed: null,
      pendingCompletion: null,
      lastResult: null,
      relics: EMPTY_ADVENTURE_RELICS,
      pendingReward: null,
      highScore,
      hasSavedRun,
      decisionKey: 'none',
    })
  }
  const pendingOutcome = pendingCompletion?.outcome ?? null
  return Object.freeze({
    runId: run.runId,
    baseSeed: run.baseSeed,
    status: run.status,
    stage: run.stage,
    currentTier: run.currentTierIndex + 1,
    attemptOrdinal: run.attemptOrdinal,
    remainingChances: run.remainingChances,
    winStreak: run.winStreak,
    totalRoundsPlayed: run.totalRoundsPlayed,
    totalCardsPlayed: run.totalCardsPlayed,
    tiers: projectAdventureTiers(run),
    activeGameSeed: run.attemptSeed,
    pendingCompletion: pendingOutcome,
    lastResult: projectAdventureResult(run, lastResult),
    relics: projectAdventureRelics(run),
    pendingReward: projectAdventureRewardOffer(run),
    highScore,
    hasSavedRun,
    decisionKey: [
      run.runId,
      adventureRouteKey(run),
      run.attemptOrdinal,
      pendingOutcome ?? '-',
      run.pendingReward?.offerId ?? '-',
    ].join('|'),
  })
}

function cloneLogEvent(event: LogEvent): LogEvent {
  return { ...event }
}

function projectTutorialState(state: AppState): AppViewModel['tutorial'] {
  if (state.mode !== 'tutorial' || !state.game) {
    return { active: false, stepId: null, hint: null }
  }
  const step = getCurrentTutorialStep(state.game)
  return {
    active: true,
    stepId: step?.id ?? null,
    hint: step?.hint ?? null,
  }
}

function winnerTextFor(game: GameState): string {
  if (game.winner === null) {
    return ''
  }
  return game.winner === 'draw' ? 'Draw game.' : `Winner: Player ${game.winner + 1}`
}

export function buildViewModel(state: AppState, p2pConnected: boolean): AppViewModel {
  const replayActive = state.replay !== null
  const replayStep = state.replay?.step ?? 0
  const replayTotalSteps = state.replay?.record.timeline.length ?? 0
  const replayIsPlaying = state.replay?.isPlaying ?? false
  const p2pStarted = state.p2pStarted
  const recordingMetadata = state.recording
    ? {
      seed: state.recording.metadata.seed,
      mode: state.recording.metadata.mode,
      controllers: state.recording.metadata.controllers,
      aiLevel: state.recording.metadata.aiLevel,
      completed: state.recording.metadata.completed,
    }
    : null

  if (!state.game) {
    return {
      mode: state.mode,
      status: state.status,
      offer: state.offer,
      answer: state.answer,
      seed: state.seed,
      controllers: state.controllers,
      aiLevel: state.aiLevel,
      cardVisualStyle: state.cardVisualStyle,
      monochromeCards: state.monochromeCards,
      animationSpeed: state.animationSpeed,
      boardTheme: state.boardTheme,
      renderQualityPreference: state.renderQualityPreference,
      p2pConnected,
      p2pStarted,
      tutorial: projectTutorialState(state),
      adventure: projectAdventureUiState(state),
      game: null,
      recording: {
        canSave: state.recording !== null,
        canLoadLocal: true,
        hasLocalSave: state.hasSavedRecording,
        metadata: recordingMetadata,
      },
      replay: {
        active: replayActive,
        step: replayStep,
        totalSteps: replayTotalSteps,
        isPlaying: replayIsPlaying,
      },
    }
  }

  const game = state.game
  const actor = activeActor(game)
  const actorControl = state.controllers[actor]
  const canInput = !replayActive && actorControl === 'human' && canAct(game, actor)
  const legalActions = getLegalActions(game, actor)

  // Determine whether the local human is currently choosing a Swamp discard
  // target. Two qualifying contexts:
  //   1. swamp_target phase, resolving a direct Swamp play from hand.
  //   2. plains_target phase, the pending Plains-reuse resolves to Swamp
  //      and the reuse actor is the local human.
  // When true, the picker/labels surface the real enemy hand. The check
  // intentionally uses the raw `GameState` (not the redacted projection)
  // and is scoped to the actor's decision only.
  const revealedEnemyHandForSwampCards = revealedEnemyHandForSwamp(
    game,
    actor,
    state.controllers,
    replayActive,
  )
  const revealEnemyHandForSwamp = revealedEnemyHandForSwampCards !== null
  const players = projectPlayersForPresentation(game, state.controllers)
  const pendingLandKey = game.pendingLandPlay?.card.name ?? null
  const pendingPlainsReuseKey = game.pendingPlainsReuse?.reusedCardName ?? null

  const playLandByCard: Record<string, PlayLandOption[]> = {}
  const counterOptions: CounterOption[] = []
  const swampDiscardOptions: SwampDiscardOption[] = []
  const plainsReuseOptions: Array<{
    action: Extract<GameAction, { type: 'resolve_plains_reuse' }>
    label: string
  }> = []

  for (const action of legalActions) {
    if (action.type === 'play_land') {
      const options = playLandByCard[action.cardId] ?? []
      options.push({
        action,
        label: labelGameAction(game, action, state.controllers, revealEnemyHandForSwamp),
      })
      playLandByCard[action.cardId] = options
      continue
    }

    if (action.type === 'counter_land') {
      counterOptions.push({
        action,
        label: labelGameAction(game, action, state.controllers, revealEnemyHandForSwamp),
      })
      continue
    }

    if (action.type === 'resolve_swamp_discard') {
      swampDiscardOptions.push({
        action,
        label: labelGameAction(game, action, state.controllers, revealEnemyHandForSwamp),
      })
      continue
    }

    if (action.type === 'resolve_plains_reuse') {
      plainsReuseOptions.push({
        action,
        label: labelGameAction(game, action, state.controllers, revealEnemyHandForSwamp),
      })
    }
  }

  return {
    mode: state.mode,
    status: state.status,
    offer: state.offer,
    answer: state.answer,
    seed: state.seed,
    controllers: state.controllers,
    aiLevel: state.aiLevel,
    cardVisualStyle: state.cardVisualStyle,
    monochromeCards: state.monochromeCards,
    animationSpeed: state.animationSpeed,
    boardTheme: state.boardTheme,
    renderQualityPreference: state.renderQualityPreference,
    p2pConnected,
    p2pStarted,
    tutorial: projectTutorialState(state),
    adventure: projectAdventureUiState(state),
    game: {
      turn: game.turn,
      phase: game.phase,
      winnerText: winnerTextFor(game),
      actor,
      actorControl,
      canInput,
      pendingLandName: pendingLandKey,
      pendingLandDisplayName: pendingLandKey ? displayCardName(pendingLandKey) : null,
      pendingLandPlay: game.pendingLandPlay ? Object.freeze({
        cardId: game.pendingLandPlay.card.id,
        name: game.pendingLandPlay.card.name,
        serializedKey: game.pendingLandPlay.card.name,
        displayName: displayCardName(game.pendingLandPlay.card.name),
        actor: game.pendingLandPlay.actor,
      }) : null,
      pendingPlainsReuseName: pendingPlainsReuseKey,
      pendingPlainsReuseDisplayName: pendingPlainsReuseKey
        ? displayCardName(pendingPlainsReuseKey)
        : null,
      players,
      legal: {
        playLandByCard,
        counterOptions,
        swampDiscardOptions,
        plainsReuseOptions,
        canEndTurn: legalActions.some((action) => action.type === 'end_turn'),
        canPassResponse: legalActions.some((action) => action.type === 'pass_response'),
      },
      log: [...game.log],
      // Older persisted snapshots (e.g. Adventure mid-round saves written before
      // LogEvent existed) may not carry an `events` array. Defend against that
      // here so renderers iterating `events` can't crash on legacy data even if
      // the snapshot loader missed back-filling.
      events: (game.events ?? []).map(cloneLogEvent),
      isReplay: replayActive,
      revealedEnemyHandForSwamp: revealedEnemyHandForSwampCards,
    },
    recording: {
      canSave: state.recording !== null,
      canLoadLocal: true,
      hasLocalSave: state.hasSavedRecording,
      metadata: recordingMetadata,
    },
    replay: {
      active: replayActive,
      step: replayStep,
      totalSteps: replayTotalSteps,
      isPlaying: replayIsPlaying,
    },
  }
}
