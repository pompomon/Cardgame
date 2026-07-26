import type { ControllerApi } from '../app/controller'
import {
  groupCardTargetOptions,
  HIDDEN_HAND_DISPLAY_NAME,
  resolvePlainsReuseAction,
  resolvePlainsReuseTargetSelectionMode,
  resolvePlayLandDrop,
  resolvePlayLandTargetSelectionMode,
  resolveTargetedPlayLandAction,
} from '../app/action-resolution'
import { isAiLevel } from '../app/ai-levels'
import { isAnimationSpeed } from '../app/animation-settings'
import { isCardVisualStyle } from '../app/card-visual-styles'
import { promptInstall } from '../app/install-support'
import type { AppViewModel, GameUiState, Mode, PlayLandOption, PlayerUiState } from '../app/types'
import { HIDDEN_HAND_CARD_NAME } from '../app/types'
import { isBasicLand, type GameAction } from '../game/types'
import type { AppRenderer } from './types'
import {
  escapeHtml,
  noteRasterCardArtLoadFailure,
  renderCardTile,
  renderInstallControls,
  renderLandIcon,
  renderLobby,
  renderP2P,
  resetRasterCardArtLoadFailuresForTests,
} from './dom-utils'

export {
  escapeHtml,
  noteRasterCardArtLoadFailure,
  renderCardTile,
  renderLandIcon,
  renderLobby,
  resetRasterCardArtLoadFailuresForTests,
}

const BLOB_URL_REVOCATION_DELAY_MS = 1000
const DOM_LOG_VISIBLE_ENTRIES = 14

interface PendingPlayLandTargetSelection {
  readonly cardId: string
}

function renderActionIcon(cardName: string | null, style: AppViewModel['cardVisualStyle']): string {
  return cardName && isBasicLand(cardName) ? renderLandIcon(cardName, style, 18, 'action-icon', { forceProcedural: true }) : ''
}

function renderPlayLandButton(option: PlayLandOption, cardName: string, style: AppViewModel['cardVisualStyle']): string {
  const targetAttr = option.action.effectTargetId
    ? ` data-target-id="${escapeHtml(option.action.effectTargetId)}"`
    : ''
  return `<button data-action="play_land" data-card-id="${escapeHtml(option.action.cardId)}"${targetAttr}>${renderActionIcon(cardName, style)}${escapeHtml(option.label)}</button>`
}

function renderHandCard(card: PlayerUiState['handCards'][number], game: GameUiState, style: AppViewModel['cardVisualStyle'], isActiveHand: boolean): string {
  const options = game.legal.playLandByCard[card.id] ?? []
  const playable = isActiveHand && game.canInput && game.phase === 'main' && options.length > 0
  const draggable = playable ? 'true' : 'false'
  const cardStateClass = playable ? ' dom-card-shell--playable' : ' dom-card-shell--disabled'
  const actionButtons = playable
    ? `<div class="dom-card-shell__actions">${options.map((option) => renderPlayLandButton(option, card.name, style)).join('')}</div>`
    : ''
  const dragHandleLabel = playable
    ? `Drag or play ${escapeHtml(card.name)}`
    : card.name === HIDDEN_HAND_CARD_NAME
      ? HIDDEN_HAND_DISPLAY_NAME
      : `${escapeHtml(card.name)} card`
  return `
    <article class="dom-card-shell${cardStateClass}" data-card-id="${escapeHtml(card.id)}">
      <div class="dom-card-drag" draggable="${draggable}" data-draggable-card="${escapeHtml(card.id)}" role="button" tabindex="${playable ? '0' : '-1'}" aria-label="${dragHandleLabel}" aria-disabled="${playable ? 'false' : 'true'}">
        ${renderCardTile(card.name, style)}
      </div>
      ${actionButtons}
    </article>
  `
  const tutorialHint = view.tutorial.active && view.tutorial.hint
    ? `<aside class="dom-tutorial-hint" role="status" aria-live="polite">${escapeHtml(view.tutorial.hint)}</aside>`
    : ''
}

function optionTargetIds(options: Array<{ effectTargetId?: string }>): Set<string> {
  const ids = new Set<string>()
  for (const option of options) {
    if (option.effectTargetId) {
      ids.add(option.effectTargetId)
    }
  }
  return ids
}

