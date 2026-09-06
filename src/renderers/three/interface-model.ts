import {
  groupCardTargetOptions,
  resolvePlayLandDrop,
  resolvePlayLandTargetSelectionMode,
  type TargetSelectionContext,
} from '../../app/action-resolution'
import { AI_LEVEL_OPTIONS } from '../../app/ai-levels'
import { ANIMATION_SPEED_OPTIONS } from '../../app/animation-settings'
import { BOARD_THEME_OPTIONS } from '../../app/board-theme'
import { CARD_VISUAL_STYLE_OPTIONS } from '../../app/card-visual-styles'
import { RENDER_QUALITY_PREFERENCE_OPTIONS } from '../../app/render-quality'
import { buildCounterHandOptions, type CounterHandOptions } from '../../app/response-options'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel, type GameUiState, type Mode } from '../../app/types'
import { canPreviewCard } from '../card-preview'
import { escapeHtml, renderCardTile, renderInstallControls, renderLobby, renderP2P } from '../dom-utils'
import type { BoardHit } from './contracts'

export const THREE_LOG_LIMIT = 14

export interface InterfaceUi {
  readonly presentedActor: number
  readonly menuOpen: boolean
  readonly pendingCardId: string | null
  readonly phaseDismissed: boolean
  readonly preview: BoardHit | null
  readonly hostAnswerDraft: string
  readonly joinOfferDraft: string
}

export interface TargetModel {
  readonly context: TargetSelectionContext
  readonly title: string
  readonly battlefield: boolean
  readonly options: ReadonlyArray<{ effectTargetId?: string; label: string; cardName: string }>
}

export function isThreeMode(value: unknown): value is Mode {
  return value === 'tutorial' || value === 'local-hvh' || value === 'local-hvai'
    || value === 'local-aivai' || value === 'adventure-hvai'
    || value === 'p2p-host' || value === 'p2p-join'
}

export function isThreeInGame(view: AppViewModel): boolean {
  return view.game !== null && (view.replay.active
    || (view.mode !== 'p2p-host' && view.mode !== 'p2p-join') || view.p2pStarted)
}

export function canThreeInput(view: AppViewModel, presentedActor: number): boolean {
  return isThreeInGame(view) && !!view.game?.canInput && !view.game.isReplay
    && !view.replay.active && view.game.actor === presentedActor
}

export function threeSessionKey(view: AppViewModel): string {
  return JSON.stringify([view.mode, view.seed, !!view.game, view.replay.active, view.game?.isReplay, view.p2pStarted])
}

// Excludes settings/status and the growing log, but invalidates selections on
// changes to the actual decision (including a replay step or a same-phase play).
export function threeDecisionKey(view: AppViewModel): string {
  const game = view.game
  return JSON.stringify([threeSessionKey(view), view.replay.step, game && [
    game.turn, game.phase, game.actor, game.actorControl, game.canInput, game.pendingLandName,
    game.pendingPlainsReuseName, game.legal, game.players, game.revealedEnemyHandForSwamp,
  ]])
}

export function threeResponse(view: AppViewModel, ui: InterfaceUi): CounterHandOptions | null {
  const game = view.game
  if (!game || game.phase !== 'respond' || game.actorControl !== 'human'
    || view.controllers[game.actor] !== 'human' || !canThreeInput(view, ui.presentedActor)
    || ui.menuOpen || ui.preview || ui.pendingCardId) return null
  const response = buildCounterHandOptions(game)
  return {
    ...response,
    choices: response.requiredIslandId === null ? [] : response.choices.filter((choice) =>
      choice.cardName !== HIDDEN_HAND_CARD_NAME && choice.action.actor === game.actor),
    instruction: `${response.instruction} The first Island (blue ring) is included automatically; pink rings mark your choices.`,
  }
}

