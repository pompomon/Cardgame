import { activeActor } from '../app/active-actor'
import {
  labelGameActions,
  projectPlayersForPresentation,
  revealedEnemyHandForSwamp,
  type LabeledGameAction,
} from '../app/game-presentation'
import { isLegalActionForState, isSameAction } from '../app/action-validation'
import { HIDDEN_HAND_CARD_NAME, type ControllerKind } from '../app/types'
import { chooseAiAction } from '../game/ai'
import { applyAction, canAct, createInitialGame, getLegalActions } from '../game/engine'
import type { AiLevel } from '../game/ai-levels'
import type { GameAction, GameState } from '../game/types'
import type { CliIo } from './io'
import type { CliMode } from './options'

const MAX_SESSION_ACTIONS = 10_000

export interface GameSessionConfig {
  readonly mode: CliMode
  readonly aiLevel: AiLevel
  readonly seed: number
  readonly delayMs: number
}

export interface GameSessionResult {
  readonly status: 'completed' | 'quit'
  readonly state: GameState
  readonly actions: readonly GameAction[]
}

function controllersForMode(mode: CliMode): [ControllerKind, ControllerKind] {
  return mode === 'human-vs-ai' ? ['human', 'ai'] : ['ai', 'ai']
}

function controllerLabel(controller: ControllerKind): string {
  return controller === 'human' ? 'Human' : 'AI'
}

function formatBattlefield(names: readonly string[]): string {
  return names.length > 0 ? names.join(', ') : 'empty'
}

function formatHand(names: readonly string[]): string {
  if (names.length === 0) {
    return 'empty'
  }
  if (names.every((name) => name === HIDDEN_HAND_CARD_NAME)) {
    return `${names.length} hidden card${names.length === 1 ? '' : 's'}`
  }
  return names.join(', ')
}

export function formatTerminalGameState(
  state: GameState,
  controllers: readonly [ControllerKind, ControllerKind],
  actor: number,
): readonly string[] {
  const players = projectPlayersForPresentation(state, controllers)
  const lines = [
    '',
    `Turn ${state.turn} | Phase: ${state.phase} | Active: Player ${actor + 1} (${controllerLabel(controllers[actor])})`,
  ]
  for (const player of players) {
    lines.push(
      `Player ${player.id + 1} (${controllerLabel(controllers[player.id])})`
      + ` | Deck: ${player.deckCount} | Hand: ${player.handCount} | Graveyard: ${player.graveyardCount}`,
    )
    lines.push(`  Hand: ${formatHand(player.handCards.map((card) => card.name))}`)
    lines.push(`  Battlefield: ${formatBattlefield(player.battlefield.map((card) => card.name))}`)
  }
  const revealed = revealedEnemyHandForSwamp(state, actor, controllers)
  if (revealed) {
    lines.push(`  Revealed discard targets: ${revealed.map((card) => card.name).join(', ') || 'none'}`)
  }
  return Object.freeze(lines)
}

async function chooseHumanAction(
  options: readonly LabeledGameAction[],
  io: CliIo,
): Promise<LabeledGameAction | null> {
  for (let index = 0; index < options.length; index += 1) {
    io.write(`${index + 1}. ${options[index].label}`)
  }
  while (!io.signal?.aborted) {
    const response = await io.read('Choose action (number or q): ')
    if (response === null) {
      return null
    }
    const normalized = response.trim().toLowerCase()
    if (normalized === 'q' || normalized === 'quit') {
      return null
    }
    if (/^[1-9]\d*$/.test(normalized)) {
      const selected = Number(normalized) - 1
      if (selected >= 0 && selected < options.length) {
        return options[selected]
      }
    }
    io.writeError(`Invalid selection. Enter a number from 1 to ${options.length}, or q to quit.`)
  }
  return null
}

function winnerMessage(state: GameState): string {
  if (state.winner === 'draw') {
    return 'Game over: draw.'
  }
  if (state.winner === null) {
    return 'Game over without a winner.'
  }
  return `Game over: Player ${state.winner + 1} wins.`
}

export async function runGameSession(
  config: GameSessionConfig,
  io: CliIo,
): Promise<GameSessionResult> {
  const controllers = controllersForMode(config.mode)
  const transcript: GameAction[] = []
  let state = createInitialGame(config.seed)

  io.write(`Starting ${config.mode} | Seed: ${config.seed} | AI level: ${config.aiLevel}`)

  while (state.phase !== 'gameOver') {
    if (io.signal?.aborted) {
      io.write('Game exited.')
      return { status: 'quit', state, actions: Object.freeze([...transcript]) }
    }
    if (transcript.length >= MAX_SESSION_ACTIONS) {
      throw new Error(`Game exceeded the safety limit of ${MAX_SESSION_ACTIONS} actions.`)
    }

    const actor = activeActor(state)
    if (!canAct(state, actor)) {
      throw new Error(`Player ${actor + 1} cannot act during phase ${state.phase}.`)
    }
    const legalActions = getLegalActions(state, actor)
    if (legalActions.length === 0) {
      throw new Error(`No legal actions are available for Player ${actor + 1} during phase ${state.phase}.`)
    }
    const revealEnemyHand = revealedEnemyHandForSwamp(state, actor, controllers) !== null
    const labeledActions = labelGameActions(
      state,
      legalActions,
      controllers,
      revealEnemyHand,
    )
    for (const line of formatTerminalGameState(state, controllers, actor)) {
      io.write(line)
    }

    let selected: LabeledGameAction | null
    if (controllers[actor] === 'human') {
      selected = await chooseHumanAction(labeledActions, io)
      if (!selected) {
        io.write('Game exited.')
        return { status: 'quit', state, actions: Object.freeze([...transcript]) }
      }
    } else {
      if (config.delayMs > 0) {
        await io.delay(config.delayMs)
      }
      if (io.signal?.aborted) {
        io.write('Game exited.')
        return { status: 'quit', state, actions: Object.freeze([...transcript]) }
      }
      const action = chooseAiAction(state, actor, { level: config.aiLevel })
      if (!action) {
        throw new Error(`AI Player ${actor + 1} returned no action despite having legal actions.`)
      }
      const labeled = labeledActions.find((candidate) => isSameAction(candidate.action, action))
      selected = labeled ?? null
      if (!selected) {
        throw new Error(`AI Player ${actor + 1} returned an action outside the legal action set.`)
      }
    }

    if (!isLegalActionForState(state, selected.action)) {
      throw new Error(`Rejected illegal action selected for Player ${actor + 1}.`)
    }
    io.write(`Player ${actor + 1} (${controllerLabel(controllers[actor])}): ${selected.label}`)
    transcript.push(selected.action)
    state = applyAction(state, selected.action)
  }

  for (const line of formatTerminalGameState(state, controllers, state.currentPlayer)) {
    io.write(line)
  }
  io.write(winnerMessage(state))
  return {
    status: 'completed',
    state,
    actions: Object.freeze([...transcript]),
  }
}