function playLandTargetIds(game: GameUiState, pending: PendingPlayLandTargetSelection | null): Set<string> {
  if (!pending) {
    return new Set()
  }
  const resolution = resolvePlayLandDrop(game, pending.cardId)
  return resolution.kind === 'needs_target' ? optionTargetIds(resolution.options) : new Set()
}

function plainsReuseTargetIds(game: GameUiState): Set<string> {
  return optionTargetIds(game.legal.plainsReuseOptions.map((option) => option.action))
}

function renderBattlefieldCard(
  entry: PlayerUiState['battlefield'][number],
  style: AppViewModel['cardVisualStyle'],
  playableTargetIds: Set<string>,
  targetAction: 'play_land_target' | 'plains_reuse_target',
): string {
  const isTarget = playableTargetIds.has(entry.instanceId)
  const targetButton = isTarget
    ? `<button class="dom-target-hotspot" data-action="${targetAction}" data-target-id="${escapeHtml(entry.instanceId)}" aria-label="Choose ${escapeHtml(entry.name)} as target">Choose target</button>`
    : ''
  return `<div class="dom-battlefield-card ${isTarget ? 'dom-battlefield-card--target' : ''}" data-battlefield-card-id="${escapeHtml(entry.instanceId)}">${renderCardTile(entry.name, style)}${targetButton}</div>`
}

function renderPlayerSummary(player: PlayerUiState, playerIndex: number, controller: string, kind: 'active' | 'non-active'): string {
  return `
    <article class="player player-${kind} dom-player-summary" aria-label="Player ${playerIndex + 1} summary">
      <h3>Player ${playerIndex + 1} (${escapeHtml(controller)})${kind === 'active' ? ' — Active' : ''}</h3>
      <p>Hand: ${player.handCount} • Deck: ${player.deckCount} • Graveyard: ${player.graveyardCount}</p>
    </article>
  `
}

function renderBattlefield(
  player: PlayerUiState,
  playerIndex: number,
  kind: 'active' | 'non-active',
  view: AppViewModel,
  targetIds: Set<string>,
  targetAction: 'play_land_target' | 'plains_reuse_target',
): string {
  const isActiveDropZone = kind === 'active' && view.game?.canInput && view.game.phase === 'main'
  return `
    <article class="battlefield battlefield-${kind} dom-battlefield ${isActiveDropZone ? 'dom-drop-zone' : ''}" ${isActiveDropZone ? 'data-drop-zone="play-land" tabindex="0" aria-label="Drop playable card on your battlefield"' : ''}>
      <div class="dom-section-heading">
        <h4>Player ${playerIndex + 1} Battlefield</h4>
        ${kind === 'active' ? '<span class="dom-pill">Active side</span>' : ''}
      </div>
      <div class="card-tile-row dom-battlefield-row">
        ${player.battlefield.length > 0 ? player.battlefield.map((entry) => renderBattlefieldCard(entry, view.cardVisualStyle, targetIds, targetAction)).join('') : '<span class="dom-empty">None</span>'}
      </div>
    </article>
  `
}

function renderMainActionTray(game: GameUiState, activeState: PlayerUiState, view: AppViewModel): string {
  if (!game.canInput || game.phase !== 'main') {
    return ''
  }
  const playButtons = activeState.handCards.map((card) => {
    const options = game.legal.playLandByCard[card.id]
    if (!options || options.length === 0) {
      return ''
    }
    return options.map((option) => renderPlayLandButton(option, card.name, view.cardVisualStyle)).join('')
  }).join('')

  return `
    <div class="controls dom-action-tray" aria-label="Primary actions">
      <h3>Main Phase</h3>
      <div class="action-row">${playButtons}</div>
      ${game.legal.canEndTurn ? '<button data-action="end_turn">End Turn</button>' : ''}
    </div>
  `
}

function renderResponseControls(game: GameUiState, view: AppViewModel): string {
  if (!game.canInput || game.phase !== 'respond') {
    return ''
  }
  return `
    <div class="controls dom-action-tray" aria-label="Response actions">
      <h3>Response Window</h3>
      <p>Opponent played ${escapeHtml(game.pendingLandName ?? 'a land')}. Respond?</p>
      <div class="action-row">
        ${game.legal.counterOptions.map((option) => {
          const discardAttr = option.action.discardCardId
            ? ` data-discard-card-id="${escapeHtml(option.action.discardCardId)}"`
            : ''
          return `<button data-action="counter_land"${discardAttr}>${renderLandIcon('Island', view.cardVisualStyle, 18, 'action-icon', { forceProcedural: true })}${escapeHtml(option.label)}</button>`
        }).join('')}
        ${game.legal.canPassResponse ? '<button data-action="pass_response">Pass</button>' : ''}
      </div>
    </div>
  `
}

