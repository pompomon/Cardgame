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
    </section>
  `
}

function renderP2P(view: AppViewModel): string {
  const host = view.mode === 'p2p-host'
  const safeStatus = escapeHtml(view.status)
  const safeOffer = escapeHtml(view.offer)
  const safeAnswer = escapeHtml(view.answer)

  return `
    <section class="panel">
      <h2>P2P Manual Signaling</h2>
      <p>${host ? 'Host: create offer, share it, then paste answer.' : 'Join: paste host offer, create answer, and share answer.'}</p>
      <div class="signal-grid">
        ${
           host
             ? `<button id="create-offer">Create Offer</button>
               <textarea id="offer-text" placeholder="Offer" readonly>${safeOffer}</textarea>
               <textarea id="answer-text" placeholder="Paste remote answer"></textarea>
               <button id="accept-answer">Accept Answer</button>
               <button id="start-p2p-game">Start Game</button>`
             : `<textarea id="join-offer-text" placeholder="Paste host offer"></textarea>
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
            return options.map((option) => `<button data-action="play_land" data-card-id="${escapeHtml(option.action.cardId)}" ${option.action.effectTargetId ? `data-target-id="${escapeHtml(option.action.effectTargetId)}"` : ''}>${escapeHtml(option.label)}</button>`).join('')
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

  mount(container: HTMLElement, controller: ControllerApi): void {
    this.container = container
    this.controller = controller
  }

  render(view: AppViewModel): void {
    this.view = view
    if (!this.container || !this.controller) {
      return
    }

    this.container.innerHTML = `
      <main class="app-shell">
        ${renderLobby(view)}
        ${view.mode === 'p2p-host' || view.mode === 'p2p-join' ? renderP2P(view) : ''}
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
