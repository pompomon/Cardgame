import './style.css'
import { chooseAiAction } from './game/ai'
import { applyAction, canAct, createInitialGame } from './game/engine'
import type { GameAction, GameState } from './game/types'
import { P2PLink } from './net/p2p'

type Mode = 'local-hvh' | 'local-hvai' | 'local-aivai' | 'p2p-host' | 'p2p-join'
type Controller = 'human' | 'ai' | 'remote'

interface AppState {
  mode: Mode | null
  game: GameState | null
  controllers: [Controller, Controller]
  seed: number
  offer: string
  answer: string
  status: string
}

const state: AppState = {
  mode: null,
  game: null,
  controllers: ['human', 'human'],
  seed: Date.now(),
  offer: '',
  answer: '',
  status: '',
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found.')
}
const root = app

let p2p: P2PLink | null = null

function activeActor(game: GameState): number {
  if (game.phase === 'respond' && game.pendingLandPlay) {
    return game.pendingLandPlay.actor === 0 ? 1 : 0
  }
  return game.currentPlayer
}

function isSeedPayload(payload: unknown): payload is { seed: number } {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  return typeof (payload as { seed?: unknown }).seed === 'number'
}

function isGameAction(payload: unknown): payload is GameAction {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  const action = payload as {
    type?: unknown
    actor?: unknown
    cardId?: unknown
  }
  if (typeof action.type !== 'string' || typeof action.actor !== 'number') {
    return false
  }
  if (action.type === 'play_land') {
    return typeof action.cardId === 'string'
  }
  return action.type === 'end_turn' || action.type === 'counter_land' || action.type === 'pass_response'
}

function startGame(mode: Mode): void {
  state.mode = mode
  state.seed = Date.now()
  state.game = createInitialGame(state.seed)

  if (mode === 'local-hvh') {
    state.controllers = ['human', 'human']
    state.status = 'Local Human vs Human game started.'
  } else if (mode === 'local-hvai') {
    state.controllers = ['human', 'ai']
    state.status = 'Local Human vs AI game started.'
  } else if (mode === 'local-aivai') {
    state.controllers = ['ai', 'ai']
    state.status = 'Local AI vs AI simulation started.'
  } else if (mode === 'p2p-host') {
    state.controllers = ['human', 'remote']
    state.status = 'Host created. Exchange offer/answer to connect.'
  } else {
    state.controllers = ['remote', 'human']
    state.status = 'Joiner ready. Paste offer to generate answer.'
  }

  render()
  scheduleAiIfNeeded()
}

function setupP2P(): void {
  p2p?.close()
  p2p = new P2PLink((packet) => {
    if (packet.type === 'start') {
      if (!isSeedPayload(packet.payload)) {
        state.status = 'Ignored invalid start payload from peer.'
        render()
        return
      }
      state.seed = packet.payload.seed
      state.game = createInitialGame(packet.payload.seed)
      state.status = 'Remote game started.'
      render()
      return
    }

    if (packet.type === 'action' && state.game) {
      if (!isGameAction(packet.payload)) {
        state.status = 'Ignored invalid action payload from peer.'
        render()
        return
      }
      state.game = applyAction(state.game, packet.payload)
      render()
      scheduleAiIfNeeded()
      return
    }

    if (packet.type === 'rematch') {
      if (!isSeedPayload(packet.payload)) {
        state.status = 'Ignored invalid rematch payload from peer.'
        render()
        return
      }
      state.seed = packet.payload.seed
      state.game = createInitialGame(packet.payload.seed)
      state.status = 'Rematch started.'
      render()
    }
  })
}

function applyLocalAction(action: GameAction): void {
  if (!state.game) {
    return
  }
  state.game = applyAction(state.game, action)
  if (state.mode === 'p2p-host' || state.mode === 'p2p-join') {
    p2p?.send('action', action)
  }
  render()
  scheduleAiIfNeeded()
}

function scheduleAiIfNeeded(): void {
  if (!state.game || state.game.phase === 'gameOver') {
    return
  }

  const actor = activeActor(state.game)
  const control = state.controllers[actor]
  if (control !== 'ai' || !canAct(state.game, actor)) {
    return
  }

  setTimeout(() => {
    if (!state.game) {
      return
    }
    const action = chooseAiAction(state.game, actor)
    if (!action) {
      return
    }
    applyLocalAction(action)
  }, 350)
}