function renderPlainsReuseControls(game: GameUiState, view: AppViewModel): string {
  if (!game.canInput || game.phase !== 'plains_target') {
    return ''
  }
  const mode = resolvePlainsReuseTargetSelectionMode(game)
  if (mode === 'popup_cards' && game.legal.plainsReuseOptions.length > 1) {
    const grouped = groupCardTargetOptions(game, { kind: 'plains_reuse' }, game.legal.plainsReuseOptions.map((option) => ({ effectTargetId: option.action.effectTargetId, label: option.label })))
    return renderTargetSheet('Choose Plains reuse target', grouped.map((option) => ({ ...option, action: 'plains_reuse_target' as const })), view.cardVisualStyle, false)
  }
  return `
    <div class="controls dom-action-tray" aria-label="Plains reuse targets">
      <h3>Plains Reuse</h3>
      <p>Choose target for reused ${escapeHtml(game.pendingPlainsReuseName ?? 'land')}.</p>
      <div class="action-row">
        ${game.legal.plainsReuseOptions.map((option) => {
          const targetAttr = option.action.effectTargetId
            ? ` data-target-id="${escapeHtml(option.action.effectTargetId)}"`
            : ''
          return `<button data-action="resolve_plains_reuse"${targetAttr}>${renderActionIcon(game.pendingPlainsReuseName, view.cardVisualStyle)}${escapeHtml(option.label)}</button>`
        }).join('')}
      </div>
    </div>
  `
}

function renderTargetSheet(
  title: string,
  options: Array<{ effectTargetId?: string; label: string; cardName: string; action: 'play_land_target' | 'plains_reuse_target' }>,
  style: AppViewModel['cardVisualStyle'],
  cancellable: boolean,
): string {
  return `
    <section class="dom-target-sheet" role="dialog" aria-modal="false" aria-label="${escapeHtml(title)}">
      <div class="dom-target-sheet__grabber" aria-hidden="true"></div>
      <h3>${escapeHtml(title)}</h3>
      <div class="dom-target-grid">
        ${options.map((option) => {
          const targetAttr = option.effectTargetId ? ` data-target-id="${escapeHtml(option.effectTargetId)}"` : ''
          return `<button class="dom-target-card" data-action="${option.action}"${targetAttr}>${renderCardTile(option.cardName, style)}<span>${escapeHtml(option.label)}</span></button>`
        }).join('')}
      </div>
      ${cancellable ? '<button data-action="cancel-target-picker">Cancel</button>' : ''}
    </section>
  `
}

function renderPendingPlayLandTargetPicker(game: GameUiState, pending: PendingPlayLandTargetSelection | null, view: AppViewModel): string {
  if (!pending) {
    return ''
  }
  const resolution = resolvePlayLandDrop(game, pending.cardId)
  if (resolution.kind !== 'needs_target') {
    return ''
  }
  const mode = resolvePlayLandTargetSelectionMode(game, pending.cardId)
  if (mode === 'battlefield_highlight') {
    return '<p class="dom-target-hint" role="status">Choose a highlighted battlefield target.</p>'
  }
  const grouped = groupCardTargetOptions(game, { kind: 'play_land', cardId: pending.cardId }, resolution.options)
  return renderTargetSheet('Choose card target', grouped.map((option) => ({ ...option, action: 'play_land_target' as const })), view.cardVisualStyle, true)
}

function renderLogDrawer(game: GameUiState): string {
  return `
    <details class="log dom-log-drawer">
      <summary>Replay Log</summary>
      <ul>${game.log.slice(-DOM_LOG_VISIBLE_ENTRIES).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    </details>
  `
}

