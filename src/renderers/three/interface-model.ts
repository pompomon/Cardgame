import {
  groupCardTargetOptions,
  resolvePlayLandDrop,
  resolvePlayLandTargetSelectionMode,
  targetPromptForContext,
  type TargetSelectionContext,
} from '../../app/action-resolution'
import { AI_LEVEL_OPTIONS } from '../../app/ai-levels'
import { ANIMATION_SPEED_OPTIONS } from '../../app/animation-settings'
import { BOARD_THEME_OPTIONS } from '../../app/board-theme'
import { cardAssetSlug, displayCardName } from '../../app/card-catalog'
import { CARD_VISUAL_STYLE_OPTIONS } from '../../app/card-visual-styles'
import { displayGamePhase } from '../../app/game-presentation'
import { hasSavedAdventureRun, isAdventureResumable, LOBBY_MODE_OPTIONS } from '../../app/lobby-presentation'
import { RENDER_QUALITY_PREFERENCE_OPTIONS } from '../../app/render-quality'
import { buildCounterHandOptions, type CounterHandOptions } from '../../app/response-options'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel, type GameUiState, type Mode } from '../../app/types'
import { isBasicLand, type BasicLand } from '../../game/types'
import { canPreviewCard } from '../card-preview'
import type { BoardHit, RendererCardIdentity } from './contracts'
import { renderThreeLog } from './interface-log'
import { escapeHtml, renderCardTile, renderInstallControls, renderP2P } from './native-html'

export type ThreeLobbyPage = 'root' | 'settings' | 'recording'

export interface InterfaceUi {
  readonly presentedActor: number
  readonly menuOpen: boolean
  readonly cardsOpen: boolean
  readonly pendingCardId: string | null
  readonly phaseDismissed: boolean
  readonly preview: BoardHit | null
  readonly previewReturnToCards: boolean
  readonly hostAnswerDraft: string
  readonly joinOfferDraft: string
  readonly lobbyPage?: ThreeLobbyPage
}

export interface TargetModel {
  readonly context: TargetSelectionContext
  readonly title: string
  readonly battlefield: boolean
  readonly options: ReadonlyArray<{
    effectTargetId?: string
    label: string
    cardName: string
    serializedKey?: BasicLand
    displayName: string
    assetSlug?: string
  }>
}

export interface ThreeCardPresentation extends RendererCardIdentity {
  readonly displayName: string
}

export interface ThreePrimaryAction {
  readonly type: 'end_turn' | 'pass_response'
  readonly label: string
  readonly disabled: boolean
  readonly prompt: string
  readonly decision: string
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
    game.turn, game.phase, game.actor, game.actorControl, game.canInput, game.pendingLandName, game.pendingLandPlay,
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
    instruction: `${response.instruction} The blue frame marks ${response.requiredCardDisplayName}, which is included automatically; pink frames mark your choices.`,
  }
}

export function threePrimaryAction(view: AppViewModel, ui: InterfaceUi): ThreePrimaryAction | null {
  const game = view.game
  if (!game || !canThreeInput(view, ui.presentedActor) || game.actorControl !== 'human'
    || view.controllers[game.actor] !== 'human') return null
  const decision = threeDecisionKey(view)
  if (game.phase === 'main') {
    return {
      type: 'end_turn', label: 'End Turn', decision, prompt: '',
      disabled: !game.legal.canEndTurn || ui.menuOpen || ui.cardsOpen || !!ui.preview || !!ui.pendingCardId,
    }
  }
  const response = threeResponse(view, ui)
  const pendingDisplayName = game.pendingLandDisplayName ?? 'this creature'
  return response ? {
    type: 'pass_response', label: response.passLabel, decision, disabled: !response.canPass || ui.cardsOpen,
    prompt: response.choices.length
      ? response.instruction
      : `No legal card combination can intercept the summon of ${pendingDisplayName}. Choose Let It Through.`,
  } : null
}

