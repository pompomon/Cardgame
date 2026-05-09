import type { ControllerApi } from '../app/controller'
import { AI_LEVEL_OPTIONS, isAiLevel } from '../app/ai-levels'
import { CARD_VISUAL_STYLE_OPTIONS, isCardVisualStyle } from '../app/card-visual-styles'
import { cardVisualPaletteFor, landIconDataUrl } from '../app/card-visuals'
import { getInstallUiState, promptInstall } from '../app/install-support'
import type { AppViewModel, Mode, RendererKind } from '../app/types'
import { isBasicLand, type BasicLand, type GameAction } from '../game/types'
import type { AppRenderer } from './types'

const BLOB_URL_REVOCATION_DELAY_MS = 1000
const DOM_LOG_VISIBLE_ENTRIES = 14

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function rendererSwitchLink(kind: RendererKind): string {
  return kind === 'dom'
    ? '<a href="?renderer=phaser" class="renderer-link">Switch to Phaser renderer</a>'
    : '<a href="?renderer=dom" class="renderer-link">Switch to DOM renderer</a>'
}

function renderInstallControls(): string {
  const installState = getInstallUiState()
  return `
    <div class="controls install-controls">
      <h3>Install</h3>
      <p>${escapeHtml(installState.statusText)}</p>
      ${installState.canPromptInstall
        ? '<div class="action-row"><button data-action="install-app">Install App</button></div>'
        : ''}
      ${installState.showIosInstallHint
        ? `<p class="install-hint">${escapeHtml(installState.iosInstructions)}</p>`
        : ''}
    </div>
  `
}

function renderLobby(view: AppViewModel): string {
  const aiLevelOptions = AI_LEVEL_OPTIONS.map((option) => {
    const selected = option.value === view.aiLevel ? ' selected' : ''
    return `<option value="${option.value}"${selected}>${option.label}</option>`
  }).join('')
  const cardVisualStyleOptions = CARD_VISUAL_STYLE_OPTIONS.map((option) => {
    const selected = option.value === view.cardVisualStyle ? ' selected' : ''
    return `<option value="${option.value}"${selected}>${option.label}</option>`
  }).join('')

  return `
    <section class="panel">
      <h1>Basic Land Game</h1>
      <p class="subtitle">Land-only 2-player game with local AI and optional P2P mode.</p>
      <p>${rendererSwitchLink(view.renderer)}</p>
      ${renderInstallControls()}
      <div class="controls">
        <h3>AI Difficulty</h3>
        <label for="ai-level-select">AI Level</label>
        <select id="ai-level-select">${aiLevelOptions}</select>
      </div>
      <div class="controls">
        <h3>Card Visual Style</h3>
        <label for="card-visual-style-select">Style</label>
        <select id="card-visual-style-select">${cardVisualStyleOptions}</select>
      </div>
      <div class="modes">
        <button data-mode="local-hvh">Local Human vs Human</button>
        <button data-mode="local-hvai">Local Human vs AI</button>
        <button data-mode="local-aivai">Local AI vs AI</button>
        <button data-mode="p2p-host">P2P Host</button>
        <button data-mode="p2p-join">P2P Join</button>
      </div>
      <div class="controls">
        <h3>Recording</h3>
        <p>Load a saved game recording from browser storage or a file.</p>
        <div class="action-row">
          <button id="load-recording-local">Load from Browser</button>
          <button id="load-recording-file-btn">Load from File</button>
        </div>
        <input id="load-recording-file" type="file" accept="application/json,.json" hidden />
        <p>Local save available: ${view.recording.hasLocalSave ? 'Yes' : 'No'}</p>
      </div>
    </section>
  `
}

function renderP2P(view: AppViewModel, hostAnswerDraft: string, joinOfferDraft: string): string {
  const host = view.mode === 'p2p-host'
  const safeStatus = escapeHtml(view.status)
  const safeOffer = escapeHtml(view.offer)
  const safeAnswer = escapeHtml(view.answer)
  const safeHostAnswerDraft = escapeHtml(hostAnswerDraft)
  const safeJoinOfferDraft = escapeHtml(joinOfferDraft)

  return `
    <section class="panel">
      <h2>P2P Manual Signaling</h2>
      <p>${host ? 'Host: create offer, share it, then paste answer.' : 'Join: paste host offer, create answer, and share answer.'}</p>
      <div class="signal-grid">
        ${
           host
             ? `<button id="create-offer">Create Offer</button>
                <textarea id="offer-text" placeholder="Offer" readonly>${safeOffer}</textarea>
                <textarea id="answer-text" placeholder="Paste remote answer">${safeHostAnswerDraft}</textarea>
                <button id="accept-answer">Accept Answer</button>
                <button id="start-p2p-game">Start Game</button>`
              : `<textarea id="join-offer-text" placeholder="Paste host offer">${safeJoinOfferDraft}</textarea>
                <button id="create-answer">Create Answer</button>
                <textarea id="join-answer-text" placeholder="Answer" readonly>${safeAnswer}</textarea>`
         }
       </div>
      <p class="status">${safeStatus}</p>
    </section>
  `
}

