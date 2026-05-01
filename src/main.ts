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
  selectedAttackers: Set<string>
  selectedBlocks: Map<string, string>
  seed: number
  offer: string
  answer: string
  status: string
}

const state: AppState = {
  mode: null,
  game: null,
  controllers: ['human', 'human'],
  selectedAttackers: new Set(),
  selectedBlocks: new Map(),
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

function startGame(mode: Mode): void {
  state.mode = mode
  state.seed = Date.now()
  state.game = createInitialGame(state.seed)
  state.selectedAttackers.clear()
  state.selectedBlocks.clear()

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
  p2p = new P2PLink((packet) => {
    if (packet.type === 'start') {
      const payload = packet.payload as { seed: number }
      state.seed = payload.seed
      state.game = createInitialGame(payload.seed)
      state.selectedAttackers.clear()
      state.selectedBlocks.clear()
      state.status = 'Remote game started.'
      render()
      return
    }

    if (packet.type === 'action' && state.game) {
      const action = packet.payload as GameAction
      state.game = applyAction(state.game, action)
      render()
      scheduleAiIfNeeded()
      return
    }

    if (packet.type === 'rematch') {
      const payload = packet.payload as { seed: number }
      state.seed = payload.seed
      state.game = createInitialGame(payload.seed)
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

  const actor = state.game.phase === 'declareBlockers' ? (state.game.currentPlayer === 0 ? 1 : 0) : state.game.currentPlayer
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

function cardLabel(instanceId: string): string {
  if (!state.game) {
    return instanceId
  }

  for (const player of state.game.players) {
    const card = player.battlefield.find((entry) => entry.instanceId === instanceId)
    if (card) {
      return `${card.card.name} (${card.card.power}/${card.card.toughness})`
    }
  }

  return instanceId
}

function renderLobby(): string {
  return `
    <section class="panel">
      <h1>Cardgame (Simplified MTG)</h1>
      <p class="subtitle">2-player web card game with AI, P2P, and offline SPA support.</p>
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
  const actor = game.phase === 'declareBlockers' ? (game.currentPlayer === 0 ? 1 : 0) : game.currentPlayer
  const actorControl = state.controllers[actor]
  const canInput = actorControl === 'human' && canAct(game, actor)

  const mainControls = canInput && game.phase === 'main'
    ? `
      <div class="controls">
        <h3>Main Phase Actions</h3>
        <div class="action-row">
          ${p1.id === actor
            ? p1.hand.filter((card) => card.type === 'land').map((card) => `<button data-action="play_land" data-card-id="${card.id}">Play ${card.name}</button>`).join('')
            : p2.hand.filter((card) => card.type === 'land').map((card) => `<button data-action="play_land" data-card-id="${card.id}">Play ${card.name}</button>`).join('')}
        </div>
        <div class="action-row">
          ${(actor === 0 ? p1 : p2).hand.filter((card) => card.type === 'creature').map((card) => `<button data-action="cast_creature" data-card-id="${card.id}">Cast ${card.name} (${card.cost})</button>`).join('')}
        </div>
        <button data-action="end_main">End Main</button>
      </div>
    `
    : ''

  const attackerCandidates = (actor === 0 ? p1 : p2).battlefield.filter((entry) => entry.card.type === 'creature' && !entry.tapped && !entry.summoningSickness)
  const attackControls = canInput && game.phase === 'declareAttackers'
    ? `
      <div class="controls">
        <h3>Declare Attackers</h3>
        <div class="action-row">
          ${attackerCandidates.map((entry) => `<label><input type="checkbox" data-attacker-id="${entry.instanceId}" ${state.selectedAttackers.has(entry.instanceId) ? 'checked' : ''}/> ${entry.card.name} (${entry.card.power}/${entry.card.toughness})</label>`).join('')}
        </div>
        <button id="confirm-attackers">Confirm Attackers</button>
      </div>
    `
    : ''

  const defenders = (actor === 0 ? p1 : p2)
  const blockingCreatures = defenders.battlefield.filter((entry) => entry.card.type === 'creature' && !entry.tapped)
  const blockControls = canInput && game.phase === 'declareBlockers'
    ? `
      <div class="controls">
        <h3>Declare Blockers</h3>
        ${game.attackers.map((attackerId) => `
          <div class="block-row">
            <span>${cardLabel(attackerId)}</span>
            <select data-block-for="${attackerId}">
              <option value="">No block</option>
              ${blockingCreatures.map((entry) => `<option value="${entry.instanceId}" ${state.selectedBlocks.get(attackerId) === entry.instanceId ? 'selected' : ''}>${entry.card.name}</option>`).join('')}
            </select>
          </div>
        `).join('')}
        <button id="confirm-blockers">Confirm Blockers</button>
      </div>
    `
    : ''

  const winnerText = game.winner === null ? '' : game.winner === 'draw' ? 'Draw game.' : `Winner: Player ${game.winner + 1}`

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
          <p>Life: ${p1.life} • Hand: ${p1.hand.length} • Deck: ${p1.deck.length} • Graveyard: ${p1.graveyard.length}</p>
          <p>Battlefield: ${p1.battlefield.map((entry) => `${entry.card.name}${entry.tapped ? ' [Tapped]' : ''}${entry.summoningSickness ? ' [Sick]' : ''}`).join(', ') || 'None'}</p>
        </article>
        <article class="player">
          <h3>Player 2 (${state.controllers[1]})</h3>
          <p>Life: ${p2.life} • Hand: ${p2.hand.length} • Deck: ${p2.deck.length} • Graveyard: ${p2.graveyard.length}</p>
          <p>Battlefield: ${p2.battlefield.map((entry) => `${entry.card.name}${entry.tapped ? ' [Tapped]' : ''}${entry.summoningSickness ? ' [Sick]' : ''}`).join(', ') || 'None'}</p>
        </article>
      </div>
      ${mainControls}
      ${attackControls}
      ${blockControls}
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
    state.mode = null
    state.game = null
    state.status = ''
    state.offer = ''
    state.answer = ''
    state.selectedAttackers.clear()
    state.selectedBlocks.clear()
    render()
  })

  root.querySelector('#create-offer')?.addEventListener('click', async () => {
    if (!p2p) {
      return
    }
    state.offer = await p2p.createOffer()
    state.status = 'Offer ready. Share with joiner.'
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
    await p2p.acceptAnswer(field.value.trim())
    state.status = 'Answer accepted. Data channel should connect shortly.'
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
    state.answer = await p2p.acceptOffer(field.value.trim())
    state.status = 'Answer created. Send it to host.'
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

      const actor = state.game.currentPlayer
      const dataAction = button.dataset.action
      const cardId = button.dataset.cardId

      if (dataAction === 'play_land' && cardId) {
        applyLocalAction({ type: 'play_land', actor, cardId })
      } else if (dataAction === 'cast_creature' && cardId) {
        applyLocalAction({ type: 'cast_creature', actor, cardId })
      } else if (dataAction === 'end_main') {
        applyLocalAction({ type: 'end_main', actor })
      }
    })
  })

  root.querySelectorAll<HTMLInputElement>('[data-attacker-id]').forEach((box) => {
    box.addEventListener('change', () => {
      const id = box.dataset.attackerId
      if (!id) {
        return
      }
      if (box.checked) {
        state.selectedAttackers.add(id)
      } else {
        state.selectedAttackers.delete(id)
      }
    })
  })

  root.querySelector('#confirm-attackers')?.addEventListener('click', () => {
    if (!state.game) {
      return
    }
    applyLocalAction({
      type: 'declare_attackers',
      actor: state.game.currentPlayer,
      attackerIds: [...state.selectedAttackers],
    })
    state.selectedAttackers.clear()
  })

  root.querySelectorAll<HTMLSelectElement>('[data-block-for]').forEach((select) => {
    select.addEventListener('change', () => {
      const attackerId = select.dataset.blockFor
      if (!attackerId) {
        return
      }
      if (!select.value) {
        state.selectedBlocks.delete(attackerId)
      } else {
        state.selectedBlocks.set(attackerId, select.value)
      }
    })
  })

  root.querySelector('#confirm-blockers')?.addEventListener('click', () => {
    if (!state.game) {
      return
    }
    const actor = state.game.currentPlayer === 0 ? 1 : 0
    const blocks: Record<string, string | null> = {}
    for (const attackerId of state.game.attackers) {
      blocks[attackerId] = state.selectedBlocks.get(attackerId) ?? null
    }
    applyLocalAction({ type: 'declare_blockers', actor, blocks })
    state.selectedBlocks.clear()
  })

  root.querySelector('#rematch')?.addEventListener('click', () => {
    if (!state.mode) {
      return
    }
    state.seed = Date.now()
    state.game = createInitialGame(state.seed)
    state.selectedAttackers.clear()
    state.selectedBlocks.clear()
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