export function threeTargets(view: AppViewModel, ui: InterfaceUi): TargetModel | null {
  const game = view.game
  if (!game || !canThreeInput(view, ui.presentedActor)) return null
  let context: TargetSelectionContext
  let battlefield: boolean
  let options: Array<{ effectTargetId?: string; label: string }>
  if (game.phase === 'main' && ui.pendingCardId) {
    const resolution = resolvePlayLandDrop(game, ui.pendingCardId)
    if (resolution.kind !== 'needs_target') return null
    context = { kind: 'play_land', cardId: ui.pendingCardId }
    battlefield = resolvePlayLandTargetSelectionMode(game, ui.pendingCardId) === 'battlefield_highlight'
    options = resolution.options
  } else if (game.phase === 'plains_target') {
    context = { kind: 'plains_reuse' }
    battlefield = game.pendingPlainsReuseName === 'Mountain' || game.pendingPlainsReuseName === 'Plains'
    options = game.legal.plainsReuseOptions.map(({ action, label }) => ({ effectTargetId: action.effectTargetId, label }))
  } else if (game.phase === 'swamp_target') {
    context = { kind: 'swamp_discard' }
    battlefield = false
    options = game.legal.swampDiscardOptions.map(({ action, label }) => ({ effectTargetId: action.effectTargetId, label }))
  } else {
    return null
  }
  return {
    context, title: targetPromptForContext(game, context), battlefield,
    options: battlefield
      ? options.map((option) => {
        const card = game.players.flatMap((player) => player.battlefield)
          .find((entry) => entry.instanceId === option.effectTargetId)
        const presentation = cardPresentation(card)
        return {
          ...option,
          cardName: presentation?.name ?? option.label,
          displayName: presentation?.displayName ?? option.label,
          ...(presentation?.serializedKey ? { serializedKey: presentation.serializedKey } : {}),
          ...(presentation?.assetSlug ? { assetSlug: presentation.assetSlug } : {}),
        }
      })
      : groupCardTargetOptions(game, context, options).map((option) => ({
        ...option,
        ...(option.serializedKey ? { assetSlug: cardAssetSlug(option.serializedKey) } : {}),
      })),
  }
}

function cardPresentation(
  card: { readonly name: string; readonly serializedKey?: BasicLand; readonly displayName?: string } | undefined,
): ThreeCardPresentation | null {
  if (!card || card.name === HIDDEN_HAND_CARD_NAME) return null
  const serializedKey = card.serializedKey ?? (isBasicLand(card.name) ? card.name : null)
  return {
    name: card.name,
    displayName: card.displayName ?? (serializedKey ? displayCardName(serializedKey) : card.name),
    ...(serializedKey
      ? { serializedKey, assetSlug: cardAssetSlug(serializedKey) }
      : {}),
  }
}

export function threePreviewCard(game: GameUiState, hit: BoardHit): ThreeCardPresentation | null {
  const player = game.players[hit.owner]
  if (!player) return null
  const card = hit.zone === 'hand'
    ? player.handCards.find((entry) => entry.id === hit.cardId)
    : player.battlefield.find((entry) => entry.instanceId === hit.instanceId && entry.cardId === hit.cardId)
  return cardPresentation(card)
}

function button(action: string, label: string, disabled = false, attrs = ''): string {
  return `<button type="button" data-action="${action}"${disabled ? ' disabled' : ''}${attrs}>${escapeHtml(label)}</button>`
}

function modal(kind: string, title: string, contents: string, closeAction = 'close', closeLabel = 'Close'): string {
  return `<dialog class="three-dialog" data-modal="${kind}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" tabindex="-1">
    <header><h2>${escapeHtml(title)}</h2>${button(closeAction, closeLabel, false, ` aria-label="${escapeHtml(closeLabel)}"`)}</header>${contents}</dialog>`
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
  const logControllers = view.recording.metadata?.controllers ?? view.controllers
  return modal('menu', 'Game Menu', `<div class="three-actions">${button('cards', 'Cards & keyboard controls', false, ' aria-haspopup="dialog"')}
    ${view.mode === 'adventure-hvai' && !view.replay.active
    ? button('pause-adventure', 'Pause Adventure') + button('abandon-adventure', 'Reset Adventure Run')
    : button('back-to-lobby', view.mode === 'tutorial' ? 'Exit Tutorial' : 'Back to Lobby')
      + (view.mode === 'tutorial' || view.replay.active ? '' : button('rematch', 'Rematch'))}</div>
    ${renderThreeLog(view.game!, view.cardVisualStyle, logControllers)}
    ${renderThreeSettings(view)}${renderInstallControls()}${renderRecorder(view)}${renderReplay(view)}`)
}