export function renderGame(view: AppViewModel, menuOpen: boolean, pendingTargetSelection: PendingPlayLandTargetSelection | null = null): string {
  const game = view.game
  if (!game) {
    return ''
  }

  const [p1, p2] = game.players
  const activeIndex = game.actor
  const nonActiveIndex = activeIndex === 0 ? 1 : 0
  const activeState = activeIndex === 0 ? p1 : p2
  const nonActiveState = nonActiveIndex === 0 ? p1 : p2
  const safeStatus = escapeHtml(view.status)
  const safeWinnerText = escapeHtml(game.winnerText)
  const playTargetIds = playLandTargetIds(game, pendingTargetSelection)
  const plainsTargetIds = game.phase === 'plains_target' && resolvePlainsReuseTargetSelectionMode(game) === 'battlefield_highlight'
    ? plainsReuseTargetIds(game)
    : new Set<string>()
  const battlefieldTargetIds = playTargetIds.size > 0 ? playTargetIds : plainsTargetIds
  const battlefieldTargetAction = playTargetIds.size > 0 ? 'play_land_target' : 'plains_reuse_target'
  const recordingMeta = view.recording.metadata
  const recordingMetaText = recordingMeta
    ? `Seed ${recordingMeta.seed} • Mode ${recordingMeta.mode} • AI ${recordingMeta.aiLevel} • Controllers ${recordingMeta.controllers[0]}/${recordingMeta.controllers[1]} • Completed ${recordingMeta.completed ? 'Yes' : 'No'}`
    : 'No recording data.'

  const menuPanel = `
    <div class="menu-panel dom-menu-panel" id="menu-panel"${menuOpen ? '' : ' hidden'}>
      ${menuOpen
        ? `<div class="menu-section">
            ${view.mode === 'adventure-hvai'
              ? `<button id="pause-adventure">Pause Adventure</button>
                 <button data-action="abandon-adventure">Reset Adventure Run</button>`
              : `<button id="back-to-lobby">${view.mode === 'tutorial' ? 'Exit Tutorial' : 'Back to Lobby'}</button>
                 ${view.mode === 'tutorial' ? '' : '<button id="rematch">Rematch</button>'}`}
          </div>
          <div class="menu-section">${renderInstallControls()}</div>
          <div class="menu-section">
            <h4>Recorder</h4>
            <p>${escapeHtml(recordingMetaText)}</p>
            <div class="action-row">
              <button id="save-recording-download">Download Save File</button>
              <button id="save-recording-local">Save to Browser</button>
              <button data-action="load-recording-local">Load from Browser</button>
              <button data-action="load-recording-file">Load from File</button>
              ${view.replay.active ? '' : '<button id="replay-start">Start Replay</button>'}
            </div>
            <input data-role="load-recording-file-input" type="file" accept="application/json,.json" hidden />
          </div>
          ${view.replay.active
            ? `<div class="menu-section">
                <h4>Replay Controls</h4>
                <p>Step ${view.replay.step}/${view.replay.totalSteps} • ${view.replay.isPlaying ? 'Playing' : 'Paused'}</p>
                <div class="action-row">
                  <button id="replay-playpause">${view.replay.isPlaying ? 'Pause' : 'Play'}</button>
                  <button id="replay-prev">Previous</button>
                  <button id="replay-next">Next</button>
                  <button id="replay-end">Jump to End</button>
                  <button id="replay-exit">Exit Replay</button>
                </div>
              </div>`
            : ''}`
        : ''}
    </div>
  `

  return `
    <section class="panel game-scene dom-cardgame dom-game" data-dom-layout="mobile-first" data-animation-speed="${view.animationSpeed}">
      <div class="game-header dom-game__header">
        <button id="menu-toggle" class="menu-toggle" aria-expanded="${menuOpen ? 'true' : 'false'}" aria-controls="menu-panel" aria-label="Menu">☰ Menu</button>
        <h2>Turn ${game.turn} • Phase: ${game.phase}</h2>
      </div>
      ${menuPanel}
      <p class="status dom-status" role="status" aria-live="polite">${safeStatus}</p>
      ${safeWinnerText ? `<p class="winner">${safeWinnerText}</p>` : ''}
      <div class="battlefield-layout dom-game__layout">
        <div class="board dom-board">
          <section class="dom-board__opponent">
            ${renderPlayerSummary(nonActiveState, nonActiveIndex, view.controllers[nonActiveIndex], 'non-active')}
            ${renderBattlefield(nonActiveState, nonActiveIndex, 'non-active', view, battlefieldTargetIds, battlefieldTargetAction)}
          </section>
          <section class="dom-board__middle">
            ${renderBattlefield(activeState, activeIndex, 'active', view, battlefieldTargetIds, battlefieldTargetAction)}
          </section>
          <section class="dom-board__hand" aria-label="Active hand">
            ${renderPlayerSummary(activeState, activeIndex, view.controllers[activeIndex], 'active')}
            <div class="card-tile-row dom-hand-row">${activeState.handCards.length > 0 ? activeState.handCards.map((card) => renderHandCard(card, game, view.cardVisualStyle, true)).join('') : '<span class="dom-empty">No cards</span>'}</div>
          </section>
        </div>
        ${renderLogDrawer(game)}
      </div>
      ${tutorialHint}
      ${renderMainActionTray(game, activeState, view)}
      ${renderResponseControls(game, view)}
      ${renderPlainsReuseControls(game, view)}
      ${renderPendingPlayLandTargetPicker(game, pendingTargetSelection, view)}
    </section>
  `
}

