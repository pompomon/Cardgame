// Renders the active player's hand (draggable land cards, response
// highlights) and the phase-specific controls below it: Plains reuse /
// Swamp discard target pickers, counter-response controls, and End Turn.
// Extracted from gameplay-presenter.ts.
import type Phaser from 'phaser'
import {
  groupCardTargetOptions,
  resolvePlainsReuseTargetSelectionMode,
  resolveSwampDiscardAction,
} from '../../app/action-resolution'
import type { GameUiState } from '../../app/types'
import type { GameAction } from '../../game/types'
import type { BattlefieldTargetsController } from './battlefield-targets'
import type { CardViewDescriptor } from './card-view'
import { xForHandCardInBoardColumn, type SceneLayout } from './layout'
import { buildCounterHandOptions } from './response-options'
import { renderResponseControls } from './response-controls'
import type { TargetPickerController } from './target-picker'
import { UI_THEME } from './theme'

export interface HandControlsContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
  submitAction: (action: GameAction) => void
  createButton: (label: string, x: number, y: number, onClick: () => void, width?: number, height?: number, fontSize?: string) => Phaser.GameObjects.Container
  battlefieldTargets: BattlefieldTargetsController
  targetPicker: TargetPickerController
  setStatus: (message: string) => void
}

export function buildHandCardDescriptors(
  ctx: HandControlsContext,
  game: GameUiState,
  presentedActor = game.actor,
): CardViewDescriptor[] {
  const layout = ctx.getLayout()
  const actor = presentedActor
  const actorCards = game.players[actor].handCards
  const presentationIsCurrent = actor === game.actor
  const canDrag = presentationIsCurrent && game.canInput && game.phase === 'main'
    && ctx.battlefieldTargets.getPendingPlayLandTargetSelection() === null
  const response = presentationIsCurrent && game.canInput && game.phase === 'respond'
    ? buildCounterHandOptions(game)
    : null
  const responseChoices = new Map(response?.choices.map((choice) => [choice.cardId, choice]) ?? [])
  const cards: CardViewDescriptor[] = []

  actorCards.forEach((card, index) => {
    const x = xForHandCardInBoardColumn(layout, index, actorCards.length)
    const y = layout.handCardsY
    const responseChoice = responseChoices.get(card.id)
    const draggable = canDrag && game.legal.playLandByCard[card.id] !== undefined
    cards.push({
      cardId: card.id,
      instanceId: null,
      playerIndex: actor,
      zone: 'hand',
      name: card.name,
      x,
      y,
      width: layout.handCardWidth,
      height: layout.handCardHeight,
      highlight: draggable
        || response?.requiredIslandId === card.id
        || responseChoice !== undefined,
      onClick: responseChoice
        ? () => ctx.submitAction(responseChoice.action)
        : undefined,
      draggable,
      preview: response === null,
      interactionKey: responseChoice
        ? `response:${JSON.stringify(responseChoice.action)}`
        : `${draggable ? 'drag' : 'static'}:preview:hand:${card.id}:${card.name}`,
    })
  })
  return cards
}

export function renderHandAndControls(
  ctx: HandControlsContext,
  game: GameUiState,
  presentedActor = game.actor,
): void {
  const scene = ctx.scene
  const layout = ctx.getLayout()
  const rootContainer = ctx.getRootContainer()
  const { battlefieldTargets, targetPicker } = ctx
  const actor = presentedActor
  const presentationIsCurrent = actor === game.actor
  const response = presentationIsCurrent && game.canInput && game.phase === 'respond'
    ? buildCounterHandOptions(game)
    : null
  if (presentationIsCurrent && game.canInput && game.phase === 'plains_target') {
    if (!targetPicker.isTargetPickerOpen()) {
      const options: Array<{ effectTargetId: string; label: string; action: GameAction }> = game.legal.plainsReuseOptions.map((option, index) => ({
        effectTargetId: option.action.effectTargetId ?? `plains-option-${index}`,
        label: option.label,
        action: option.action,
      }))
      if (options.length === 1) {
        const [onlyOption] = options
        targetPicker.showTargetPicker(
          [{ effectTargetId: onlyOption.effectTargetId, label: onlyOption.label }],
          () => onlyOption.action,
          false,
          {
            title: `Confirm target for reused ${game.pendingPlainsReuseName ?? 'land'}`,
            allowCancel: false,
          },
        )
        return
      }
      const mode = resolvePlainsReuseTargetSelectionMode(game)
      if (mode === 'popup_cards' && options.length > 0) {
        const grouped = groupCardTargetOptions(
          game,
          { kind: 'plains_reuse' },
          options.map((option) => ({ effectTargetId: option.effectTargetId, label: option.label })),
        )
        targetPicker.showTargetPicker(
          grouped.map((option) => ({
            effectTargetId: option.effectTargetId,
            label: option.label,
            cardName: option.cardName,
          })),
          (effectTargetId) => options.find((option) => option.effectTargetId === effectTargetId)?.action ?? null,
          false,
          {
            title: `Choose target for reused ${game.pendingPlainsReuseName ?? 'land'}`,
            allowCancel: false,
          },
        )
      } else if (mode === 'battlefield_highlight' && options.length > 0) {
        ctx.setStatus('Choose a highlighted battlefield target.')
      }
    }
    return
  }
  if (presentationIsCurrent && game.canInput && game.phase === 'swamp_target') {
    if (!targetPicker.isTargetPickerOpen()) {
      const grouped = groupCardTargetOptions(
        game,
        { kind: 'swamp_discard' },
        game.legal.swampDiscardOptions.map((option) => ({
          effectTargetId: option.action.effectTargetId,
          label: option.label,
        })),
      )
      targetPicker.showTargetPicker(
        grouped.map((option) => ({
          effectTargetId: option.effectTargetId,
          label: option.label,
          cardName: option.cardName,
        })),
        (effectTargetId) => resolveSwampDiscardAction(game, effectTargetId),
        false,
        {
          title: 'Choose Swamp discard target',
          allowCancel: false,
        },
      )
    }
    return
  }
  if (presentationIsCurrent && game.canInput && game.phase === 'respond') {
    if (response && rootContainer) {
      renderResponseControls({
        scene,
        root: rootContainer,
        layout,
        response,
        textColor: UI_THEME.primaryText,
        createButton: (...args) => ctx.createButton(...args),
        onPass: () => ctx.submitAction({ type: 'pass_response', actor: game.actor }),
      })
    }
    return
  }

  if (presentationIsCurrent && game.canInput && game.legal.canEndTurn && game.phase === 'main' && battlefieldTargets.getBattlefieldTargetEntries().length === 0) {
    const endTurnWidth = Math.min(layout.actionButtonWidth, Math.max(120, layout.boardColumnWidth - 16))
    const endTurnX = layout.boardColumnLeft + layout.boardColumnWidth - endTurnWidth / 2 - 4
    // Clamp End Turn button height so it never spills below the hand strip
    // on short viewports where activeInfoControlsHeight may be smaller than
    // the desired action button height.
    const endTurnHeight = Math.min(
      layout.actionButtonHeight + 4,
      Math.max(20, layout.activeInfoControlsHeight),
    )
    rootContainer?.add(ctx.createButton('End Turn', endTurnX, layout.controlsStartY, () => {
      ctx.submitAction({ type: 'end_turn', actor: game.actor })
    }, endTurnWidth, endTurnHeight))
  }
}
