// Lobby-only HTML overlay for P2P manual signaling (offer/answer paste
// boxes). Phaser scenes cannot host native <textarea> elements for copy/
// paste, so this renders as plain HTML sibling markup of the canvas and is
// shown only while the lobby is active and a P2P mode is selected. Extracted
// from PhaserRenderer.mount()/updateLobbyP2POverlay so the DOM-overlay
// plumbing and its draft-text state have a single home.
import type { ControllerApi } from '../../app/controller'
import type { AppViewModel } from '../../app/types'
import { escapeHtml } from './ui-utils'

export interface P2POverlay {
  element: HTMLDivElement
  update: (view: AppViewModel, lobbyActive: boolean, controller: ControllerApi | null) => void
  remove: () => void
}

export function createP2POverlay(container: HTMLElement): P2POverlay {
  const element = document.createElement('div')
  element.className = 'phaser-lobby-p2p-overlay'
  element.hidden = true
  container.appendChild(element)

  let hostAnswerDraft = ''
  let joinOfferDraft = ''

  const update = (view: AppViewModel, lobbyActive: boolean, controller: ControllerApi | null): void => {
    const isP2PMode = view.mode === 'p2p-host' || view.mode === 'p2p-join'
    const shouldShow = lobbyActive && isP2PMode && !view.replay.active
    if (!shouldShow) {
      element.hidden = true
      element.innerHTML = ''
      hostAnswerDraft = ''
      joinOfferDraft = ''
      return
    }
    element.hidden = false
    const host = view.mode === 'p2p-host'
    const safeStatus = escapeHtml(view.status)
    const safeOffer = escapeHtml(view.offer)
    const safeAnswer = escapeHtml(view.answer)
    const safeHostAnswerDraft = escapeHtml(hostAnswerDraft)
    const safeJoinOfferDraft = escapeHtml(joinOfferDraft)
    element.innerHTML = `
      <section class="phaser-lobby-p2p-panel">
        <h2>P2P Manual Signaling</h2>
        <p>${host ? 'Host: create offer, share it, then paste answer.' : 'Join: paste host offer, create answer, and share answer.'}</p>
        <div class="phaser-lobby-p2p-grid">
          ${host
            ? `<button data-p2p-action="create-offer">Create Offer</button>
               <label for="phaser-p2p-offer">Offer</label>
               <textarea id="phaser-p2p-offer" data-p2p-field="offer" aria-label="Offer" placeholder="Offer" readonly>${safeOffer}</textarea>
               <label for="phaser-p2p-host-answer">Remote Answer</label>
               <textarea id="phaser-p2p-host-answer" data-p2p-field="host-answer" aria-label="Paste remote answer" placeholder="Paste remote answer">${safeHostAnswerDraft}</textarea>
               <button data-p2p-action="accept-answer">Accept Answer</button>
               <button data-p2p-action="start-p2p-game">Start Game</button>`
            : `<label for="phaser-p2p-join-offer">Host Offer</label>
               <textarea id="phaser-p2p-join-offer" data-p2p-field="join-offer" aria-label="Paste host offer" placeholder="Paste host offer">${safeJoinOfferDraft}</textarea>
                <button data-p2p-action="create-answer">Create Answer</button>
                <label for="phaser-p2p-answer">Answer</label>
                <textarea id="phaser-p2p-answer" data-p2p-field="answer" aria-label="Answer" placeholder="Answer" readonly>${safeAnswer}</textarea>`
          }
          <button data-p2p-action="back-to-lobby">Cancel</button>
        </div>
        <p class="phaser-lobby-p2p-status">${safeStatus}</p>
      </section>
    `

    element.querySelector<HTMLTextAreaElement>('[data-p2p-field="host-answer"]')?.addEventListener('input', (event) => {
      hostAnswerDraft = (event.target as HTMLTextAreaElement).value
    })
    element.querySelector<HTMLTextAreaElement>('[data-p2p-field="join-offer"]')?.addEventListener('input', (event) => {
      joinOfferDraft = (event.target as HTMLTextAreaElement).value
    })
    element.querySelector<HTMLButtonElement>('[data-p2p-action="create-offer"]')?.addEventListener('click', () => {
      void controller?.createOffer()
    })
    element.querySelector<HTMLButtonElement>('[data-p2p-action="accept-answer"]')?.addEventListener('click', () => {
      void controller?.acceptAnswer(hostAnswerDraft)
    })
    element.querySelector<HTMLButtonElement>('[data-p2p-action="create-answer"]')?.addEventListener('click', () => {
      void controller?.createAnswer(joinOfferDraft)
    })
    element.querySelector<HTMLButtonElement>('[data-p2p-action="start-p2p-game"]')?.addEventListener('click', () => {
      controller?.startP2PGame()
    })
    element.querySelector<HTMLButtonElement>('[data-p2p-action="back-to-lobby"]')?.addEventListener('click', () => {
      hostAnswerDraft = ''
      joinOfferDraft = ''
      controller?.backToLobby()
    })
  }

  const remove = (): void => {
    element.remove()
  }

  return { element, update, remove }
}