function renderLobby(): string {
  return `
    <section class="panel">
      <h1>Basic Land Game</h1>
      <p class="subtitle">Land-only 2-player game with local AI and optional P2P mode.</p>
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

function renderP2P(): string {
  const host = state.mode === 'p2p-host'

  return `
    <section class="panel">
      <h2>P2P Manual Signaling</h2>
      <p>${host ? 'Host: create offer, share it, then paste answer.' : 'Join: paste host offer, create answer, and share answer.'}</p>
      <div class="signal-grid">
        ${
          host
            ? `<button id="create-offer">Create Offer</button>
               <textarea id="offer-text" placeholder="Offer" readonly>${state.offer}</textarea>
               <textarea id="answer-text" placeholder="Paste remote answer"></textarea>
               <button id="accept-answer">Accept Answer</button>
               <button id="start-p2p-game">Start Game</button>`
            : `<textarea id="join-offer-text" placeholder="Paste host offer"></textarea>
               <button id="create-answer">Create Answer</button>
               <textarea id="join-answer-text" placeholder="Answer" readonly>${state.answer}</textarea>`
        }
      </div>
      <p class="status">${state.status}</p>
    </section>
  `
}

function renderGame(): string {
  const game = state.game
  if (!game) {
    return ''
  }

  const [p1, p2] = game.players
  const actor = activeActor(game)
  const actorControl = state.controllers[actor]
  const canInput = actorControl === 'human' && canAct(game, actor)
  const winnerText = game.winner === null ? '' : game.winner === 'draw' ? 'Draw game.' : `Winner: Player ${game.winner + 1}`

  const mainControls = canInput && game.phase === 'main'
    ? `
      <div class="controls">
        <h3>Main Phase</h3>
        <div class="action-row">
          ${(actor === 0 ? p1 : p2).hand.map((card) => `<button data-action="play_land" data-card-id="${card.id}">Play ${card.name}</button>`).join('')}
        </div>
        <button data-action="end_turn">End Turn</button>
      </div>
    `
    : ''

  const responseControls = canInput && game.phase === 'respond'
    ? `
      <div class="controls">
        <h3>Response Window</h3>
        <p>Opponent played ${game.pendingLandPlay?.card.name}. Respond?</p>
        <div class="action-row">
          <button data-action="counter_land">Counter with Island (discard Island + another land)</button>
          <button data-action="pass_response">Pass</button>
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
      <p class="status">${state.status}</p>
      <p>${winnerText}</p>
      <div class="board">
        <article class="player">
          <h3>Player 1 (${state.controllers[0]})</h3>
          <p>Hand: ${p1.hand.length} • Deck: ${p1.deck.length} • Graveyard: ${p1.graveyard.length}</p>
          <p>Battlefield: ${p1.battlefield.map((entry) => entry.card.name).join(', ') || 'None'}</p>
          <p>Hand cards: ${p1.hand.map((card) => card.name).join(', ') || 'None'}</p>
        </article>
        <article class="player">
          <h3>Player 2 (${state.controllers[1]})</h3>
          <p>Hand: ${p2.hand.length} • Deck: ${p2.deck.length} • Graveyard: ${p2.graveyard.length}</p>
          <p>Battlefield: ${p2.battlefield.map((entry) => entry.card.name).join(', ') || 'None'}</p>
          <p>Hand cards: ${p2.hand.map((card) => card.name).join(', ') || 'None'}</p>
        </article>
      </div>
      ${mainControls}
      ${responseControls}
      <div class="log">
        <h3>Replay Log</h3>
        <ul>${game.log.slice(-14).map((line) => `<li>${line}</li>`).join('')}</ul>
      </div>
      <div class="action-row">
        <button id="rematch">Rematch</button>
      </div>
    </section>
  `
}

function bindEvents(): void {
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode as Mode
      if (mode === 'p2p-host' || mode === 'p2p-join') {
        setupP2P()
      }
      startGame(mode)
    })
  })

  root.querySelector('#back-to-lobby')?.addEventListener('click', () => {
    p2p?.close()
    p2p = null
    state.mode = null
    state.game = null
    state.status = ''
    state.offer = ''
    state.answer = ''
    render()
  })

  root.querySelector('#create-offer')?.addEventListener('click', async () => {
    if (!p2p) {
      return
    }
    try {
      state.offer = await p2p.createOffer()
      state.status = 'Offer ready. Share with joiner.'
    } catch {
      state.status = 'Failed to create offer. Check connection and try again.'
    }
    render()
  })

  root.querySelector('#accept-answer')?.addEventListener('click', async () => {
    if (!p2p) {
      return
    }
    const field = root.querySelector<HTMLTextAreaElement>('#answer-text')
    if (!field?.value.trim()) {
      return
    }
    try {
      await p2p.acceptAnswer(field.value.trim())
      state.status = 'Answer accepted. Data channel should connect shortly.'
    } catch {
      state.status = 'Failed to accept answer. Verify the pasted answer and retry.'
    }
    render()
  })

  root.querySelector('#create-answer')?.addEventListener('click', async () => {
    if (!p2p) {
      return
    }
    const field = root.querySelector<HTMLTextAreaElement>('#join-offer-text')
    if (!field?.value.trim()) {
      return
    }
    try {
      state.answer = await p2p.acceptOffer(field.value.trim())
      state.status = 'Answer created. Send it to host.'
    } catch {
      state.status = 'Failed to create answer. Verify the pasted offer and retry.'
    }
    render()
  })

  root.querySelector('#start-p2p-game')?.addEventListener('click', () => {
    if (!state.game) {
      return
    }
    p2p?.send('start', { seed: state.seed })
    state.status = 'P2P game started.'
    render()
  })

  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.game) {
        return
      }

      const actor = activeActor(state.game)
      const dataAction = button.dataset.action
      const cardId = button.dataset.cardId

      if (dataAction === 'play_land' && cardId) {
        applyLocalAction({ type: 'play_land', actor, cardId })
      } else if (dataAction === 'end_turn') {
        applyLocalAction({ type: 'end_turn', actor })
      } else if (dataAction === 'counter_land') {
        applyLocalAction({ type: 'counter_land', actor })
      } else if (dataAction === 'pass_response') {
        applyLocalAction({ type: 'pass_response', actor })
      }
    })
  })

  root.querySelector('#rematch')?.addEventListener('click', () => {
    if (!state.mode) {
      return
    }
    state.seed = Date.now()
    state.game = createInitialGame(state.seed)
    if (state.mode === 'p2p-host' || state.mode === 'p2p-join') {
      p2p?.send('rematch', { seed: state.seed })
    }
    state.status = 'Rematch started.'
    render()
    scheduleAiIfNeeded()
  })
}

function render(): void {
  root.innerHTML = `
    <main class="app-shell">
      ${renderLobby()}
      ${state.mode === 'p2p-host' || state.mode === 'p2p-join' ? renderP2P() : ''}
      ${state.game ? renderGame() : ''}
    </main>
  `
  bindEvents()
}

render()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
