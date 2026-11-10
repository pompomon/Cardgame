import {
  groupCardTargetOptions,
  resolvePlayLandDrop,
  resolvePlayLandTargetSelectionMode,
  targetPromptForContext,
  type TargetSelectionContext,
} from '../../app/action-resolution'
import { ADVENTURE_TIER_COUNT, type AdventureNodeLane, type AdventureNodeStatus } from '../../app/adventure'
import { AI_LEVEL_OPTIONS } from '../../app/ai-levels'
import { ANIMATION_SPEED_OPTIONS } from '../../app/animation-settings'
import { BOARD_THEME_OPTIONS } from '../../app/board-theme'
import { cardAssetSlug, cardCatalogEntry, displayCardName } from '../../app/card-catalog'
import { CARD_VISUAL_STYLE_OPTIONS } from '../../app/card-visual-styles'
import { describeAdventureRelicChargeUses, displayGamePhase } from '../../app/game-presentation'
import {
  describeNextAdventureOpponent,
  hasSavedAdventureRun,
  isAdventureResumable,
  LOBBY_MODE_OPTIONS,
} from '../../app/lobby-presentation'
import { RENDER_QUALITY_PREFERENCE_OPTIONS } from '../../app/render-quality'
import { buildCounterHandOptions, type CounterHandOptions } from '../../app/response-options'
import {
  HIDDEN_HAND_CARD_NAME,
  type AdventureNodeSummary,
  type AdventureRelicSummary,
  type AdventureResultSummary,
  type AdventureRewardChoiceSummary,
  type AdventureRewardOfferSummary,
  type AdventureTierSummary,
  type AdventureUiState,
  type AppViewModel,
  type GameUiState,
  type Mode,
} from '../../app/types'
import { isBasicLand, type BasicLand } from '../../game/types'
import { canPreviewCard } from '../card-preview'
import type { BoardHit, RendererCardIdentity, ThreeDragFeedback, ThreePeek } from './contracts'
import { renderThreeLog } from './interface-log'
import { escapeHtml, renderCardRules, renderCardTile, renderInstallControls, renderP2P } from './native-html'

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
  /** Narrow profile: compact top bar, fixed action dock and select→confirm. */
  readonly narrow?: boolean
  readonly selectedCardId?: string | null
  readonly selectedTargetId?: string | null
  readonly selectedDiscardId?: string | null
  readonly targetListOpen?: boolean
  readonly tutorialHidden?: boolean
  /** The hand card being dragged on the board, mirrored by the narrow dock prompt. */
  readonly dragFeedback?: ThreeDragFeedback | null
  /** The card a long press is peeking at, announced by the narrow dock prompt. */
  readonly peek?: BoardHit | null
}

export interface ThreeDockModel {
  readonly prompt: string
  readonly actions: string
  /**
   * The prompt only repeats what the status announcer speaks, so its own
   * live region stays off. Replay transport changes it on every playback tick.
   */
  readonly quiet?: boolean
}

export const EMPTY_THREE_DOCK: ThreeDockModel = Object.freeze({ prompt: '', actions: '' })

const TUTORIAL_FALLBACK_HINT = 'Keep playing to continue the tutorial.'

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

/** Adventure mode with no game or replay shows the route hub instead of the lobby. */
export function isThreeAdventureHub(view: AppViewModel): boolean {
  return view.mode === 'adventure-hvai' && view.game === null && !view.replay.active
}

export function threeSessionKey(view: AppViewModel): string {
  return JSON.stringify([view.mode, view.seed, !!view.game, view.replay.active, view.game?.isReplay, view.p2pStarted])
}