export class DomRenderer implements AppRenderer {
  private container: HTMLElement | null = null
  private controller: ControllerApi | null = null
  private view: AppViewModel | null = null
  private hostAnswerDraft = ''
  private joinOfferDraft = ''
  private menuOpen = false
  private pendingTargetSelection: PendingPlayLandTargetSelection | null = null
  private draggedCardId: string | null = null
  private containerListenersBound = false

  mount(container: HTMLElement, controller: ControllerApi): void {
    this.container = container
    this.controller = controller
  }

  render(view: AppViewModel): void {
    this.view = view
    if (!this.container || !this.controller) {
      return
    }

    const hostAnswerField = this.container.querySelector<HTMLTextAreaElement>('#answer-text')
    if (hostAnswerField) {
      this.hostAnswerDraft = hostAnswerField.value
    }
    const joinOfferField = this.container.querySelector<HTMLTextAreaElement>('#join-offer-text')
    if (joinOfferField) {
      this.joinOfferDraft = joinOfferField.value
    }
    if (view.mode !== 'p2p-host') {
      this.hostAnswerDraft = ''
    }
    if (view.mode !== 'p2p-join') {
      this.joinOfferDraft = ''
    }
    if (!view.game) {
      this.menuOpen = false
      this.pendingTargetSelection = null
      this.draggedCardId = null
    } else if (this.pendingTargetSelection && !view.game.legal.playLandByCard[this.pendingTargetSelection.cardId]) {
      this.pendingTargetSelection = null
    }

    const isP2PMode = view.mode === 'p2p-host' || view.mode === 'p2p-join'
    const p2pReady = !isP2PMode || view.p2pStarted
    const inGame = !!view.game && p2pReady
    const showP2P = isP2PMode && !view.replay.active && !inGame

    this.container.innerHTML = `
      <main class="app-shell">
        ${inGame ? '' : renderLobby(view)}
        ${showP2P ? renderP2P(view, this.hostAnswerDraft, this.joinOfferDraft) : ''}
        ${inGame ? renderGame(view, this.menuOpen, this.pendingTargetSelection) : ''}
      </main>
    `

    this.bindEvents()
  }

  unmount(): void {
    if (this.container) {
      this.container.innerHTML = ''
    }
    this.container = null
    this.controller = null
    this.view = null
    this.hostAnswerDraft = ''
    this.joinOfferDraft = ''
    this.menuOpen = false
    this.pendingTargetSelection = null
    this.draggedCardId = null
  }

  private rerender(): void {
    if (this.view) {
      this.render(this.view)
    }
  }

  private resolveDroppedCard(cardId: string): void {
    const game = this.view?.game
    if (!game) {
      return
    }
    const resolution = resolvePlayLandDrop(game, cardId)
    if (resolution.kind === 'invalid') {
      this.pendingTargetSelection = null
      this.controller?.reportStatus('Invalid drop. Choose a playable card.')
      return
    }
    if (resolution.kind === 'single') {
      this.pendingTargetSelection = null
      this.controller?.submitAction(resolution.action)
      return
    }
    this.pendingTargetSelection = { cardId }
    this.controller?.reportStatus('Choose a target for that land.')
    this.rerender()
  }

  private submitPendingTarget(effectTargetId?: string): void {
    const game = this.view?.game
    const pending = this.pendingTargetSelection
    if (!game || !pending) {
      return
    }
    const action = resolveTargetedPlayLandAction(game, pending.cardId, effectTargetId)
    if (!action) {
      this.controller?.reportStatus('Invalid target. Choose a highlighted target.')
      return
    }
    this.pendingTargetSelection = null
    this.controller?.submitAction(action)
  }