function renderThreeLobby(view: AppViewModel, ui: InterfaceUi): string {
  const page = ui.lobbyPage ?? 'root'
  const adventure = view.adventure
  const nextOpponent = adventure.opponentLineup[adventure.currentOpponentIndex]
  const root = `<nav class="three-lobby-modes" aria-label="Game modes">
    ${button('', 'Tutorial (Learn to Play)', false, ' data-mode="tutorial"')}
    ${LOBBY_MODE_OPTIONS.map(({ mode, label }) => button('', label, false, ` data-mode="${mode}"`)).join('')}
    ${isAdventureResumable(adventure) ? button('resume-adventure', 'Resume Adventure') : ''}</nav>
    <nav class="three-actions" aria-label="Lobby options">${button('lobby-settings', 'Settings')}${button('lobby-recording', 'Recording')}</nav>
    <section aria-label="Adventure"><h2>Adventure</h2>
      <p>High Score: ${adventure.highScore} · Status: ${escapeHtml(adventure.status)}</p>
      <p>Round: ${adventure.currentRound}/7 · Chances: ${adventure.remainingChances} · Win Streak: ${adventure.winStreak}</p>
      <p>Total Rounds: ${adventure.totalRoundsPlayed} · Cards Played: ${adventure.totalCardsPlayed}</p>
      <p>Next Opponent: ${nextOpponent ? escapeHtml(nextOpponent.label) : 'N/A'}</p>
      ${hasSavedAdventureRun(adventure) ? button('abandon-adventure', 'Reset Adventure Run') : ''}</section>
    ${renderInstallControls()}`
  return `<section class="panel three-lobby" data-lobby-page="${page}" aria-label="Game lobby">
    <header><p>Three.js tabletop</p><h1 tabindex="-1" data-lobby-heading>Urban Creatures${page === 'root' ? '' : page === 'settings' ? ' · Settings' : ' · Recording'}</h1>
      ${page === 'root' ? '<p>Urban-fantasy 2-player card game with local AI and optional P2P mode.</p>' : button('lobby-root', 'Back')}</header>
    ${view.status ? `<p role="status" aria-live="polite">${escapeHtml(view.status)}</p>` : ''}
    ${page === 'root' ? root : page === 'settings' ? renderThreeSettings(view) : renderRecorder(view)}
  </section>`
}

function renderTargets(view: AppViewModel, ui: InterfaceUi, target: TargetModel): string {
  if (ui.phaseDismissed && !ui.pendingCardId) {
    return `<section aria-label="Pending target selection"><p>${escapeHtml(target.title)}</p>${button('resume-target', 'Choose Target')}</section>`
  }
  const options = `<div class="three-targets" data-scroll-key="targets">${target.options.map((option) =>
    `<button type="button" data-action="target"${option.effectTargetId === undefined ? '' : ` data-target-id="${escapeHtml(option.effectTargetId)}"`}>${renderCardTile({
      name: option.cardName,
      displayName: option.displayName,
      ...(option.serializedKey ? { serializedKey: option.serializedKey } : {}),
      ...(option.assetSlug ? { assetSlug: option.assetSlug } : {}),
    }, view.cardVisualStyle)}<span>${escapeHtml(option.label)}</span></button>`,
  ).join('') || '<p>No legal targets available.</p>'}</div>`
  return target.battlefield
    ? `<section class="three-target-panel" role="region" aria-label="${escapeHtml(target.title)}"><h3>${escapeHtml(target.title)}</h3>
      <p>Select a highlighted creature on the board, or use a target button below.</p>${options}${button('close', ui.pendingCardId ? 'Cancel Target Selection' : 'Close Target Selection')}</section>`
    : modal('target', target.title, options)
}

