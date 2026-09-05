import { canAct, getLegalActions } from '../game/engine'
import type { GameAction, GameState, LogEvent } from '../game/types'
import { activeActor } from './active-actor'
import {
  labelGameAction,
  projectHandCards,
  revealedEnemyHandForSwamp,
} from './game-presentation'
import { getCurrentTutorialStep } from './tutorial'
import type {
  AdventureUiState,
  AppState,
  AppViewModel,
  CounterOption,
  PlayLandOption,
  SwampDiscardOption,
} from './types'

function projectAdventureUiState(state: AppState): AdventureUiState {
  const adventure = state.adventure
  return Object.freeze({
    baseSeed: adventure.baseSeed,
    currentRound: adventure.currentRound,
    remainingChances: adventure.remainingChances,
    winStreak: adventure.winStreak,
    totalRoundsPlayed: adventure.totalRoundsPlayed,
    totalCardsPlayed: adventure.totalCardsPlayed,
    opponentLineup: Object.freeze(adventure.opponentLineup.map((entry) => Object.freeze({
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      lands: Object.freeze([...entry.lands]),
    }))),
    currentOpponentIndex: adventure.currentOpponentIndex,
    activeGameSeed: adventure.activeGameSeed,
    status: adventure.status,
    highScore: adventure.highScore,
    hasSavedRun: adventure.hasSavedRun,
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
      renderer: state.renderer,
      status: state.status,
      offer: state.offer,
      answer: state.answer,
      seed: state.seed,
      controllers: state.controllers,
      aiLevel: state.aiLevel,
      cardVisualStyle: state.cardVisualStyle,
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
    renderer: state.renderer,
    status: state.status,
    offer: state.offer,
    answer: state.answer,
    seed: state.seed,
    controllers: state.controllers,
    aiLevel: state.aiLevel,
    cardVisualStyle: state.cardVisualStyle,
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
      pendingLandName: game.pendingLandPlay?.card.name ?? null,
      pendingPlainsReuseName: game.pendingPlainsReuse?.reusedCardName ?? null,
      players: [
        {
          id: 0,
          handCount: game.players[0].hand.length,
          deckCount: game.players[0].deck.length,
          graveyardCount: game.players[0].graveyard.length,
          handCards: projectHandCards(game.players[0].hand, state.controllers, 0),
          graveyardCards: game.players[0].graveyard.map((card) => ({ id: card.id, name: card.name })),
          battlefield: game.players[0].battlefield.map((entry) => ({
            instanceId: entry.instanceId,
            cardId: entry.card.id,
            name: entry.card.name,
          })),
        },
        {
          id: 1,
          handCount: game.players[1].hand.length,
          deckCount: game.players[1].deck.length,
          graveyardCount: game.players[1].graveyard.length,
          handCards: projectHandCards(game.players[1].hand, state.controllers, 1),
          graveyardCards: game.players[1].graveyard.map((card) => ({ id: card.id, name: card.name })),
          battlefield: game.players[1].battlefield.map((entry) => ({
            instanceId: entry.instanceId,
            cardId: entry.card.id,
            name: entry.card.name,
          })),
        },
      ],
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