function renderLandIcon(
  name: BasicLand,
  style: AppViewModel['cardVisualStyle'],
  size: number,
  className: string,
): string {
  const src = landIconDataUrl(name, style, size)
  return `<img class="${className}" src="${src}" alt="" role="presentation" width="${size}" height="${size}" />`
}

function renderCardTile(name: string, style: AppViewModel['cardVisualStyle']): string {
  if (!isBasicLand(name)) {
    return `<span>${escapeHtml(name)}</span>`
  }
  const palette = cardVisualPaletteFor(name, style)
  return `<span class="card-tile" style="--tile-fill:${palette.cardFill};--tile-stroke:${palette.cardStroke};--tile-text:${palette.cardText}">${renderLandIcon(name, style, 22, 'card-tile-icon')}<span>${escapeHtml(name)}</span></span>`
}

function renderGame(view: AppViewModel, menuOpen: boolean): string {
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
  const recordingMeta = view.recording.metadata
  const recordingMetaText = recordingMeta
    ? `Seed ${recordingMeta.seed} • Mode ${recordingMeta.mode} • AI ${recordingMeta.aiLevel} • Controllers ${recordingMeta.controllers[0]}/${recordingMeta.controllers[1]} • Completed ${recordingMeta.completed ? 'Yes' : 'No'}`
    : 'No recording data.'
  const renderPlayLandButton = (option: {
    action: { cardId: string; effectTargetId?: string }
    label: string
  }, cardName: string): string => {
    const targetAttr = option.action.effectTargetId
      ? ` data-target-id="${escapeHtml(option.action.effectTargetId)}"`
      : ''
    const icon = isBasicLand(cardName) ? renderLandIcon(cardName, view.cardVisualStyle, 16, 'action-icon') : ''
    return `<button data-action="play_land" data-card-id="${escapeHtml(option.action.cardId)}"${targetAttr}>${icon}${escapeHtml(option.label)}</button>`
  }

  const mainControls = game.canInput && game.phase === 'main'
    ? `
      <div class="controls">
        <h3>Main Phase</h3>
        <div class="action-row">
          ${activeState.handCards.map((card) => {
            const options = game.legal.playLandByCard[card.id]
            if (!options || options.length === 0) {
              return ''
            }
            return options.map((option) => renderPlayLandButton(option, card.name)).join('')
          }).join('')}
        </div>
        ${game.legal.canEndTurn ? '<button data-action="end_turn">End Turn</button>' : ''}
      </div>
    `
    : ''

  const responseControls = game.canInput && game.phase === 'respond'
    ? `
      <div class="controls">
        <h3>Response Window</h3>
        <p>Opponent played ${escapeHtml(game.pendingLandName ?? 'a land')}. Respond?</p>
        <div class="action-row">
          ${game.legal.counterOptions.map((option) => {
            const discardAttr = option.action.discardCardId
              ? ` data-discard-card-id="${escapeHtml(option.action.discardCardId)}"`
              : ''
            return `<button data-action="counter_land"${discardAttr}>${renderLandIcon('Island', view.cardVisualStyle, 16, 'action-icon')}${escapeHtml(option.label)}</button>`
          }).join('')}
          ${game.legal.canPassResponse ? '<button data-action="pass_response">Pass</button>' : ''}
        </div>
      </div>
    `
    : ''

  const plainsReuseControls = game.canInput && game.phase === 'plains_target'
    ? `
      <div class="controls">
        <h3>Plains Reuse</h3>
        <p>Choose target for reused ${escapeHtml(game.pendingPlainsReuseName ?? 'land')}.</p>
        <div class="action-row">
          ${game.legal.plainsReuseOptions.map((option) => {
            const targetAttr = option.action.effectTargetId
              ? ` data-target-id="${escapeHtml(option.action.effectTargetId)}"`
              : ''
            const land = game.pendingPlainsReuseName
            return `<button data-action="resolve_plains_reuse"${targetAttr}>${land && isBasicLand(land) ? renderLandIcon(land, view.cardVisualStyle, 16, 'action-icon') : ''}${escapeHtml(option.label)}</button>`
          }).join('')}
        </div>
      </div>
    `
    : ''

  const renderPlayerInfo = (player: typeof p1, playerIndex: number, kind: 'active' | 'non-active'): string => `
    <article class="player player-${kind}">
      <h3>Player ${playerIndex + 1} (${escapeHtml(view.controllers[playerIndex])})${kind === 'active' ? ' — Active' : ''}</h3>
      <p>Hand: ${player.handCount} • Deck: ${player.deckCount} • Graveyard: ${player.graveyardCount}</p>
      <div class="card-tile-row">Hand cards: ${player.handCards.length > 0 ? player.handCards.map((card) => renderCardTile(card.name, view.cardVisualStyle)).join('') : '<span>None</span>'}</div>
    </article>
  `

  const renderBattlefield = (player: typeof p1, playerIndex: number, kind: 'active' | 'non-active'): string => `
    <article class="battlefield battlefield-${kind}">
      <h4>Player ${playerIndex + 1} Battlefield</h4>
      <div class="card-tile-row">${player.battlefield.length > 0 ? player.battlefield.map((entry) => renderCardTile(entry.name, view.cardVisualStyle)).join('') : '<span>None</span>'}</div>
    </article>
  `

  const menuPanel = `
      <div class="menu-panel" id="menu-panel"${menuOpen ? '' : ' hidden'}>
        ${menuOpen
         ? `<div class="menu-section">
          <button id="back-to-lobby">Back to Lobby</button>
          <button id="rematch">Rematch</button>
        </div>
        <div class="menu-section">
          ${renderInstallControls()}
        </div>
        <div class="menu-section">
          <h4>Recorder</h4>
          <p>${escapeHtml(recordingMetaText)}</p>
          <div class="action-row">
            <button id="save-recording-download">Download Save File</button>
            <button id="save-recording-local">Save to Browser</button>
            <button id="load-recording-local">Load from Browser</button>
            <button id="load-recording-file-btn">Load from File</button>
            ${view.replay.active ? '' : '<button id="replay-start">Start Replay</button>'}
          </div>
          <input id="load-recording-file" type="file" accept="application/json,.json" hidden />
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
    <section class="panel game-scene">
      <div class="game-header">
        <button id="menu-toggle" class="menu-toggle" aria-expanded="${menuOpen ? 'true' : 'false'}" aria-controls="menu-panel" aria-label="Menu">☰ Menu</button>
        <h2>Turn ${game.turn} • Phase: ${game.phase}</h2>
      </div>
      ${menuPanel}
      <p class="status">${safeStatus}</p>
      ${safeWinnerText ? `<p class="winner">${safeWinnerText}</p>` : ''}
      <div class="battlefield-layout">
        <aside class="log">
          <h3>Replay Log</h3>
          <ul>${game.log.slice(-DOM_LOG_VISIBLE_ENTRIES).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        </aside>
        <div class="board">
          ${renderPlayerInfo(nonActiveState, nonActiveIndex, 'non-active')}
          ${renderBattlefield(nonActiveState, nonActiveIndex, 'non-active')}
          ${renderBattlefield(activeState, activeIndex, 'active')}
          ${renderPlayerInfo(activeState, activeIndex, 'active')}
        </div>
      </div>
      ${mainControls}
      ${responseControls}
      ${plainsReuseControls}
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
    }

    const isP2PMode = view.mode === 'p2p-host' || view.mode === 'p2p-join'
    const p2pReady = !isP2PMode || view.p2pStarted
    const inGame = !!view.game && p2pReady
    const showP2P = isP2PMode && !view.replay.active && !inGame

    this.container.innerHTML = `
      <main class="app-shell">
        ${inGame ? '' : renderLobby(view)}
        ${showP2P ? renderP2P(view, this.hostAnswerDraft, this.joinOfferDraft) : ''}
        ${inGame ? renderGame(view, this.menuOpen) : ''}
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
  }

  private bindEvents(): void {
    if (!this.container || !this.controller || !this.view) {
      return
    }

    this.container.querySelector('#menu-toggle')?.addEventListener('click', () => {
      this.menuOpen = !this.menuOpen
      if (this.view) {
        this.render(this.view)
      }
    })

    this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode as Mode
        this.controller?.startGame(mode)
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

    this.container.querySelector('#back-to-lobby')?.addEventListener('click', () => {
      this.controller?.backToLobby()
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
        // install-support.promptInstall() calls notifyChange() and main.ts
        // re-renders via subscribeInstallSupport(); no manual re-render here.
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

    this.container.querySelectorAll('#load-recording-local').forEach((element) => {
      element.addEventListener('click', () => {
        this.controller?.loadRecordingFromLocalStorage()
      })
    })

    this.container.querySelectorAll('#load-recording-file-btn').forEach((element) => {
      element.addEventListener('click', () => {
        const input = this.container?.querySelector<HTMLInputElement>('#load-recording-file')
        input?.click()
      })
    })

    this.container.querySelector('#load-recording-file')?.addEventListener('change', async (event) => {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      if (!file) {
        return
      }
      try {
        const text = await file.text()
        this.controller?.importRecordingJson(text)
      } catch {
        this.controller?.reportStatus('Failed to read recording file.')
      }
      input.value = ''
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
        }

        if (action) {
          this.controller?.submitAction(action)
        }
      })
    })

    this.container.querySelector('#rematch')?.addEventListener('click', () => {
      this.controller?.rematch()
    })
  }
}