  private submitPlainsReuseTarget(effectTargetId?: string): void {
    const game = this.view?.game
    if (!game) {
      return
    }
    const action = resolvePlainsReuseAction(game, effectTargetId)
    if (!action) {
      this.controller?.reportStatus('Invalid target. Choose a highlighted target.')
      return
    }
    this.controller?.submitAction(action)
  }

  private bindDragAndDrop(): void {
    if (!this.container) {
      return
    }
    this.container.querySelectorAll<HTMLElement>('[data-draggable-card]').forEach((element) => {
      element.addEventListener('dragstart', (event) => {
        const cardId = element.dataset.draggableCard
        if (!cardId || element.getAttribute('draggable') !== 'true' || this.pendingTargetSelection) {
          event.preventDefault()
          return
        }
        this.draggedCardId = cardId
        event.dataTransfer?.setData('text/plain', cardId)
        event.dataTransfer?.setData('application/x-cardgame-card-id', cardId)
        event.dataTransfer?.setDragImage?.(element, 40, 60)
      })
      element.addEventListener('dragend', () => {
        this.draggedCardId = null
      })
      element.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && element.dataset.draggableCard && element.getAttribute('draggable') === 'true' && !this.pendingTargetSelection) {
          event.preventDefault()
          this.resolveDroppedCard(element.dataset.draggableCard)
        }
      })
    })

    this.container.querySelectorAll<HTMLElement>('[data-drop-zone="play-land"]').forEach((zone) => {
      zone.addEventListener('dragover', (event) => {
        if (this.draggedCardId) {
          event.preventDefault()
          zone.classList.add('dom-drop-zone--over')
        }
      })
      zone.addEventListener('dragleave', () => {
        zone.classList.remove('dom-drop-zone--over')
      })
      zone.addEventListener('drop', (event) => {
        event.preventDefault()
        zone.classList.remove('dom-drop-zone--over')
        const cardId = event.dataTransfer?.getData('application/x-cardgame-card-id') || event.dataTransfer?.getData('text/plain') || this.draggedCardId
        this.draggedCardId = null
        if (cardId) {
          this.resolveDroppedCard(cardId)
        }
      })
    })

    if (!this.containerListenersBound) {
      this.container.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          this.draggedCardId = null
          if (this.pendingTargetSelection) {
            this.pendingTargetSelection = null
            this.controller?.reportStatus('Target selection cancelled.')
            this.rerender()
          }
        }
      })
      this.container.addEventListener('scroll', () => {
        this.draggedCardId = null
      }, { passive: true })
      this.containerListenersBound = true
    }
  }

  private bindEvents(): void {
    if (!this.container || !this.controller || !this.view) {
      return
    }

    this.container.querySelector('#menu-toggle')?.addEventListener('click', () => {
      this.menuOpen = !this.menuOpen
      this.rerender()
    })

    this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode as Mode
        this.controller?.startGame(mode)
      })
    })
    this.container.querySelector('#resume-adventure')?.addEventListener('click', () => {
      this.controller?.resumeAdventure()
    })
    this.container.querySelectorAll('[data-action="abandon-adventure"]').forEach((element) => {
      element.addEventListener('click', () => {
        this.controller?.abandonAdventure()
      })
    })

    this.container.querySelector<HTMLSelectElement>('#ai-level-select')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      if (isAiLevel(value)) {
        this.controller?.setAiLevel(value)
      }
    })

    this.container.querySelector<HTMLSelectElement>('#card-visual-style-select')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      if (isCardVisualStyle(value)) {
        this.controller?.setCardVisualStyle(value)
      }
    })

    this.container.querySelector<HTMLSelectElement>('#animation-speed-select')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      if (isAnimationSpeed(value)) {
        this.controller?.setAnimationSpeed(value)
      }
    })

    this.container.querySelector('#back-to-lobby')?.addEventListener('click', () => {
      this.controller?.backToLobby()
    })
    this.container.querySelector('#pause-adventure')?.addEventListener('click', () => {
      this.controller?.pauseAdventure()
    })
    this.container.querySelector('#create-offer')?.addEventListener('click', () => {
      void this.controller?.createOffer()
    })
    this.container.querySelector('#accept-answer')?.addEventListener('click', () => {
      const field = this.container?.querySelector<HTMLTextAreaElement>('#answer-text')
      void this.controller?.acceptAnswer(field?.value ?? '')
    })
    this.container.querySelector('#create-answer')?.addEventListener('click', () => {
      const field = this.container?.querySelector<HTMLTextAreaElement>('#join-offer-text')
      void this.controller?.createAnswer(field?.value ?? '')
    })
    this.container.querySelector('#start-p2p-game')?.addEventListener('click', () => {
      this.controller?.startP2PGame()
    })

    this.container.querySelectorAll<HTMLButtonElement>('[data-action="install-app"]').forEach((button) => {
      button.addEventListener('click', () => {
        void promptInstall()
      })
    })

    this.container.querySelector('#save-recording-download')?.addEventListener('click', () => {
      const payload = this.controller?.exportRecordingJson()
      if (!payload) {
        return
      }
      const blob = new Blob([payload], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `cardgame-recording-${Date.now()}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOCATION_DELAY_MS)
    })

    this.container.querySelector('#save-recording-local')?.addEventListener('click', () => {
      this.controller?.saveRecordingToLocalStorage()
    })
    this.container.querySelectorAll('[data-action="load-recording-local"]').forEach((element) => {
      element.addEventListener('click', () => {
        this.controller?.loadRecordingFromLocalStorage()
      })
    })
    this.container.querySelectorAll('[data-action="load-recording-file"]').forEach((element) => {
      element.addEventListener('click', () => {
        const input = element
          .closest('.controls, .menu-section')
          ?.querySelector<HTMLInputElement>('[data-role="load-recording-file-input"]')
          ?? this.container?.querySelector<HTMLInputElement>('[data-role="load-recording-file-input"]')
        input?.click()
      })
    })
    this.container.querySelectorAll<HTMLInputElement>('[data-role="load-recording-file-input"]').forEach((input) => {
      input.addEventListener('change', async (event) => {
        const target = event.target as HTMLInputElement
        const file = target.files?.[0]
        if (!file) {
          return
        }
        try {
          const text = await file.text()
          this.controller?.importRecordingJson(text)
        } catch {
          this.controller?.reportStatus('Failed to read recording file.')
        }
        target.value = ''
      })
    })

    this.container.querySelector('#replay-start')?.addEventListener('click', () => {
      this.controller?.startReplay()
    })
    this.container.querySelector('#replay-playpause')?.addEventListener('click', () => {
      if (!this.view?.replay.active) {
        return
      }
      if (this.view.replay.isPlaying) {
        this.controller?.pauseReplay()
        return
      }
      this.controller?.startReplay()
    })
    this.container.querySelector('#replay-prev')?.addEventListener('click', () => {
      this.controller?.stepReplay(-1)
    })
    this.container.querySelector('#replay-next')?.addEventListener('click', () => {
      this.controller?.stepReplay(1)
    })
    this.container.querySelector('#replay-end')?.addEventListener('click', () => {
      this.controller?.jumpReplayToEnd()
    })
    this.container.querySelector('#replay-exit')?.addEventListener('click', () => {
      this.controller?.exitReplay()
    })

    this.container.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.view?.game) {
          return
        }
        const actor = this.view.game.actor
        const dataAction = button.dataset.action
        const cardId = button.dataset.cardId
        const effectTargetId = button.dataset.targetId
        const discardCardId = button.dataset.discardCardId
        let action: GameAction | null = null

        if (dataAction === 'play_land' && cardId) {
          action = { type: 'play_land', actor, cardId, effectTargetId }
        } else if (dataAction === 'end_turn') {
          action = { type: 'end_turn', actor }
        } else if (dataAction === 'counter_land') {
          action = { type: 'counter_land', actor, discardCardId }
        } else if (dataAction === 'pass_response') {
          action = { type: 'pass_response', actor }
        } else if (dataAction === 'resolve_plains_reuse') {
          action = { type: 'resolve_plains_reuse', actor, effectTargetId }
        } else if (dataAction === 'play_land_target') {
          this.submitPendingTarget(effectTargetId)
          return
        } else if (dataAction === 'plains_reuse_target') {
          this.submitPlainsReuseTarget(effectTargetId)
          return
        } else if (dataAction === 'cancel-target-picker') {
          this.pendingTargetSelection = null
          this.controller?.reportStatus('Target selection cancelled.')
          this.rerender()
          return
        }

        if (action) {
          this.pendingTargetSelection = null
          this.controller?.submitAction(action)
        }
      })
    })

    this.container.querySelector('#rematch')?.addEventListener('click', () => {
      this.controller?.rematch()
    })

    this.bindDragAndDrop()
  }
}