export function threeTargets(view: AppViewModel, ui: InterfaceUi): TargetModel | null {
  const game = view.game
  if (!game || !canThreeInput(view, ui.presentedActor)) return null
  let context: TargetSelectionContext
  let title: string
  let battlefield: boolean
  let options: Array<{ effectTargetId?: string; label: string }>
  if (game.phase === 'main' && ui.pendingCardId) {
    const resolution = resolvePlayLandDrop(game, ui.pendingCardId)
    if (resolution.kind !== 'needs_target') return null
    context = { kind: 'play_land', cardId: ui.pendingCardId }
    const name = game.players[game.actor].handCards.find((card) => card.id === ui.pendingCardId)?.name ?? 'land'
    title = `Choose ${name} target`
    battlefield = resolvePlayLandTargetSelectionMode(game, ui.pendingCardId) === 'battlefield_highlight'
    options = resolution.options
  } else if (game.phase === 'plains_target') {
    context = { kind: 'plains_reuse' }
    title = `Choose Plains reuse target for ${game.pendingPlainsReuseName ?? 'land'}`
    battlefield = game.pendingPlainsReuseName === 'Mountain' || game.pendingPlainsReuseName === 'Plains'
    options = game.legal.plainsReuseOptions.map(({ action, label }) => ({ effectTargetId: action.effectTargetId, label }))
  } else if (game.phase === 'swamp_target') {
    context = { kind: 'swamp_discard' }
    title = 'Choose Swamp discard target'
    battlefield = false
    options = game.legal.swampDiscardOptions.map(({ action, label }) => ({ effectTargetId: action.effectTargetId, label }))
  } else {
    return null
  }
  return {
    context, title, battlefield,
    options: battlefield
      ? options.map((option) => ({
        ...option,
        cardName: game.players.flatMap((player) => player.battlefield)
          .find((card) => card.instanceId === option.effectTargetId)?.name ?? option.label,
      }))
      : groupCardTargetOptions(game, context, options),
  }
}

export function threePreviewName(game: GameUiState, hit: BoardHit): string | null {
  const player = game.players[hit.owner]
  if (!player) return null
  const card = hit.zone === 'hand'
    ? player.handCards.find((entry) => entry.id === hit.cardId)
    : player.battlefield.find((entry) => entry.instanceId === hit.instanceId && entry.cardId === hit.cardId)
  return card && card.name !== HIDDEN_HAND_CARD_NAME ? card.name : null
}

function button(action: string, label: string, disabled = false, attrs = ''): string {
  return `<button type="button" data-action="${action}"${disabled ? ' disabled' : ''}${attrs}>${escapeHtml(label)}</button>`
}

function modal(kind: string, title: string, contents: string): string {
  return `<dialog class="three-dialog" data-modal="${kind}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" tabindex="-1">
    <header><h2>${escapeHtml(title)}</h2>${button('close', 'Close', false, ' aria-label="Close dialog"')}</header>${contents}</dialog>`
}