function renderNativeCards(view: AppViewModel, ui: InterfaceUi, blocked: boolean, response: CounterHandOptions | null): string {
  const game = view.game!
  const previewAllowed = canPreviewCard({ phase: game.phase, pendingPlayLandTargetSelection: !!ui.pendingCardId, menuOpen: blocked })
  const responseChoices = new Map(response?.choices.map((choice) => [choice.cardId, choice]) ?? [])
  const owners = ui.presentedActor === 1 ? [1, 0] : [0, 1]
  return modal('cards', 'Cards & keyboard controls',
    `<p>Summon, intercept, or preview using the hand-card controls, or interact with the 3D board.</p>
    ${owners.map((owner) => {
      const player = game.players[owner]
      return `<section aria-label="Player ${owner + 1} cards"><h3>Player ${owner + 1} (${escapeHtml(view.controllers[owner])})${game.actor === owner ? ' · Active' : ''}</h3>
        <p>Hand ${player.handCount} · Deck ${player.deckCount} · Discard pile ${player.graveyardCount}</p>
        <h4>Hand</h4><div class="three-native-cards" data-scroll-key="hand-${owner}">${player.handCards.map((card) => {
          if (card.name === HIDDEN_HAND_CARD_NAME) return '<span class="three-hidden-card">Hidden card</span>'
          const presentation = cardPresentation(card)!
          const displayName = presentation.displayName
          const playable = !blocked && canThreeInput(view, ui.presentedActor) && owner === game.actor
            && game.phase === 'main' && (game.legal.playLandByCard[card.id]?.length ?? 0) > 0
          const responding = response !== null && owner === game.actor
          const choice = owner === game.actor ? responseChoices.get(card.id) : undefined
          if (responding && response) {
            const required = response.requiredIslandId === card.id
            const cardDisplayName = required
              ? response.requiredCardDisplayName
              : choice?.displayName ?? presentation.displayName
            return `<div class="three-native-card" data-response="${required ? 'required' : choice ? 'discard' : 'unavailable'}"><span>${escapeHtml(cardDisplayName)}</span>
              ${required ? `<span>${escapeHtml(response.requiredCardHint)}</span>` : choice
                ? button('respond-card', choice.a11yLabel, false, ` data-card-id="${escapeHtml(card.id)}" data-owner="${owner}"`)
                : '<span>Not available for Intercept</span>'}</div>`
          }
          return `<div class="three-native-card"><span>${escapeHtml(displayName)}</span>
            ${button('play', `Summon ${displayName}`, !playable, ` data-card-id="${escapeHtml(card.id)}"`)}
            ${button('preview', `Preview ${displayName}`, !previewAllowed || responding, ` data-zone="hand" data-owner="${owner}" data-card-id="${escapeHtml(card.id)}"`)}</div>`
        }).join('') || '<p>No cards in hand.</p>'}</div>
        <h4>Board</h4><div class="three-native-cards" data-scroll-key="battlefield-${owner}">${player.battlefield.map((card) => {
          const presentation = cardPresentation(card)!
          return `<div class="three-native-card"><span>${escapeHtml(presentation.displayName)}</span>${button(
            'preview',
            `Preview ${presentation.displayName}`,
            !previewAllowed,
            ` data-zone="battlefield" data-owner="${owner}" data-card-id="${escapeHtml(card.cardId)}" data-instance-id="${escapeHtml(card.instanceId)}"`,
          )}</div>`
        }).join('') || '<p>No creatures on the board.</p>'}</div>
        ${player.graveyardCount === 0 ? '<p>Discard pile empty.</p>' : ''}</section>`
    }).join('')}`,
    'cards-back', 'Back to Game Menu')
}

