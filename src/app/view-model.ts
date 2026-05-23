import { canAct, getLegalActions } from '../game/engine'
import type { GameAction, GameState } from '../game/types'
import { activeActor } from './active-actor'
import type { AdventureUiState, AppState, AppViewModel, ControllerKind, CounterOption, PlayLandOption, UiCard } from './types'
import { HIDDEN_HAND_CARD_NAME } from './types'

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
  controllers: readonly [ControllerKind, ControllerKind],
  revealEnemyHandForSwamp: boolean,
): string | null {
  if (!effectTargetId) {
    return null
  }
  const me = game.players[actor]
  const enemyIndex = actor === 0 ? 1 : 0
  const enemy = game.players[enemyIndex]
  if (cardName === 'Forest') {
    const target = me.graveyard.find((entry) => entry.id === effectTargetId)
    return target ? `return ${target.name}` : null
  }
  if (cardName === 'Mountain') {
    const target = enemy.battlefield.find((entry) => entry.instanceId === effectTargetId)
    return target ? `destroy ${target.card.name}` : null
  }
  const target = enemy.hand.find((entry) => entry.id === effectTargetId)
  if (!target) {
    return null
  }
  // The opposing hand is normally hidden from the local human viewer in
  // hvai modes (`shouldHideHandFromViewer`). However, when the human is
  // actively choosing a Swamp discard target, they need to see the
  // candidate cards: the discard is *their* decision, so picking blind
  // would be unfair. `revealEnemyHandForSwamp` is scoped narrowly to that
  // decision by `buildViewModel` and does not affect the redaction of
  // `players[enemyIndex].handCards` anywhere else (battlefield panels,
  // replay log, etc.). The AI continues to play Swamp without enemy-hand
  // visibility (see `src/game/ai-visibility.ts`); the resulting asymmetry
  // is intentional.
  const hideName = shouldHideHandFromViewer(controllers, enemyIndex) && !revealEnemyHandForSwamp
  const targetName = hideName ? 'hidden card' : target.name
  return `discard ${targetName}`
}

function playLandLabelFor(game: GameState, actor: number, action: Extract<GameAction, { type: 'play_land' }>, controllers: readonly [ControllerKind, ControllerKind], revealEnemyHandForSwamp: boolean): string {
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
    const suffix = nestedTargetLabel(game, actor, card.name, action.effectTargetId, controllers, revealEnemyHandForSwamp)
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
  controllers: readonly [ControllerKind, ControllerKind],
  revealEnemyHandForSwamp: boolean,
): string {
  const reusedName = game.pendingPlainsReuse?.reusedCardName
  if (!reusedName) {
    return 'Resolve Plains reuse'
  }
  if (reusedName === 'Forest' || reusedName === 'Mountain' || reusedName === 'Swamp') {
    const suffix = nestedTargetLabel(game, actor, reusedName, action.effectTargetId, controllers, revealEnemyHandForSwamp)
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

function shouldHideHandFromViewer(
  controllers: readonly [ControllerKind, ControllerKind],
  playerIndex: number,
): boolean {
  // Hide an AI player's hand whenever a local human is playing on the other
  // side: in `local-hvai` / `adventure-hvai` the human shares the screen
  // with the AI and could otherwise read the AI's cards. Keep both hands
  // visible for `local-hvh` (both human) and `local-aivai` (no human to
  // protect). For P2P, the local side is `human` and the opposing side is
  // `remote`, so this predicate is false there too — and the remote opponent
  // never sends raw hand data over the wire anyway.
  return controllers[playerIndex] === 'ai' && controllers[1 - playerIndex] === 'human'
}

function projectHandCards(
  hand: ReadonlyArray<{ id: string; name: string }>,
  controllers: readonly [ControllerKind, ControllerKind],
  playerIndex: number,
): UiCard[] {
  if (shouldHideHandFromViewer(controllers, playerIndex)) {
    return hand.map((card) => ({ id: card.id, name: HIDDEN_HAND_CARD_NAME }))
  }
  return hand.map((card) => ({ id: card.id, name: card.name }))
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
      p2pConnected,
      p2pStarted,
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
  //   1. main phase, the human is about to play a Swamp from hand with at
  //      least one legal `effectTargetId` (enemy hand non-empty).
  //   2. plains_target phase, the pending Plains-reuse resolves to Swamp
  //      and the reuse actor is the local human.
  // When true, the picker/labels surface the real enemy hand. The check
  // intentionally uses the raw `GameState` (not the redacted projection)
  // and is scoped to the actor's decision only.
  const isHumanActor = actorControl === 'human' && !replayActive
  let revealEnemyHandForSwamp = false
  if (isHumanActor) {
    if (game.phase === 'plains_target' && game.pendingPlainsReuse?.reusedCardName === 'Swamp' && game.pendingPlainsReuse.actor === actor) {
      revealEnemyHandForSwamp = true
    } else if (game.phase === 'main') {
      for (const action of legalActions) {
        if (action.type !== 'play_land' || !action.effectTargetId) {
          continue
        }
        const card = game.players[actor].hand.find((entry) => entry.id === action.cardId)
        if (card?.name === 'Swamp') {
          revealEnemyHandForSwamp = true
          break
        }
      }
    }
  }
  const enemyIndex = actor === 0 ? 1 : 0
  const revealedEnemyHandForSwamp: ReadonlyArray<UiCard> | null = revealEnemyHandForSwamp
    ? Object.freeze(game.players[enemyIndex].hand.map((card) => Object.freeze({ id: card.id, name: card.name })))
    : null

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
        label: playLandLabelFor(game, actor, action, state.controllers, revealEnemyHandForSwamp),
      })
      playLandByCard[action.cardId] = options
      continue
    }

    if (action.type === 'counter_land') {
      counterOptions.push({ action, label: counterLabelFor(game, actor, action) })
      continue
    }

    if (action.type === 'resolve_plains_reuse') {
      plainsReuseOptions.push({ action, label: plainsReuseLabelFor(game, actor, action, state.controllers, revealEnemyHandForSwamp) })
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
    p2pConnected,
    p2pStarted,
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
          battlefield: game.players[0].battlefield.map((entry) => ({ instanceId: entry.instanceId, name: entry.card.name })),
        },
        {
          id: 1,
          handCount: game.players[1].hand.length,
          deckCount: game.players[1].deck.length,
          graveyardCount: game.players[1].graveyard.length,
          handCards: projectHandCards(game.players[1].hand, state.controllers, 1),
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
      // Older persisted snapshots (e.g. Adventure mid-round saves written before
      // LogEvent existed) may not carry an `events` array. Defend against that
      // here so renderers iterating `events` can't crash on legacy data even if
      // the snapshot loader missed back-filling.
      events: game.events ?? [],
      isReplay: replayActive,
      revealedEnemyHandForSwamp,
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