export function renderThreeSettings(view: AppViewModel): string {
  const fields = [
    ['ai-level-select', 'AI difficulty', view.aiLevel, AI_LEVEL_OPTIONS],
    ['card-visual-style-select', 'Card visual style', view.cardVisualStyle, CARD_VISUAL_STYLE_OPTIONS],
    ['animation-speed-select', 'Animation speed', view.animationSpeed, ANIMATION_SPEED_OPTIONS],
    ['board-theme-select', 'Board theme', view.boardTheme, BOARD_THEME_OPTIONS],
    ['render-quality-select', 'Render quality', view.renderQualityPreference, RENDER_QUALITY_PREFERENCE_OPTIONS],
  ] as const
  return `<section aria-label="Settings"><h3>Settings</h3><div class="three-settings">${fields.map(([id, label, value, options]) =>
    `<label for="${id}">${label}<select id="${id}">${options.map((option) =>
      `<option value="${option.value}"${option.value === value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`,
  ).join('')}</div><p>Animation default follows the system reduced-motion preference.</p></section>`
}

function renderReplay(view: AppViewModel): string {
  if (!view.replay.active) return ''
  return `<section aria-label="Replay controls"><h3>Replay</h3><p>Step ${view.replay.step}/${view.replay.totalSteps} · ${view.replay.isPlaying ? 'Playing' : 'Paused'}</p>
    <div class="three-actions">${button('replay-playpause', view.replay.isPlaying ? 'Pause Replay' : 'Play Replay')}
    ${button('replay-prev', 'Previous Step', view.replay.step <= 0)}
    ${button('replay-next', 'Next Step', view.replay.step >= view.replay.totalSteps)}
    ${button('replay-end', 'Jump to End', view.replay.step >= view.replay.totalSteps)}
    ${button('replay-exit', 'Exit Replay')}</div></section>`
}

function renderRecorder(view: AppViewModel): string {
  const meta = view.recording.metadata
  return `<section aria-label="Recording"><h3>Recording</h3><p>${meta
    ? escapeHtml(`Seed ${meta.seed} · Mode ${meta.mode} · AI ${meta.aiLevel} · Controllers ${meta.controllers.join('/')} · Completed ${meta.completed ? 'Yes' : 'No'}`)
    : 'No recording data.'}</p><p>Local save available: ${view.recording.hasLocalSave ? 'Yes' : 'No'}</p>
    <div class="three-actions">${button('save-recording-download', 'Download Save File', !view.recording.canSave)}
    ${button('save-recording-local', 'Save to Browser', !view.recording.canSave)}
    ${button('load-recording-local', 'Load from Browser', !view.recording.canLoadLocal)}
    ${button('load-recording-file', 'Load from File')}
    ${view.replay.active ? '' : button('replay-start', 'Start Replay', !view.recording.canSave)}</div></section>`
}

function renderMenu(view: AppViewModel): string {
  return modal('menu', 'Game Menu', `<div class="three-actions">${view.mode === 'adventure-hvai' && !view.replay.active
    ? button('pause-adventure', 'Pause Adventure') + button('abandon-adventure', 'Reset Adventure Run')
    : button('back-to-lobby', view.mode === 'tutorial' ? 'Exit Tutorial' : 'Back to Lobby')
      + (view.mode === 'tutorial' || view.replay.active ? '' : button('rematch', 'Rematch'))}</div>
    ${renderThreeSettings(view)}${renderInstallControls()}${renderRecorder(view)}${renderReplay(view)}`)
}

function renderTargets(view: AppViewModel, ui: InterfaceUi, target: TargetModel): string {
  if (ui.phaseDismissed && !ui.pendingCardId) {
    return `<section aria-label="Pending target selection"><p>${escapeHtml(target.title)}</p>${button('resume-target', 'Choose Target')}</section>`
  }
  const options = `<div class="three-targets" data-scroll-key="targets">${target.options.map((option) =>
    `<button type="button" data-action="target"${option.effectTargetId === undefined ? '' : ` data-target-id="${escapeHtml(option.effectTargetId)}"`}>${renderCardTile(option.cardName, view.cardVisualStyle)}<span>${escapeHtml(option.label)}</span></button>`,
  ).join('') || '<p>No legal targets available.</p>'}</div>`
  return target.battlefield
    ? `<section class="three-target-panel" role="region" aria-label="${escapeHtml(target.title)}"><h3>${escapeHtml(target.title)}</h3>
      <p>Select a highlighted battlefield card, or use a target button below.</p>${options}${button('close', ui.pendingCardId ? 'Cancel Target Selection' : 'Close Target Selection')}</section>`
    : modal('target', target.title, options)
}

function renderNativeCards(view: AppViewModel, ui: InterfaceUi, blocked: boolean, response: CounterHandOptions | null): string {
  const game = view.game!
  const previewAllowed = canPreviewCard({ phase: game.phase, pendingPlayLandTargetSelection: !!ui.pendingCardId, menuOpen: blocked })
  const responseChoices = new Map(response?.choices.map((choice) => [choice.cardId, choice]) ?? [])
  const owners = ui.presentedActor === 1 ? [1, 0] : [0, 1]
  return `<details data-detail-key="cards" open><summary>Cards &amp; keyboard controls</summary>
    <p>Play, respond, or preview using the hand-card controls, or interact with the 3D board above.</p>
    ${owners.map((owner) => {
      const player = game.players[owner]
      return `<section aria-label="Player ${owner + 1} cards"><h3>Player ${owner + 1} (${escapeHtml(view.controllers[owner])})${game.actor === owner ? ' · Active' : ''}</h3>
        <p>Hand ${player.handCount} · Deck ${player.deckCount} · Graveyard ${player.graveyardCount}</p>
        <h4>Hand</h4><div class="three-native-cards" data-scroll-key="hand-${owner}">${player.handCards.map((card) => {
          if (card.name === HIDDEN_HAND_CARD_NAME) return '<span class="three-hidden-card">Hidden card</span>'
          const playable = !blocked && canThreeInput(view, ui.presentedActor) && owner === game.actor
            && game.phase === 'main' && (game.legal.playLandByCard[card.id]?.length ?? 0) > 0
          const responding = game.phase === 'respond' && owner === game.actor
          const choice = owner === game.actor ? responseChoices.get(card.id) : undefined
          if (responding && response) {
            const required = response.requiredIslandId === card.id
            return `<div class="three-native-card" data-response="${required ? 'required' : choice ? 'discard' : 'unavailable'}"><span>${escapeHtml(card.name)}</span>
              ${required ? '<span>Island included automatically</span>' : choice
                ? button('respond-card', choice.a11yLabel, false, ` data-card-id="${escapeHtml(card.id)}" data-owner="${owner}"`)
                : '<span>Not available for this counter</span>'}</div>`
          }
          return `<div class="three-native-card"><span>${escapeHtml(card.name)}</span>
            ${button('play', `Play ${card.name}`, !playable, ` data-card-id="${escapeHtml(card.id)}"`)}
            ${button('preview', `Preview ${card.name}`, !previewAllowed || responding, ` data-zone="hand" data-owner="${owner}" data-card-id="${escapeHtml(card.id)}"`)}</div>`
        }).join('') || '<p>No cards.</p>'}</div>
        <h4>Battlefield</h4><div class="three-native-cards" data-scroll-key="battlefield-${owner}">${player.battlefield.map((card) =>
          button('preview', `Preview ${card.name}`, !previewAllowed, ` data-zone="battlefield" data-owner="${owner}" data-card-id="${escapeHtml(card.cardId)}" data-instance-id="${escapeHtml(card.instanceId)}"`),
        ).join('') || '<p>No lands.</p>'}</div></section>`
    }).join('')}</details>`
}

export function renderThreeInterface(view: AppViewModel, ui: InterfaceUi): string {
  if (!isThreeInGame(view)) {
    const p2p = view.mode === 'p2p-host' || view.mode === 'p2p-join'
    const signaling = p2p ? renderP2P(view, ui.hostAnswerDraft, ui.joinOfferDraft)
      .replace('id="start-p2p-game"', `id="start-p2p-game"${view.p2pConnected && !view.p2pStarted ? '' : ' disabled'}`)
      .replace('id="offer-text"', 'id="offer-text" aria-label="Local offer"')
      .replace('id="answer-text"', 'id="answer-text" aria-label="Remote answer"')
      .replace('id="join-offer-text"', 'id="join-offer-text" aria-label="Host offer"')
      .replace('id="join-answer-text"', 'id="join-answer-text" aria-label="Local answer"') : ''
    return `${renderLobby(view)}${signaling}${p2p
      ? `<p>${view.p2pConnected ? 'Peer connected. Waiting for both peers to confirm game readiness.' : 'Waiting for peer connection.'}</p>${button('back-to-lobby', 'Back to Lobby')}` : ''}`
  }
  const game = view.game!
  const targets = threeTargets(view, ui)
  const response = threeResponse(view, ui)
  const blocked = ui.menuOpen || !!ui.preview || !!targets && !ui.phaseDismissed
  const canInput = canThreeInput(view, ui.presentedActor) && !blocked
  const previewName = ui.preview ? threePreviewName(game, ui.preview) : null
  const omitted = Math.max(0, game.log.length - THREE_LOG_LIMIT)
  return `<section class="three-hud" aria-label="Game controls">
    <header class="three-header">${button('menu', '☰ Menu', false, ` aria-haspopup="dialog" aria-expanded="${ui.menuOpen}"`)}
      <h2>Turn ${game.turn} · ${escapeHtml(game.phase)}</h2><span>Player ${game.actor + 1}</span></header>
    <p role="status" aria-live="polite">${escapeHtml(view.status)}</p>
    ${game.winnerText ? `<p class="three-winner">${escapeHtml(game.winnerText)}</p>` : ''}
    ${view.tutorial.active ? `<aside class="three-tutorial" aria-label="Tutorial hint">${escapeHtml(view.tutorial.hint ?? 'Keep playing to continue the tutorial.')}</aside>` : ''}
    ${view.mode === 'adventure-hvai' ? `<p>Adventure round ${view.adventure.currentRound}/7 · Chances ${view.adventure.remainingChances} · Win streak ${view.adventure.winStreak} · High score ${view.adventure.highScore}</p>` : ''}
    ${!game.canInput && !view.replay.active && game.phase !== 'gameOver' ? '<p>Waiting for the other player.</p>' : ''}
    ${game.phase === 'main' && canThreeInput(view, ui.presentedActor) ? `<div class="three-actions" aria-label="Turn actions">${button('end_turn', 'End Turn', !canInput || !game.legal.canEndTurn)}</div>` : ''}
    ${response ? `<section aria-label="Response actions"><h3>Respond to ${escapeHtml(game.pendingLandName ?? 'land')}</h3>
      <p role="status" aria-live="polite">${escapeHtml(response.choices.length ? response.instruction : 'No legal counter cards available.')}</p>
      ${response.canPass ? button('pass_response', 'Pass Response') : ''}</section>` : ''}
    ${targets && !ui.menuOpen && !ui.preview ? renderTargets(view, ui, targets) : ''}
    ${renderReplay(view)}${renderNativeCards(view, ui, blocked, response)}
    <details data-detail-key="log"><summary>Replay Log (${Math.min(THREE_LOG_LIMIT, game.log.length)} latest)</summary>
      ${omitted ? `<p>${omitted} older entries omitted. Export the recording for the full history.</p>` : ''}
      <ol>${game.log.slice(-THREE_LOG_LIMIT).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol></details>
    ${ui.menuOpen ? renderMenu(view) : ''}
    ${previewName ? modal('preview', `${previewName} card preview`, renderCardTile(previewName, view.cardVisualStyle)) : ''}
    </section>`
}