export function renderThreeHud(view: AppViewModel, ui: InterfaceUi): string {
  if (!isThreeInGame(view)) return ''
  const game = view.game!
  const targets = threeTargets(view, ui)
  return `<section class="three-hud" aria-label="Game controls">
    <header class="three-header">${button('menu', '☰ Menu', false, ` aria-haspopup="dialog" aria-expanded="${ui.menuOpen}"`)}
      <h2>Turn ${game.turn} · ${escapeHtml(displayGamePhase(game.phase))}</h2><span>Player ${game.actor + 1}</span></header>
    <p role="status" aria-live="polite">${escapeHtml(view.status)}</p>
    ${game.winnerText ? `<p class="three-winner">${escapeHtml(game.winnerText)}</p>` : ''}
    ${view.tutorial.active ? `<aside class="three-tutorial" aria-label="Tutorial hint">${escapeHtml(view.tutorial.hint ?? 'Keep playing to continue the tutorial.')}</aside>` : ''}
    ${view.mode === 'adventure-hvai' ? `<p>Adventure round ${view.adventure.currentRound}/7 · Chances ${view.adventure.remainingChances} · Win streak ${view.adventure.winStreak} · High score ${view.adventure.highScore}</p>` : ''}
    ${!game.canInput && !view.replay.active && game.phase !== 'gameOver' ? '<p>Waiting for the other player.</p>' : ''}
    ${targets && !ui.menuOpen && !ui.preview ? `<p class="three-required-prompt">${escapeHtml(targets.title)}</p>` : ''}
    ${ui.menuOpen ? '' : renderReplay(view)}</section>`
}

export function renderThreeHover(view: AppViewModel, hit: BoardHit | null): string {
  const card = view.game && hit ? threePreviewCard(view.game, hit) : null
  return card ? `<aside class="three-hover-preview" aria-hidden="true">${renderCardTile(card, view.cardVisualStyle)}</aside>` : ''
}

export function renderThreeInterface(view: AppViewModel, ui: InterfaceUi, includeHud = true): string {
  if (!isThreeInGame(view)) {
    const p2p = view.mode === 'p2p-host' || view.mode === 'p2p-join'
    const signaling = p2p ? renderP2P(view, ui.hostAnswerDraft, ui.joinOfferDraft)
      .replace('id="start-p2p-game"', `id="start-p2p-game"${view.p2pConnected && !view.p2pStarted ? '' : ' disabled'}`)
      .replace('id="offer-text"', 'id="offer-text" aria-label="Local offer"')
      .replace('id="answer-text"', 'id="answer-text" aria-label="Remote answer"')
      .replace('id="join-offer-text"', 'id="join-offer-text" aria-label="Host offer"')
      .replace('id="join-answer-text"', 'id="join-answer-text" aria-label="Local answer"') : ''
    return `${renderThreeLobby(view, ui)}${signaling}${p2p
      ? `<p>${view.p2pConnected ? 'Peer connected. Waiting for both peers to confirm game readiness.' : 'Waiting for peer connection.'}</p>${button('back-to-lobby', 'Back to Lobby')}` : ''}`
  }
  const game = view.game!
  const targets = threeTargets(view, ui)
  const response = threeResponse(view, ui)
  const nativeBlocked = ui.menuOpen || !!ui.preview || !!targets && !ui.phaseDismissed
  const previewCard = ui.preview ? threePreviewCard(game, ui.preview) : null
  return `${includeHud ? renderThreeHud(view, ui) : ''}<section class="three-secondary-controls" aria-label="Additional game controls">
    ${targets && !ui.menuOpen && !ui.cardsOpen && !ui.preview ? renderTargets(view, ui, targets) : ''}
    ${ui.menuOpen ? renderMenu(view) : ''}
    ${ui.cardsOpen ? renderNativeCards(view, ui, nativeBlocked, response) : ''}
    ${previewCard ? modal('preview', `${previewCard.displayName} card preview`, renderCardTile(previewCard, view.cardVisualStyle),
    'close', ui.previewReturnToCards ? 'Back to Cards' : 'Close') : ''}
    </section>`
}
