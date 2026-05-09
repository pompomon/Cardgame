import { canAct, getLegalActions } from '../game/engine'
import type { GameAction, GameState } from '../game/types'
import { activeActor } from './active-actor'
import type { AppState, AppViewModel, CounterOption, PlayLandOption } from './types'

function winnerTextFor(game: GameState): string {
  if (game.winner === null) {
    return ''
  }
  return game.winner === 'draw' ? 'Draw game.' : `Winner: Player ${game.winner + 1}`
}

function nestedTargetLabel(
  game: GameState,
  actor: number,
  cardName: 'Forest' | 'Mountain' | 'Swamp',
  effectTargetId: string | undefined,
): string | null {
  if (!effectTargetId) {
    return null
  }
  const me = game.players[actor]
  const enemy = game.players[actor === 0 ? 1 : 0]
  if (cardName === 'Forest') {
    const target = me.graveyard.find((entry) => entry.id === effectTargetId)
    return target ? `return ${target.name}` : null
  }
  if (cardName === 'Mountain') {
    const target = enemy.battlefield.find((entry) => entry.instanceId === effectTargetId)
    return target ? `destroy ${target.card.name}` : null
  }
  const target = enemy.hand.find((entry) => entry.id === effectTargetId)
  return target ? `discard ${target.name}` : null
}

function playLandLabelFor(game: GameState, actor: number, action: Extract<GameAction, { type: 'play_land' }>): string {
  const me = game.players[actor]
  const card = me.hand.find((entry) => entry.id === action.cardId)
  if (!card) {
    return 'Play card'
  }

  let label = `Play ${card.name}`
  if (!action.effectTargetId) {
    return label
  }

  if (card.name === 'Forest' || card.name === 'Mountain' || card.name === 'Swamp') {
    const suffix = nestedTargetLabel(game, actor, card.name, action.effectTargetId)
    if (suffix) {
      label += ` (${suffix})`
    }
    return label
  }

  if (card.name === 'Plains') {
    const target = me.battlefield.find((entry) => entry.instanceId === action.effectTargetId)
    if (target) {
      label += ` (reuse ${target.card.name})`
    }
  }

  return label
}

function plainsReuseLabelFor(
  game: GameState,
  actor: number,
  action: Extract<GameAction, { type: 'resolve_plains_reuse' }>,
): string {
  const reusedName = game.pendingPlainsReuse?.reusedCardName
  if (!reusedName) {
    return 'Resolve Plains reuse'
  }
  if (reusedName === 'Forest' || reusedName === 'Mountain' || reusedName === 'Swamp') {
    const suffix = nestedTargetLabel(game, actor, reusedName, action.effectTargetId)
    return suffix ? `Reuse ${reusedName} (${suffix})` : `Reuse ${reusedName}`
  }
  return `Reuse ${reusedName}`
}

function counterLabelFor(
  game: GameState,
  actor: number,
  action: Extract<GameAction, { type: 'counter_land' }>,
): string {
  const me = game.players[actor]
  const discard = action.discardCardId
    ? me.hand.find((card) => card.id === action.discardCardId)
    : undefined
  const suffix = discard ? ` + ${discard.name}` : ' + another land'
  return `Counter with Island (discard Island${suffix})`
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
      p2pConnected,
      p2pStarted,
      adventure: state.adventure,
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

  const playLandByCard: Record<string, PlayLandOption[]> = {}
  const counterOptions: CounterOption[] = []
  const plainsReuseOptions: Array<{
    action: Extract<GameAction, { type: 'resolve_plains_reuse' }>
    label: string
  }> = []

  for (const action of legalActions) {
    if (action.type === 'play_land') {
      const options = playLandByCard[action.cardId] ?? []
      options.push({
        action,
        label: playLandLabelFor(game, actor, action),
      })
      playLandByCard[action.cardId] = options
      continue
    }

    if (action.type === 'counter_land') {
      counterOptions.push({ action, label: counterLabelFor(game, actor, action) })
      continue
    }

    if (action.type === 'resolve_plains_reuse') {
      plainsReuseOptions.push({ action, label: plainsReuseLabelFor(game, actor, action) })
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
    p2pConnected,
    p2pStarted,
    adventure: state.adventure,
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
          handCards: game.players[0].hand.map((card) => ({ id: card.id, name: card.name })),
          graveyardCards: game.players[0].graveyard.map((card) => ({ id: card.id, name: card.name })),
          battlefield: game.players[0].battlefield.map((entry) => ({ instanceId: entry.instanceId, name: entry.card.name })),
        },
        {
          id: 1,
          handCount: game.players[1].hand.length,
          deckCount: game.players[1].deck.length,
          graveyardCount: game.players[1].graveyard.length,
          handCards: game.players[1].hand.map((card) => ({ id: card.id, name: card.name })),
          graveyardCards: game.players[1].graveyard.map((card) => ({ id: card.id, name: card.name })),
          battlefield: game.players[1].battlefield.map((entry) => ({ instanceId: entry.instanceId, name: entry.card.name })),
        },
      ],
      legal: {
        playLandByCard,
        counterOptions,
        plainsReuseOptions,
        canEndTurn: legalActions.some((action) => action.type === 'end_turn'),
        canPassResponse: legalActions.some((action) => action.type === 'pass_response'),
      },
      log: game.log,
      isReplay: replayActive,
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
