import type { ControllerApi } from '../app/controller'
import type { AppViewModel, Mode, RendererKind } from '../app/types'
import type { GameAction } from '../game/types'
import type { AppRenderer } from './types'

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

function renderLobby(view: AppViewModel): string {
  return `
    <section class="panel">
      <h1>Basic Land Game</h1>
      <p class="subtitle">Land-only 2-player game with local AI and optional P2P mode.</p>
      <p>${rendererSwitchLink(view.renderer)}</p>
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

function renderGame(view: AppViewModel): string {
  const game = view.game
  if (!game) {
    return ''
  }

  const [p1, p2] = game.players
  const actorState = game.actor === 0 ? p1 : p2
  const safeStatus = escapeHtml(view.status)
  const safeWinnerText = escapeHtml(game.winnerText)
  const recordingMeta = view.recording.metadata
  const recordingMetaText = recordingMeta
    ? `Seed ${recordingMeta.seed} • Mode ${recordingMeta.mode} • Controllers ${recordingMeta.controllers[0]}/${recordingMeta.controllers[1]} • Completed ${recordingMeta.completed ? 'Yes' : 'No'}`
    : 'No recording data.'
  const renderPlayLandButton = (option: {
    action: { cardId: string; effectTargetId?: string }
    label: string
  }): string => {
    const targetAttr = option.action.effectTargetId
      ? ` data-target-id="${escapeHtml(option.action.effectTargetId)}"`
      : ''
    return `<button data-action="play_land" data-card-id="${escapeHtml(option.action.cardId)}"${targetAttr}>${escapeHtml(option.label)}</button>`
  }

  const mainControls = game.canInput && game.phase === 'main'
    ? `
      <div class="controls">
        <h3>Main Phase</h3>
        <div class="action-row">
          ${actorState.handCards.map((card) => {
            const options = game.legal.playLandByCard[card.id]
            if (!options || options.length === 0) {
              return ''
            }
            return options.map((option) => renderPlayLandButton(option)).join('')
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
            return `<button data-action="counter_land"${discardAttr}>${escapeHtml(option.label)}</button>`
          }).join('')}
          ${game.legal.canPassResponse ? '<button data-action="pass_response">Pass</button>' : ''}
        </div>
      </div>
    `
    : ''

  return `
    <section class="panel">
      <div class="game-header">
        <h2>Turn ${game.turn} • Phase: ${game.phase}</h2>
        <button id="back-to-lobby">Back to Lobby</button>
      </div>
      <p class="status">${safeStatus}</p>
      <p>${safeWinnerText}</p>
      <div class="controls">
        <h3>Recorder</h3>
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
        ? `<div class="controls">
          <h3>Replay Controls</h3>
          <p>Step ${view.replay.step}/${view.replay.totalSteps} • ${view.replay.isPlaying ? 'Playing' : 'Paused'}</p>
          <div class="action-row">
            <button id="replay-playpause">${view.replay.isPlaying ? 'Pause' : 'Play'}</button>
            <button id="replay-prev">Previous</button>
            <button id="replay-next">Next</button>
            <button id="replay-end">Jump to End</button>
            <button id="replay-exit">Exit Replay</button>
          </div>
        </div>`
        : ''}
      <div class="board">
        <article class="player">
          <h3>Player 1 (${escapeHtml(view.controllers[0])})</h3>
          <p>Hand: ${p1.handCount} • Deck: ${p1.deckCount} • Graveyard: ${p1.graveyardCount}</p>
          <p>Battlefield: ${escapeHtml(p1.battlefield.map((entry) => entry.name).join(', ') || 'None')}</p>
          <p>Hand cards: ${escapeHtml(p1.handCards.map((card) => card.name).join(', ') || 'None')}</p>
        </article>
        <article class="player">
          <h3>Player 2 (${escapeHtml(view.controllers[1])})</h3>
          <p>Hand: ${p2.handCount} • Deck: ${p2.deckCount} • Graveyard: ${p2.graveyardCount}</p>
          <p>Battlefield: ${escapeHtml(p2.battlefield.map((entry) => entry.name).join(', ') || 'None')}</p>
          <p>Hand cards: ${escapeHtml(p2.handCards.map((card) => card.name).join(', ') || 'None')}</p>
        </article>
      </div>
      ${mainControls}
      ${responseControls}
      <div class="log">
        <h3>Replay Log</h3>
        <ul>${game.log.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      </div>
      <div class="action-row">
        <button id="rematch">Rematch</button>
      </div>
    </section>
  `
}

export class DomRenderer implements AppRenderer {
  private container: HTMLElement | null = null
  private controller: ControllerApi | null = null
  private view: AppViewModel | null = null
  private hostAnswerDraft = ''
  private joinOfferDraft = ''

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

    this.container.innerHTML = `
      <main class="app-shell">
        ${view.game ? '' : renderLobby(view)}
        ${(view.mode === 'p2p-host' || view.mode === 'p2p-join') && !view.replay.active
    ? renderP2P(view, this.hostAnswerDraft, this.joinOfferDraft)
    : ''}
        ${view.game ? renderGame(view) : ''}
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
  }

  private bindEvents(): void {
    if (!this.container || !this.controller || !this.view) {
      return
    }

    this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode as Mode
        this.controller?.startGame(mode)
      })
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
      setTimeout(() => URL.revokeObjectURL(url), 0)
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