// Excludes settings/status and the growing log, but invalidates selections on
// changes to the actual decision (including a replay step, a same-phase play,
// or an Adventure route, attempt, pending-result or reward-offer change).
export function threeDecisionKey(view: AppViewModel): string {
  const game = view.game
  return JSON.stringify([threeSessionKey(view), view.replay.step, view.adventure.decisionKey, game && [
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
    id === 'card-visual-style-select'
      ? `<div class="three-settings__style"><label for="${id}">${label}<select id="${id}">${options.map((option) =>
        `<option value="${option.value}"${option.value === value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>
        <label class="three-settings__checkbox" for="monochrome-cards-checkbox"><input type="checkbox" id="monochrome-cards-checkbox"${view.monochromeCards ? ' checked' : ''}>Monochrome</label></div>`
      : `<label for="${id}">${label}<select id="${id}">${options.map((option) =>
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
  // Replay is refused while Adventure is open, so its control is not offered.
  const replayable = !view.replay.active && view.mode !== 'adventure-hvai'
  return `<section aria-label="Recording"><h3>Recording</h3><p>${meta
    ? escapeHtml(`Seed ${meta.seed} · Mode ${meta.mode} · AI ${meta.aiLevel} · Controllers ${meta.controllers.join('/')} · Completed ${meta.completed ? 'Yes' : 'No'}`)
    : 'No recording data.'}</p><p>Local save available: ${view.recording.hasLocalSave ? 'Yes' : 'No'}</p>
    <div class="three-actions">${button('save-recording-download', 'Download Save File', !view.recording.canSave)}
    ${button('save-recording-local', 'Save to Browser', !view.recording.canSave)}
    ${button('load-recording-local', 'Load from Browser', !view.recording.canLoadLocal)}
    ${button('load-recording-file', 'Load from File')}
    ${replayable ? button('replay-start', 'Start Replay', !view.recording.canSave) : ''}</div></section>`
}

function adventureSummary(view: AppViewModel): string {
  const adventure = view.adventure
  return `Adventure Tier ${adventure.currentTier}/${ADVENTURE_TIER_COUNT} · Chances ${adventure.remainingChances} · Win streak ${adventure.winStreak} · High score ${adventure.highScore}`
}

// In-game Adventure controls. A result that storage refused must be saved (or
// the run reset) before anything else, so Pause gives way to Retry.
function renderAdventureGameActions(view: AppViewModel): string {
  return (view.adventure.pendingCompletion
    ? button('adventure-retry-completion', 'Retry Saving Result')
    : button('pause-adventure', 'Pause Adventure'))
    + button('abandon-adventure', 'Reset Adventure Run')
}

// The narrow dock and the wide panel's header row have no room for the full
// labels, which stay as the accessible names.
function renderAdventurePendingActions(): string {
  return button('adventure-retry-completion', 'Retry', false, ' aria-label="Retry Saving Result"')
    + button('abandon-adventure', 'Reset', false, ' aria-label="Reset Adventure Run"')
}

function renderMenu(view: AppViewModel): string {
  const logControllers = view.recording.metadata?.controllers ?? view.controllers
  return modal('menu', 'Game Menu', `${view.mode === 'adventure-hvai' ? `<p>${escapeHtml(adventureSummary(view))}</p>` : ''}
    <div class="three-actions">${button('cards', 'Cards & keyboard controls', false, ' aria-haspopup="dialog"')}
    ${view.mode === 'adventure-hvai' && !view.replay.active
    ? renderAdventureGameActions(view)
    : button('back-to-lobby', view.mode === 'tutorial' ? 'Exit Tutorial' : 'Back to Lobby')
      + (view.mode === 'tutorial' || view.replay.active ? '' : button('rematch', 'Rematch'))}</div>
    ${renderThreeLog(view.game!, view.cardVisualStyle, logControllers, view.monochromeCards)}
    ${renderThreeSettings(view)}${renderInstallControls()}${renderRecorder(view)}${renderReplay(view)}`)
}

function renderThreeLobby(view: AppViewModel, ui: InterfaceUi): string {
  const page = ui.lobbyPage ?? 'root'
  const adventure = view.adventure
  const nextOpponent = describeNextAdventureOpponent(adventure)
  const root = `<nav class="three-lobby-modes" aria-label="Game modes">
    ${button('', 'Tutorial (Learn to Play)', false, ' data-mode="tutorial"')}
    ${LOBBY_MODE_OPTIONS.map(({ mode, label }) => button('', label, false, ` data-mode="${mode}"`)).join('')}
    ${isAdventureResumable(adventure) ? button('resume-adventure', 'Resume Adventure') : ''}</nav>
    <nav class="three-actions" aria-label="Lobby options">${button('lobby-settings', 'Settings')}${button('lobby-recording', 'Recording')}</nav>
    <section aria-label="Adventure"><h2>Adventure</h2>
      <p>High Score: ${adventure.highScore} · Status: ${escapeHtml(adventure.status)}</p>
      <p>Tier: ${adventure.currentTier}/${ADVENTURE_TIER_COUNT} · Chances: ${adventure.remainingChances} · Win Streak: ${adventure.winStreak}</p>
      <p>Total Rounds: ${adventure.totalRoundsPlayed} · Summons attempted (both players): ${adventure.totalCardsPlayed}</p>
      <p>Next Opponent: ${nextOpponent ? escapeHtml(nextOpponent) : 'N/A'}</p>
      ${adventure.relics.length > 0 ? `<p>Relics: ${escapeHtml(adventure.relics.map(relicLabel).join(', '))}</p>` : ''}
      ${adventure.pendingReward ? '<p>Reward waiting: resume the Adventure to choose or skip it.</p>' : ''}
      ${hasSavedAdventureRun(adventure) ? button('abandon-adventure', 'Reset Adventure Run') : ''}</section>
    ${renderInstallControls()}`
  return `<section class="panel three-lobby" data-lobby-page="${page}" aria-label="Game lobby">
    <header><p>Three.js tabletop</p><h1 tabindex="-1" data-lobby-heading>Urban Creatures${page === 'root' ? '' : page === 'settings' ? ' · Settings' : ' · Recording'}</h1>
      ${page === 'root' ? '<p>Urban-fantasy 2-player card game with local AI and optional P2P mode.</p>' : button('lobby-root', 'Back')}</header>
    ${view.status ? `<p>${escapeHtml(view.status)}</p>` : ''}
    ${page === 'root' ? root : page === 'settings' ? renderThreeSettings(view) : renderRecorder(view)}
  </section>`
}

function adventureLaneLabel(lane: AdventureNodeLane): string {
  switch (lane) {
    case 'left': return 'Left path'
    case 'right': return 'Right path'
    case 'center': return 'Center path'
    default: return 'Path'
  }
}

// Text and an icon carry each status, so the route never relies on color.
function adventureNodeStatusLabel(status: AdventureNodeStatus): { readonly icon: string; readonly text: string } {
  switch (status) {
    case 'completed': return { icon: '✓', text: 'Completed' }
    case 'current': return { icon: '▶', text: 'Current' }
    case 'available': return { icon: '◇', text: 'Available' }
    case 'bypassed': return { icon: '↷', text: 'Bypassed' }
    case 'locked': return { icon: '🔒', text: 'Locked' }
    default: return { icon: '•', text: 'Unavailable' }
  }
}

function adventureChancesText(chances: number): string {
  return `${chances} ${chances === 1 ? 'chance' : 'chances'}`
}

function relicChargesText(relic: AdventureRelicSummary): string | null {
  return relic.charges === null ? null : `${relic.charges} of ${relic.maxCharges ?? relic.charges} charges`
}

/** A relic's name with its charges, for one-line summaries. */
function relicLabel(relic: AdventureRelicSummary): string {
  const charges = relicChargesText(relic)
  return charges === null ? relic.name : `${relic.name} (${charges})`
}

// An empty inventory points to rewards only while a non-boss win can still earn one.
// It never says "yet": a charged relic that used its last charge also leaves it empty.
function renderAdventureRelics(adventure: AdventureUiState, resumable: boolean): string {
  if (adventure.relics.length === 0) {
    const canEarn = resumable && adventure.pendingReward === null && adventure.currentTier < ADVENTURE_TIER_COUNT
    return `<p class="three-adventure-relics-empty">Relics: none.${canEarn ? ' Win an encounter to earn a reward.' : ''}</p>`
  }
  return `<div class="three-adventure-relics"><h3>Relics</h3><ul>${adventure.relics.map((relic) => {
    const charges = relicChargesText(relic)
    return `<li data-relic-id="${escapeHtml(relic.id)}"><span><strong>${escapeHtml(relic.name)}</strong>${
      charges === null ? '' : ` · ${escapeHtml(charges)}`}</span>
      <span class="three-adventure-relic-rules">${escapeHtml(relic.rulesText)}</span></li>`
  }).join('')}</ul></div>`
}

// What taking the reward means for what the run already holds.
function adventureRewardContextText(choice: AdventureRewardChoiceSummary): string {
  const context = choice.context
  switch (context.kind) {
    case 'boon': return `Boon · Taken ${context.picks} of ${context.maxPicks} times this run`
    case 'unique-relic': return 'Relic · Lasts for the rest of the run'
    case 'charged-relic': return `Charged relic · Holding ${context.charges} of ${context.maxCharges} charges`
    default: return 'Reward'
  }
}

function renderAdventureRewardChoice(offer: AdventureRewardOfferSummary, choice: AdventureRewardChoiceSummary): string {
  const context = adventureRewardContextText(choice)
  const label = `Choose ${choice.name}`
  const attrs = ` data-offer-id="${escapeHtml(offer.offerId)}" data-reward-id="${escapeHtml(choice.id)}"`
    + ` aria-label="${escapeHtml(`${label}. ${choice.rulesText} ${context}.`)}"`
  return `<li class="three-adventure-reward-choice"><h3>${escapeHtml(choice.name)}</h3>
    <p>${escapeHtml(choice.rulesText)}</p>
    <p class="three-adventure-reward-context">${escapeHtml(context)}</p>
    ${button('adventure-reward-choose', label, false, attrs)}</li>`
}

// The pending offer: three Choose controls and a distinct Skip control.
function renderAdventureReward(offer: AdventureRewardOfferSummary): string {
  return `<section class="three-adventure-reward" aria-label="Reward">
    <h2 tabindex="-1" data-adventure-reward-heading>Choose a reward</h2>
    <p>Tier ${offer.sourceTier} cleared. Choose one reward or skip it, then pick your next encounter.</p>
    <ul class="three-adventure-reward-choices">${offer.choices.map((choice) => renderAdventureRewardChoice(offer, choice)).join('')}</ul>
    <div class="three-actions">${button('adventure-reward-skip', 'Skip reward', false, ` data-offer-id="${escapeHtml(offer.offerId)}"`)}</div>
  </section>`
}

function renderAdventureNode(adventure: AdventureUiState, node: AdventureNodeSummary): string {
  const status = adventureNodeStatusLabel(node.status)
  const lane = adventureLaneLabel(node.lane)
  const opponent = node.opponent.label
  const contents = `<span class="three-adventure-node-heading"><span class="three-adventure-node-icon" aria-hidden="true">${status.icon}</span>
    <span>${lane} · ${status.text}</span></span>
    <span class="three-adventure-node-opponent">${escapeHtml(opponent)}</span>
    ${node.boss ? '<span class="three-adventure-node-boss"><span aria-hidden="true">♛</span> Boss</span>' : ''}`
  const attrs = ` data-status="${node.status}" data-lane="${node.lane}"`
  // Only nodes the route rules can start are buttons: a fork's two choices,
  // a single-node tier, or a committed node waiting for its retry.
  if (node.status !== 'current' && node.status !== 'available') {
    return `<div class="three-adventure-node"${attrs}>${contents}</div>`
  }
  const action = node.status === 'available' ? 'Choose this path'
    : adventure.attemptOrdinal > 0 ? 'Retry encounter' : 'Start encounter'
  const name = `${action}: Tier ${node.tierIndex + 1} of ${ADVENTURE_TIER_COUNT}${node.boss ? ', boss' : ''}, ${lane.toLowerCase()}, ${opponent}. Status: ${status.text}.`
  return `<button type="button" class="three-adventure-node" data-action="adventure-node" data-node-id="${escapeHtml(node.id)}"${attrs}
    aria-label="${escapeHtml(name)}">${contents}<span class="three-adventure-node-action">${action}</span></button>`
}

function renderAdventureTier(adventure: AdventureUiState, tier: AdventureTierSummary): string {
  const tierNumber = tier.tierIndex + 1
  const resumable = adventure.status === 'active' || adventure.status === 'paused'
  const boss = tier.nodes.some((node) => node.boss)
  const current = resumable && tierNumber === adventure.currentTier
  const state = tier.nodes.some((node) => node.status === 'completed') ? 'cleared'
    : current ? 'current'
      : adventure.status === 'failed' && tierNumber === adventure.currentTier ? 'failed' : 'upcoming'
  const suffix = state === 'cleared' ? ' · Cleared' : state === 'current' ? ' · Current' : state === 'failed' ? ' · Run ended' : ''
  return `<li class="three-adventure-tier" data-tier="${tierNumber}" data-tier-state="${state}"${current ? ' aria-current="step"' : ''}>
    <h3${current ? ' tabindex="-1" data-adventure-current-tier' : ''}>Tier ${tierNumber} of ${ADVENTURE_TIER_COUNT}${boss ? ' · Boss' : ''}${suffix}</h3>
    <ul class="three-adventure-nodes" data-count="${tier.nodes.length}">${tier.nodes.map((node) =>
      `<li>${renderAdventureNode(adventure, node)}</li>`).join('')}</ul></li>`
}

// The relics that used a charge on this result, each with the charges left.
function adventureRelicUseDetail(result: AdventureResultSummary): string {
  const text = describeAdventureRelicChargeUses(result.relicsUsed)
  return text ? `${text} ` : ''
}

// Focus lands on the result heading, which reads its detail (chances left,
// relic use, what to do next) as its description.
const ADVENTURE_RESULT_DETAIL_ID = 'three-adventure-result-detail'

function renderAdventureResult(adventure: AdventureUiState): string {
  const result = adventure.lastResult
  if (!result) return ''
  const tier = result.tierIndex + 1
  const score = `Final score ${result.score ?? 0} · High score ${adventure.highScore}`
  let heading: string
  let detail: string
  if (adventure.status === 'completed') {
    heading = `Adventure complete: Tier ${tier} boss defeated`
    detail = score
  } else if (adventure.status === 'failed') {
    heading = `Adventure over: defeated at Tier ${tier}`
    detail = score
  } else {
    switch (result.outcome) {
      case 'win':
        heading = `Victory at Tier ${tier}`
        detail = adventure.pendingReward
          ? `Choose a reward or skip it to continue to Tier ${adventure.currentTier}.`
          : `Choose your Tier ${adventure.currentTier} encounter.`
        break
      case 'loss':
        heading = `Defeat at Tier ${tier}`
        detail = `${adventureRelicUseDetail(result)}${adventureChancesText(adventure.remainingChances)} left. Retry the same encounter.`
        break
      case 'draw':
        heading = `Draw at Tier ${tier}`
        detail = 'No chance was used. Retry the same encounter.'
        break
      default:
        heading = `Tier ${tier} encounter finished`
        detail = 'Continue from the Adventure map.'
        break
    }
  }
  return `<section class="three-adventure-result" data-outcome="${escapeHtml(result.outcome)}" aria-label="Encounter result">
    <h2 tabindex="-1" data-adventure-result-heading aria-describedby="${ADVENTURE_RESULT_DETAIL_ID}">${escapeHtml(heading)}</h2>
    <p>Opponent: ${escapeHtml(result.opponentLabel)}</p><p id="${ADVENTURE_RESULT_DETAIL_ID}">${escapeHtml(detail)}</p></section>`
}

/**
 * The Adventure hub: progress with relics, then either the pending reward
 * panel or the seven-tier route and its node choices, and Pause/Reset (or,
 * once the run ends, a new run and the lobby). Settings and Recording reuse
 * the lobby sub-pages.
 */
function renderThreeAdventureHub(view: AppViewModel, ui: InterfaceUi): string {
  const page = ui.lobbyPage ?? 'root'
  const adventure = view.adventure
  const resumable = adventure.status === 'active' || adventure.status === 'paused'
  const nextOpponent = describeNextAdventureOpponent(adventure)
  const stats: ReadonlyArray<readonly [string, string]> = [
    ['Tier', `${adventure.currentTier} / ${ADVENTURE_TIER_COUNT}`],
    ['Chances', String(adventure.remainingChances)],
    ['Win streak', String(adventure.winStreak)],
    ['Rounds played', String(adventure.totalRoundsPlayed)],
    ['Summons attempted (both players)', String(adventure.totalCardsPlayed)],
    ['High score', String(adventure.highScore)],
  ]
  const root = `${renderAdventureResult(adventure)}
    <section class="three-adventure-progress" aria-label="Adventure progress">
      <dl class="three-adventure-stats">${stats.map(([label, value]) =>
        `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      ${nextOpponent ? `<p>Next opponent: ${escapeHtml(nextOpponent)}</p>` : ''}
      ${renderAdventureRelics(adventure, resumable)}
    </section>
    ${adventure.pendingReward ? renderAdventureReward(adventure.pendingReward)
    : `<section class="three-adventure-map" aria-label="Adventure route"><h2>Route</h2>
      <ol class="three-adventure-route">${adventure.tiers.map((tier) => renderAdventureTier(adventure, tier)).join('')}</ol>
    </section>`}
    <nav class="three-actions" aria-label="Adventure actions">${resumable
      ? button('pause-adventure', 'Pause Adventure') + button('abandon-adventure', 'Reset Adventure Run')
      : button('start-new-adventure', 'Start New Adventure') + button('back-to-lobby', 'Back to Lobby')}</nav>
    <nav class="three-actions" aria-label="Adventure options">${button('lobby-settings', 'Settings')}${button('lobby-recording', 'Recording')}</nav>`
  return `<section class="panel three-adventure-hub" data-lobby-page="${page}" aria-label="Adventure map">
    <header><p>Adventure</p><h1 tabindex="-1" data-lobby-heading>Adventure Map${page === 'root' ? '' : page === 'settings' ? ' · Settings' : ' · Recording'}</h1>
      ${page === 'root' ? '' : button('lobby-root', 'Back')}</header>
    ${view.status ? `<p>${escapeHtml(view.status)}</p>` : ''}
    ${page === 'root' ? root : page === 'settings' ? renderThreeSettings(view) : renderRecorder(view)}
  </section>`
}

function renderTargets(view: AppViewModel, ui: InterfaceUi, target: TargetModel): string {
  if (ui.phaseDismissed && !ui.pendingCardId) {
    // The narrow dock offers its own Choose Target action.
    return ui.narrow ? '' : `<section aria-label="Pending target selection"><p>${escapeHtml(target.title)}</p>${button('resume-target', 'Choose Target')}</section>`
  }
  // Narrow boards are targeted directly; the list opens only on request.
  if (target.battlefield && ui.narrow && !ui.targetListOpen) return ''
  const options = `<div class="three-targets" data-scroll-key="targets">${target.options.map((option) =>
    `<button type="button" data-action="target"${option.effectTargetId === undefined ? '' : ` data-target-id="${escapeHtml(option.effectTargetId)}"`}>${renderCardTile({
      name: option.cardName,
      displayName: option.displayName,
      ...(option.serializedKey ? { serializedKey: option.serializedKey } : {}),
      ...(option.assetSlug ? { assetSlug: option.assetSlug } : {}),
    }, view.cardVisualStyle, view.monochromeCards)}<span>${escapeHtml(option.label)}</span></button>`,
  ).join('') || '<p>No legal targets available.</p>'}</div>`
  const close = button('close', ui.pendingCardId ? 'Cancel Target Selection' : 'Close Target Selection')
  return target.battlefield
    ? `<section class="three-target-panel" role="region" aria-label="${escapeHtml(target.title)}"><h3>${escapeHtml(target.title)}</h3>
      <p>Select a highlighted creature on the board, or use a target button below.</p>${options}${ui.narrow
        ? `<div class="three-actions">${button('target-list-hide', 'Back to Board')}${close}</div>` : close}</section>`
    : modal('target', target.title, options)
}

function renderNativeCards(view: AppViewModel, ui: InterfaceUi, blocked: boolean, response: CounterHandOptions | null): string {
  const game = view.game!
  const previewAllowed = canPreviewCard({ phase: game.phase, pendingPlayLandTargetSelection: !!ui.pendingCardId, menuOpen: blocked })
  const responseChoices = new Map(response?.choices.map((choice) => [choice.cardId, choice]) ?? [])
  const owners = ui.presentedActor === 1 ? [1, 0] : [0, 1]
  return modal('cards', 'Cards & keyboard controls',
    `<p>Summon, intercept, or preview using the hand-card controls, or interact with the 3D board. Read creature abilities and inspect each player's discard pile below.</p>
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
                : '<span>Not available for Intercept</span>'}${renderCardRules(presentation)}</div>`
          }
          return `<div class="three-native-card"><span>${escapeHtml(displayName)}</span>
            ${button('play', `Summon ${displayName}`, !playable, ` data-card-id="${escapeHtml(card.id)}"`)}
            ${button('preview', `Preview ${displayName}`, !previewAllowed || responding, ` data-zone="hand" data-owner="${owner}" data-card-id="${escapeHtml(card.id)}"`)}${renderCardRules(presentation)}</div>`
        }).join('') || '<p>No cards in hand.</p>'}</div>
        <h4>Board</h4><div class="three-native-cards" data-scroll-key="battlefield-${owner}">${player.battlefield.map((card) => {
          const presentation = cardPresentation(card)!
          return `<div class="three-native-card"><span>${escapeHtml(presentation.displayName)}</span>${button(
            'preview',
            `Preview ${presentation.displayName}`,
            !previewAllowed,
            ` data-zone="battlefield" data-owner="${owner}" data-card-id="${escapeHtml(card.cardId)}" data-instance-id="${escapeHtml(card.instanceId)}"`,
          )}${renderCardRules(presentation)}</div>`
        }).join('') || '<p>No creatures on the board.</p>'}</div>
        <section aria-label="Player ${owner + 1} discard pile"><h4>Discard pile</h4>
          <div class="three-native-cards" data-scroll-key="discard-${owner}">${player.graveyardCards.map((card) => {
            const presentation = cardPresentation(card)
            return presentation
              ? `<div class="three-native-card">${renderCardTile(presentation, view.cardVisualStyle, view.monochromeCards)}${renderCardRules(presentation)}</div>`
              : ''
          }).join('') || '<p>Discard pile empty.</p>'}</div></section></section>`
    }).join('')}`,
    'cards-back', 'Back to Game Menu')
}

export function renderThreeHud(view: AppViewModel, ui: InterfaceUi): string {
  if (!isThreeInGame(view)) return ''
  const game = view.game!
  if (ui.narrow) {
    // One fixed-height bar: decisions live in the dock, extras in the menu.
    return `<section class="three-hud" data-layout="narrow" aria-label="Game controls">
      ${button('menu', '☰', false, ` aria-label="Menu" aria-haspopup="dialog" aria-expanded="${ui.menuOpen}"`)}
      <h2>Turn ${game.turn} · ${escapeHtml(displayGamePhase(game.phase))} <span>· Player ${game.actor + 1}</span></h2>
      <p>${escapeHtml(view.status)}</p>
      ${view.tutorial.active && ui.tutorialHidden ? button('tutorial-show', 'Hint', false, ' aria-label="Show tutorial hint"') : ''}</section>`
  }
  const targets = threeTargets(view, ui)
  // This panel is a fixed-height row that scrolls, so a refused result's
  // Retry and Reset sit beside Menu instead of below the fold.
  const pendingActions = view.mode === 'adventure-hvai' && view.adventure.pendingCompletion
    && !view.replay.active && !ui.menuOpen ? renderAdventurePendingActions() : ''
  return `<section class="three-hud" aria-label="Game controls">
    <header class="three-header">${button('menu', '☰ Menu', false, ` aria-haspopup="dialog" aria-expanded="${ui.menuOpen}"`)}${pendingActions}
      <h2>Turn ${game.turn} · ${escapeHtml(displayGamePhase(game.phase))}</h2><span>Player ${game.actor + 1}</span></header>
    <p>${escapeHtml(view.status)}</p>
    ${game.winnerText ? `<p class="three-winner">${escapeHtml(game.winnerText)}</p>` : ''}
    ${view.tutorial.active ? `<aside class="three-tutorial" aria-label="Tutorial hint">${escapeHtml(view.tutorial.hint ?? TUTORIAL_FALLBACK_HINT)}</aside>` : ''}
    ${view.mode === 'adventure-hvai' ? `<p>${escapeHtml(adventureSummary(view))}</p>` : ''}
    ${!game.canInput && !view.replay.active && game.phase !== 'gameOver' ? '<p>Waiting for the other player.</p>' : ''}
    ${targets && !ui.menuOpen && !ui.preview ? `<p class="three-required-prompt">${escapeHtml(targets.title)}</p>` : ''}
    ${ui.menuOpen ? '' : renderReplay(view)}</section>`
}

export function renderThreeHover(view: AppViewModel, hit: BoardHit | null): string {
  const card = view.game && hit ? threePreviewCard(view.game, hit) : null
  return card ? `<aside class="three-hover-preview" aria-hidden="true">${renderCardTile(card, view.cardVisualStyle, view.monochromeCards)}</aside>` : ''
}

const px = (value: number): string => `${Math.round(value)}px`

/**
 * The long-press peek: the hover preview's card with the same rules as
 * Details, at the board's `peekPlacement` (client pixels). Like hover it is
 * decorative; the dock prompt announces the card and Details stays the
 * keyboard and screen-reader path.
 */
export function renderThreePeek(view: AppViewModel, peek: ThreePeek | null): string {
  const card = view.game && peek ? threePreviewCard(view.game, peek.hit) : null
  if (!card || !peek) return ''
  const { left, width, y, maxHeight, side } = peek.placement
  if (![left, width, y, maxHeight].every(Number.isFinite) || width <= 0 || maxHeight <= 0) return ''
  const style = `left:${px(left)};top:${px(y)};width:${px(width)};max-height:${px(maxHeight)};--three-peek-max-height:${px(maxHeight)}`
  return `<aside class="three-hover-preview three-peek" aria-hidden="true" data-side="${side === 'above' ? 'above' : 'below'}" style="${style}">${
    renderCardTile(card, view.cardVisualStyle, view.monochromeCards)}<div class="three-peek-copy">${renderCardRules(card)}<p class="three-peek-hint">Lift your finger to close.</p></div></aside>`
}

/** A card's name and primary ability, as the dock describes a selected or peeked card. */
function cardSummary(card: ThreeCardPresentation): string {
  const ability = card.serializedKey ? cardCatalogEntry(card.serializedKey).primaryAbility : null
  return `${card.displayName}${ability ? ` · ${ability.name}: ${ability.rulesText}` : ''}`
}

function pendingSummonName(game: GameUiState): string {
  return game.pendingLandDisplayName
    ?? (isBasicLand(game.pendingLandName) ? displayCardName(game.pendingLandName) : 'this creature')
}

/**
 * Narrow profile dock: one prompt plus the actions for the current decision.
 * The dock has a fixed height, so changing decisions never moves the board.
 * Buttons act on the interface's own selection, never on ids in the markup.
 * An open long-press peek replaces only the prompt, so it is announced once
 * while the actions stay put.
 */
export function renderThreeDock(view: AppViewModel, ui: InterfaceUi): ThreeDockModel {
  const dock = threeDockModel(view, ui)
  const peeked = view.game && ui.peek && isThreeInGame(view) ? threePreviewCard(view.game, ui.peek) : null
  return peeked ? { prompt: cardSummary(peeked), actions: dock.actions } : dock
}

function threeDockModel(view: AppViewModel, ui: InterfaceUi): ThreeDockModel {
  const game = view.game
  if (!game || !isThreeInGame(view)) return EMPTY_THREE_DOCK
  if (view.replay.active) {
    const { step, totalSteps, isPlaying } = view.replay
    return {
      prompt: `Replay · Step ${step}/${totalSteps} · ${isPlaying ? 'Playing' : 'Paused'}`,
      actions: button('replay-playpause', isPlaying ? 'Pause' : 'Play', false, ` aria-label="${isPlaying ? 'Pause Replay' : 'Play Replay'}"`)
        + button('replay-prev', 'Previous', step <= 0, ' aria-label="Previous Step"')
        + button('replay-next', 'Next', step >= totalSteps, ' aria-label="Next Step"')
        + button('replay-end', 'End', step >= totalSteps, ' aria-label="Jump to End"')
        + button('replay-exit', 'Exit', false, ' aria-label="Exit Replay"'),
      quiet: true,
    }
  }
  if (game.phase === 'gameOver') {
    if (view.mode === 'adventure-hvai') {
      // A committed result replaces the board with the map at once, so a
      // finished Adventure game only stays while storage refuses its result.
      const pending = view.adventure.pendingCompletion !== null
      const winner = game.winnerText || 'Game over.'
      return {
        // "Winner: Player 1" has no closing punctuation of its own.
        prompt: pending ? `${/[.!?]$/.test(winner) ? winner : `${winner}.`} The result is not saved yet.` : winner,
        actions: pending ? renderAdventurePendingActions() : '',
      }
    }
    return {
      prompt: game.winnerText || 'Game over.',
      actions: (view.recording.canSave ? button('replay-start', 'Replay', false, ' aria-label="Start Replay"') : '')
        + (view.mode === 'tutorial' ? button('back-to-lobby', 'Exit Tutorial')
          : button('rematch', 'Rematch') + button('back-to-lobby', 'Lobby', false, ' aria-label="Back to Lobby"')),
    }
  }
  const targets = ui.menuOpen || ui.cardsOpen || ui.preview ? null : threeTargets(view, ui)
  if (targets) {
    if (ui.phaseDismissed && !ui.pendingCardId) {
      return { prompt: targets.title, actions: button('resume-target', 'Choose Target') }
    }
    // Card choices (discard pile or hand) use their own modal picker.
    if (!targets.battlefield) return { prompt: targets.title, actions: '' }
    const selected = targets.options.find((option) =>
      option.effectTargetId !== undefined && option.effectTargetId === ui.selectedTargetId)
    const cancel = ui.pendingCardId ? 'Cancel' : 'Close'
    return {
      prompt: selected
        ? `${targets.title} Selected: ${selected.displayName}.`
        : `${targets.title} Select a highlighted creature, or open Targets.`,
      actions: (selected
        ? button('confirm-target', 'Confirm', false, ` aria-label="${escapeHtml(`Confirm target: ${selected.displayName}`)}"`)
        : '')
        + button('target-list', 'Targets', false, ` aria-expanded="${ui.targetListOpen === true}"`)
        + button('close', cancel, false, ` aria-label="${cancel} Target Selection"`),
    }
  }
  const response = threeResponse(view, ui)
  if (response) {
    const pending = pendingSummonName(game)
    if (!response.choices.length) {
      return { prompt: `No legal card combination can intercept the summon of ${pending}. Choose ${response.passLabel}.`, actions: '' }
    }
    const verb = cardCatalogEntry('Island').responseAbility?.name ?? 'Intercept'
    const selected = response.choices.find((choice) => choice.cardId === ui.selectedDiscardId)
    if (selected) {
      return {
        prompt: `${verb} ${pending} by discarding ${response.requiredCardDisplayName} and ${selected.displayName}?`,
        actions: button('confirm-response', verb, false,
          ` aria-label="${escapeHtml(`${verb}: discard ${response.requiredCardDisplayName} and ${selected.displayName}`)}"`)
          + button('select-clear', 'Clear', false, ' aria-label="Clear selection"'),
      }
    }
    return {
      prompt: `${verb} the summon of ${pending}? Select a pink-framed card to discard with ${response.requiredCardDisplayName}, or choose ${response.passLabel}.`,
      actions: '',
    }
  }
  if (!game.canInput) return { prompt: 'Waiting for the other player.', actions: '' }
  // The presented player can lag the actor while effects finish playing.
  if (!canThreeInput(view, ui.presentedActor) || game.phase !== 'main') return EMPTY_THREE_DOCK
  // A drag only replaces the prompt, so the dock's actions and height stay put.
  const dragPrompt = ui.menuOpen || ui.cardsOpen || ui.preview ? null : threeDragPrompt(game, ui.dragFeedback)
  const card = ui.selectedCardId
    ? game.players[game.actor].handCards.find((entry) => entry.id === ui.selectedCardId)
    : undefined
  const presentation = cardPresentation(card)
  if (card && presentation) {
    const name = presentation.displayName
    const playable = (game.legal.playLandByCard[card.id]?.length ?? 0) > 0
    return {
      prompt: dragPrompt ?? `${cardSummary(presentation)}${playable ? '' : ' Cannot be summoned now.'}`,
      actions: button('select-summon', 'Summon', !playable || ui.menuOpen || ui.cardsOpen || !!ui.preview || !!ui.pendingCardId,
        ` aria-label="${escapeHtml(`Summon ${name}`)}"`)
        + button('select-details', 'Details', false, ` aria-label="${escapeHtml(`Details for ${name}`)}"`)
        + button('select-clear', 'Clear', false, ' aria-label="Clear selection"'),
    }
  }
  const playable = Object.values(game.legal.playLandByCard).some((options) => options.length > 0)
  return {
    prompt: dragPrompt ?? (playable
      ? 'Drag a highlighted creature onto your board, or select a card for options.'
      : `No creature can be summoned now. Select a card for details${game.legal.canEndTurn ? ', or choose End Turn' : ''}.`),
    actions: '',
  }
}

/**
 * The dock prompt for a live drag, named from the catalog. Null unless the
 * dragged card is still a summonable card in the actor's hand, so stale
 * feedback can never describe another decision.
 */
function threeDragPrompt(game: GameUiState, feedback: ThreeDragFeedback | null | undefined): string | null {
  if (!feedback) return null
  const card = game.players[game.actor]?.handCards.find((entry) => entry.id === feedback.cardId)
  const presentation = cardPresentation(card)
  if (!card || !presentation || !(game.legal.playLandByCard[card.id]?.length)) return null
  const name = presentation.displayName
  return feedback.accepted
    ? `Release to summon ${name}. Drag back to your hand to cancel.`
    : `Summon ${name}: release anywhere on your board. Drag back to your hand to cancel.`
}

function renderTutorialBanner(view: AppViewModel, ui: InterfaceUi): string {
  if (!view.tutorial.active || ui.tutorialHidden) return ''
  return `<aside class="three-tutorial-banner" aria-label="Tutorial hint"><p>${escapeHtml(view.tutorial.hint ?? TUTORIAL_FALLBACK_HINT)}</p>${
    button('tutorial-dismiss', 'Hide', false, ' aria-label="Hide tutorial hint"')}</aside>`
}

export function renderThreeInterface(view: AppViewModel, ui: InterfaceUi, includeHud = true): string {
  if (!isThreeInGame(view)) {
    if (isThreeAdventureHub(view)) return renderThreeAdventureHub(view, ui)
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
    ${ui.narrow ? renderTutorialBanner(view, ui) : ''}
    ${targets && !ui.menuOpen && !ui.cardsOpen && !ui.preview ? renderTargets(view, ui, targets) : ''}
    ${ui.menuOpen ? renderMenu(view) : ''}
    ${ui.cardsOpen ? renderNativeCards(view, ui, nativeBlocked, response) : ''}
    ${previewCard ? modal('preview', `${previewCard.displayName} card preview`, renderCardTile(previewCard, view.cardVisualStyle, view.monochromeCards) + renderCardRules(previewCard),
    'close', ui.previewReturnToCards ? 'Back to Cards' : 'Close') : ''}
    </section>`
}
