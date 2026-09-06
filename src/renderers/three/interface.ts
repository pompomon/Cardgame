import type { ControllerApi } from '../../app/controller'
import {
  resolvePlainsReuseAction,
  resolvePlayLandDrop,
  resolveSwampDiscardAction,
  resolveTargetedPlayLandAction,
} from '../../app/action-resolution'
import { isAiLevel } from '../../app/ai-levels'
import { isAnimationSpeed } from '../../app/animation-settings'
import { isBoardTheme } from '../../app/board-theme'
import { isCardVisualStyle } from '../../app/card-visual-styles'
import { promptInstall } from '../../app/install-support'
import { isRenderQualityPreference } from '../../app/render-quality'
import type { AppViewModel } from '../../app/types'
import type { GameAction } from '../../game/types'
import { canPreviewCard } from '../card-preview'
import type { BoardHit } from './contracts'
import {
  canThreeInput,
  isThreeInGame,
  isThreeMode,
  renderThreeInterface,
  threeDecisionKey,
  threePreviewName,
  threePrimaryAction,
  threeResponse,
  threeSessionKey,
  threeTargets,
  type InterfaceUi,
  type ThreePrimaryAction,
} from './interface-model'
import './interface.css'

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]'

interface SavedFocus {
  element: HTMLElement
  key: string
  start: number | null
  end: number | null
}

function focusKey(element: HTMLElement): string {
  return JSON.stringify([element.tagName, element.id, element.dataset.action, element.dataset.mode,
    element.dataset.cardId, element.dataset.owner, element.dataset.zone, element.dataset.instanceId,
    element.dataset.targetId, element.dataset.discardCardId, element.closest('[data-modal]')?.getAttribute('data-modal')])
}

export class ThreeInterface {
  private view: AppViewModel | null = null
  private presentedActor = 0
  private menuOpen = false
  private pendingCardId: string | null = null
  private phaseDismissed = false
  private preview: BoardHit | null = null
  private hostAnswerDraft = ''
  private joinOfferDraft = ''
  private decision = ''
  private session = ''
  private submittedDecision: string | null = null
  private markup = ''
  private blocked = false
  private modalKind: string | null = null
  private inlineTargetOpen = false
  private returnFocus: SavedFocus | null = null
  private disposed = false
  private fileGeneration = 0
  private readonly downloadTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly content: HTMLElement
  private readonly fileInput: HTMLInputElement
  private readonly document: Document
  private readonly host: HTMLElement
  private readonly controller: ControllerApi
  private readonly onChange: () => void
  private readonly onBlock: () => void

  constructor(
    host: HTMLElement,
    controller: ControllerApi,
    onChange: () => void,
    onBlock: () => void,
  ) {
    this.host = host
    this.controller = controller
    this.onChange = onChange
    this.onBlock = onBlock
    this.document = host.ownerDocument
    host.classList.add('three-interface')
    this.content = this.document.createElement('div')
    this.fileInput = this.document.createElement('input')
    this.fileInput.type = 'file'
    this.fileInput.accept = 'application/json,.json'
    this.fileInput.hidden = true
    host.append(this.content, this.fileInput)
    host.addEventListener('click', this.handleClick)
    host.addEventListener('change', this.handleChange)
    host.addEventListener('input', this.handleInput)
    host.addEventListener('cancel', this.handleCancel, true)
    this.document.addEventListener('keydown', this.handleKeydown)
    this.document.addEventListener('focusin', this.handleFocusIn)
    this.fileInput.addEventListener('change', this.handleFile)
  }

  private ui(): InterfaceUi {
    return {
      presentedActor: this.presentedActor, menuOpen: this.menuOpen, pendingCardId: this.pendingCardId,
      phaseDismissed: this.phaseDismissed, preview: this.preview,
      hostAnswerDraft: this.hostAnswerDraft, joinOfferDraft: this.joinOfferDraft,
    }
  }

  get targetIds(): ReadonlySet<string> {
    if (!this.view || this.menuOpen || this.preview || this.phaseDismissed) return new Set()
    const target = threeTargets(this.view, this.ui())
    return new Set(target?.battlefield ? target.options.flatMap((option) => option.effectTargetId ? [option.effectTargetId] : []) : [])
  }

  get response() {
    return !this.disposed && this.view ? threeResponse(this.view, this.ui()) : null
  }

  get primaryAction(): ThreePrimaryAction | null {
    return !this.disposed && this.view ? threePrimaryAction(this.view, this.ui()) : null
  }

  activatePrimaryAction(action: ThreePrimaryAction): void {
    const view = this.latestForAction()
    if (!view?.game || this.isBlocked() || action.decision !== this.decision) return
    const current = threePrimaryAction(view, this.ui())
    if (!current || current.disabled || current.type !== action.type) return
    this.submit({ type: current.type, actor: view.game.actor })
  }

  isBlocked(): boolean {
    return !this.disposed && (this.menuOpen || this.preview !== null || this.pendingCardId !== null
      || !this.phaseDismissed && !!this.view && threeTargets(this.view, this.ui()) !== null)
  }

  update(view: AppViewModel, presentedActor: number): void {
    if (this.disposed) return
    const session = threeSessionKey(view)
    const decision = threeDecisionKey(view)
    if (this.session !== session) {
      this.menuOpen = false
      this.preview = null
      this.hostAnswerDraft = ''
      this.joinOfferDraft = ''
      this.fileGeneration += 1
    }
    if (this.decision !== decision || this.presentedActor !== presentedActor) {
      this.pendingCardId = null
      this.phaseDismissed = false
      this.preview = null
      this.submittedDecision = null
    }
    this.view = view
    this.presentedActor = presentedActor
    this.decision = decision
    this.session = session
    this.render()
  }

  // Controller snapshots can advance before the next presented frame. Never
  // apply an old button/board hit to the new decision, even if ids are reused.
  private latestForAction(): AppViewModel | null {
    if (this.disposed || !this.view) return null
    const latest = this.controller.getViewModel()
    if (threeDecisionKey(latest) !== this.decision) {
      this.update(latest, this.presentedActor)
      this.onChange()
      return null
    }
    return latest
  }

  playCard(cardId: string): void {
    const view = this.latestForAction()
    if (!view?.game || !canThreeInput(view, this.presentedActor) || this.isBlocked() || view.game.phase !== 'main') return
    if (!view.game.players[view.game.actor].handCards.some((card) => card.id === cardId)) return
    const resolution = resolvePlayLandDrop(view.game, cardId)
    if (resolution.kind === 'single') {
      this.submit(resolution.action)
    } else if (resolution.kind === 'needs_target') {
      this.pendingCardId = cardId
      this.changed()
    }
  }

  activate(hit: BoardHit): void {
    const view = this.latestForAction()
    if (!view?.game || !isThreeInGame(view) || this.menuOpen || this.preview) return
    if (threeResponse(view, this.ui()) && hit.zone === 'hand' && hit.owner === view.game.actor) {
      this.respondWithCard(hit.cardId, hit.owner)
      return
    }
    if (hit.zone === 'battlefield' && hit.instanceId && threePreviewName(view.game, hit) !== null) {
      const targets = threeTargets(view, this.ui())
      if (targets?.battlefield && targets.options.some((option) => option.effectTargetId === hit.instanceId)) {
        this.chooseTarget(hit.instanceId)
        return
      }
    }
    this.previewCard(hit)
  }

  private respondWithCard(cardId: string, owner: number): void {
    const view = this.latestForAction()
    if (!view?.game || owner !== view.game.actor || this.isBlocked()) return
    const choice = threeResponse(view, this.ui())?.choices.find((entry) => entry.cardId === cardId)
    if (choice) this.submit(choice.action)
  }

  private previewCard(hit: BoardHit): void {
    const view = this.latestForAction()
    if (!view?.game || !isThreeInGame(view) || this.menuOpen || this.preview) return
    if (threeResponse(view, this.ui()) && hit.zone === 'hand' && hit.owner === view.game.actor) return
    if (!canPreviewCard({ phase: view.game.phase, pendingPlayLandTargetSelection: !!this.pendingCardId, menuOpen: this.menuOpen })) return
    if (threePreviewName(view.game, hit) === null) return
    this.preview = { ...hit }
    this.changed()
  }

  private chooseTarget(id?: string): void {
    const view = this.latestForAction()
    if (!view?.game || !canThreeInput(view, this.presentedActor) || this.menuOpen || this.preview) return
    const game = view.game
    const action = game.phase === 'main' && this.pendingCardId
      ? resolveTargetedPlayLandAction(game, this.pendingCardId, id)
      : game.phase === 'plains_target' ? resolvePlainsReuseAction(game, id)
        : game.phase === 'swamp_target' ? resolveSwampDiscardAction(game, id) : null
    if (action) this.submit(action)
  }

  private submit(action: GameAction): void {
    const view = this.latestForAction()
    if (!view?.game || !canThreeInput(view, this.presentedActor)
      || this.submittedDecision === this.decision || action.actor !== view.game.actor) return
    const submittedDecision = this.decision
    this.submittedDecision = submittedDecision
    // Keep the picker intact on rejection. Synchronous notifications may
    // already present the next decision, whose picker must not be dismissed.
    this.controller.submitAction(action)
    if (threeDecisionKey(this.controller.getViewModel()) === submittedDecision) {
      this.submittedDecision = null
    } else if (this.decision === submittedDecision) {
      this.pendingCardId = null
      this.phaseDismissed = true
      this.preview = null
    }
    if (!this.disposed) this.changed()
  }

  private changed(): void {
    this.render()
    this.onChange()
  }

  private captureFocus(): SavedFocus | null {
    const active = this.document.activeElement
    if (!active || !('dataset' in active)) return null
    const element = active as HTMLElement
    const editable = element.tagName === 'TEXTAREA' || element.tagName === 'INPUT'
    return {
      element, key: focusKey(element),
      start: editable ? (element as HTMLInputElement).selectionStart : null,
      end: editable ? (element as HTMLInputElement).selectionEnd : null,
    }
  }

  private restoreFocus(saved: SavedFocus | null): boolean {
    if (!saved) return false
    const element = saved.element.isConnected ? saved.element
      : Array.from(this.content.querySelectorAll<HTMLElement>(FOCUSABLE)).find((item) => focusKey(item) === saved.key)
    if (!element || element.hasAttribute('disabled') || element.closest('[hidden]')) return false
    element.focus({ preventScroll: true })
    if (saved.start !== null && saved.end !== null && (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT')) {
      (element as HTMLInputElement).setSelectionRange(saved.start, saved.end)
    }
    return true
  }

  private render(): void {
    if (this.disposed || !this.view) return
    const blocked = this.isBlocked()
    if (blocked && !this.blocked) this.onBlock()
    this.blocked = blocked
    const markup = renderThreeInterface(this.view, this.ui())
    if (markup === this.markup) return
    const focus = this.captureFocus()
    const scroll = new Map<string, [number, number]>()
    const details = new Map<string, boolean>()
    this.content.querySelectorAll<HTMLElement>('[data-scroll-key], [data-modal], textarea[id]').forEach((element) => {
      scroll.set(element.dataset.scrollKey ?? element.dataset.modal ?? element.id, [element.scrollLeft, element.scrollTop])
    })
    this.content.querySelectorAll<HTMLDetailsElement>('[data-detail-key]').forEach((element) => details.set(element.dataset.detailKey!, element.open))
    const oldModal = this.modalKind
    const oldInlineTarget = this.inlineTargetOpen
    const hostScroll = [this.host.scrollLeft, this.host.scrollTop]
    const oldDialog = this.content.querySelector<HTMLDialogElement>('dialog')
    if (oldDialog?.open && typeof oldDialog.close === 'function') oldDialog.close()
    this.content.innerHTML = markup
    this.markup = markup
    this.host.scrollLeft = hostScroll[0]
    this.host.scrollTop = hostScroll[1]
    this.content.querySelectorAll<HTMLElement>('[data-scroll-key], [data-modal], textarea[id]').forEach((element) => {
      const position = scroll.get(element.dataset.scrollKey ?? element.dataset.modal ?? element.id)
      if (position) [element.scrollLeft, element.scrollTop] = position
    })
    this.content.querySelectorAll<HTMLDetailsElement>('[data-detail-key]').forEach((element) => {
      const open = details.get(element.dataset.detailKey!)
      if (open !== undefined) element.open = open
    })
    const dialog = this.content.querySelector<HTMLDialogElement>('dialog')
    this.modalKind = dialog?.dataset.modal ?? null
    this.inlineTargetOpen = !!this.content.querySelector('.three-target-panel')
    if (dialog) {
      if (!oldModal && !oldInlineTarget) this.returnFocus = focus
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      if (oldModal === this.modalKind && focus && this.restoreFocus(focus) && dialog.contains(this.document.activeElement)) return
      ;(dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus({ preventScroll: true })
    } else if (this.inlineTargetOpen && !oldInlineTarget) {
      if (!oldModal) this.returnFocus = focus
      this.content.querySelector<HTMLElement>('[data-action="target"]')?.focus({ preventScroll: true })
    } else if (oldModal || oldInlineTarget && !this.inlineTargetOpen) {
      if (!this.restoreFocus(this.returnFocus)) this.content.querySelector<HTMLElement>('[data-action="menu"], [data-mode]')?.focus({ preventScroll: true })
      this.returnFocus = null
    } else if (focus && this.host.contains(focus.element)) {
      this.restoreFocus(focus)
    } else if (focus && !focus.element.isConnected) {
      this.restoreFocus(focus)
    }
  }

  private close(): void {
    if (!this.menuOpen && !this.preview && !this.pendingCardId && this.phaseDismissed) return
    if (this.menuOpen) this.menuOpen = false
    else if (this.preview) this.preview = null
    else {
      this.pendingCardId = null
      this.phaseDismissed = true
    }
    this.changed()
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (this.disposed) return
    if (event.key === 'Escape' && this.isBlocked()) {
      event.preventDefault()
      this.close()
      return
    }
    const dialog = this.content.querySelector<HTMLElement>('dialog')
    if (event.key !== 'Tab' || !dialog) return
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = items[0] ?? dialog
    const last = items[items.length - 1] ?? dialog
    if (!dialog.contains(this.document.activeElement) || event.shiftKey && this.document.activeElement === first
      || !event.shiftKey && (this.document.activeElement === last || this.document.activeElement === dialog)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }

  private readonly handleFocusIn = (event: FocusEvent): void => {
    const dialog = this.content.querySelector<HTMLElement>('dialog[open]')
    if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
      ;(dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus({ preventScroll: true })
    }
  }

  private readonly handleCancel = (event: Event): void => {
    event.preventDefault()
    this.close()
  }

  private readonly handleInput = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement)) return
    if (target.id === 'answer-text') this.hostAnswerDraft = target.value
    if (target.id === 'join-offer-text') this.joinOfferDraft = target.value
  }

  private readonly handleChange = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLSelectElement)) return
    const value = target.value
    switch (target.id) {
      case 'ai-level-select': if (isAiLevel(value)) this.controller.setAiLevel(value); break
      case 'card-visual-style-select': if (isCardVisualStyle(value)) this.controller.setCardVisualStyle(value); break
      case 'animation-speed-select': if (isAnimationSpeed(value)) this.controller.setAnimationSpeed(value); break
      case 'board-theme-select': if (isBoardTheme(value)) this.controller.setBoardTheme(value); break
      case 'render-quality-select': if (isRenderQualityPreference(value)) this.controller.setRenderQualityPreference(value); break
      default: break
    }
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.disposed || !(event.target instanceof Element)) return
    const element = event.target.closest<HTMLElement>('button')
    if (!element || !this.host.contains(element) || element.hasAttribute('disabled')) return
    const modal = this.content.querySelector('dialog')
    if (modal && !modal.contains(element)) return
    const mode = element.dataset.mode
    if (isThreeMode(mode)) {
      this.reset()
      if (mode === 'adventure-hvai') this.controller.startAdventure()
      else this.controller.startGame(mode)
      return
    }
    const action = element.dataset.action ?? element.id
    const view = this.latestForAction()
    if (!view) return
    switch (action) {
      case 'menu':
        this.pendingCardId = null
        this.preview = null
        this.menuOpen = true
        this.changed()
        break
      case 'close': this.close(); break
      case 'resume-target': this.phaseDismissed = false; this.changed(); break
      case 'play': if (element.dataset.cardId) this.playCard(element.dataset.cardId); break
      case 'respond-card': {
        const owner = element.dataset.owner === '0' ? 0 : element.dataset.owner === '1' ? 1 : null
        if (owner !== null && element.dataset.cardId) this.respondWithCard(element.dataset.cardId, owner)
        break
      }
      case 'target': this.chooseTarget(element.dataset.targetId); break
      case 'preview': {
        const owner = element.dataset.owner === '0' ? 0 : element.dataset.owner === '1' ? 1 : null
        const zone = element.dataset.zone
        if (owner === null || (zone !== 'hand' && zone !== 'battlefield') || !element.dataset.cardId) break
        this.previewCard({ key: '', cardId: element.dataset.cardId, instanceId: element.dataset.instanceId, name: '', owner, zone, playable: false })
        break
      }
      case 'resume-adventure': this.reset(); this.controller.resumeAdventure(); break
      case 'pause-adventure': this.reset(); this.controller.pauseAdventure(); break
      case 'abandon-adventure': this.reset(); this.controller.abandonAdventure(); break
      case 'back-to-lobby': this.reset(); this.controller.backToLobby(); break
      case 'rematch': this.reset(); this.controller.rematch(); break
      case 'create-offer': this.runAsync(() => this.controller.createOffer(), 'Failed to create offer.'); break
      case 'accept-answer': this.runAsync(() => this.controller.acceptAnswer(this.hostAnswerDraft), 'Failed to accept answer.'); break
      case 'create-answer': this.runAsync(() => this.controller.createAnswer(this.joinOfferDraft), 'Failed to create answer.'); break
      case 'start-p2p-game': if (view.mode === 'p2p-host' && view.p2pConnected && !view.p2pStarted) this.controller.startP2PGame(); break
      case 'install-app': this.runAsync(() => promptInstall(), 'Failed to install app.'); break
      case 'save-recording-download': if (view.recording.canSave) this.download(); break
      case 'save-recording-local': if (view.recording.canSave) this.controller.saveRecordingToLocalStorage(); break
      case 'load-recording-local': if (view.recording.canLoadLocal) { this.reset(); this.controller.loadRecordingFromLocalStorage() }; break
      case 'load-recording-file': this.fileInput.click(); break
      case 'replay-start': if (view.recording.canSave) { this.reset(); this.controller.startReplay() }; break
      case 'replay-playpause': if (view.replay.active) { if (view.replay.isPlaying) this.controller.pauseReplay(); else this.controller.startReplay() }; break
      case 'replay-prev': if (view.replay.active && view.replay.step > 0) this.controller.stepReplay(-1); break
      case 'replay-next': if (view.replay.active && view.replay.step < view.replay.totalSteps) this.controller.stepReplay(1); break
      case 'replay-end': if (view.replay.active) this.controller.jumpReplayToEnd(); break
      case 'replay-exit': if (view.replay.active) { this.reset(); this.controller.exitReplay() }; break
      default: break
    }
  }

  private runAsync(operation: () => Promise<unknown>, errorMessage: string): void {
    const generation = this.fileGeneration
    const fail = (): void => {
      if (!this.disposed && generation === this.fileGeneration) this.controller.reportStatus(errorMessage)
    }
    try {
      void operation().catch(fail)
    } catch {
      fail()
    }
  }

  private readonly handleFile = async (): Promise<void> => {
    const file = this.fileInput.files?.[0]
    if (!file) return
    let generation = ++this.fileGeneration
    try {
      const text = await file.text()
      if (this.disposed || generation !== this.fileGeneration) return
      this.reset()
      generation = this.fileGeneration
      this.controller.importRecordingJson(text)
    } catch {
      if (!this.disposed && generation === this.fileGeneration) this.controller.reportStatus('Failed to read or import recording file.')
    } finally {
      if (!this.disposed && generation === this.fileGeneration) this.fileInput.value = ''
    }
  }

  private download(): void {
    let url: string | null = null
    let link: HTMLAnchorElement | null = null
    try {
      const payload = this.controller.exportRecordingJson()
      if (payload === null) return
      url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
      link = this.document.createElement('a')
      link.href = url
      link.download = `cardgame-recording-${Date.now()}.json`
      this.host.append(link)
      link.click()
      const downloadUrl = url
      this.downloadTimers.set(url, setTimeout(() => {
        URL.revokeObjectURL(downloadUrl)
        this.downloadTimers.delete(downloadUrl)
      }, 1000))
    } catch {
      if (url) URL.revokeObjectURL(url)
      this.controller.reportStatus('Failed to export recording file.')
    } finally {
      link?.remove()
    }
  }

  reset(): void {
    if (this.disposed) return
    this.fileGeneration += 1
    this.fileInput.value = ''
    this.menuOpen = false
    this.pendingCardId = null
    this.phaseDismissed = true
    this.preview = null
    this.hostAnswerDraft = ''
    this.joinOfferDraft = ''
    this.submittedDecision = null
    this.render()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.fileGeneration += 1
    this.host.removeEventListener('click', this.handleClick)
    this.host.removeEventListener('change', this.handleChange)
    this.host.removeEventListener('input', this.handleInput)
    this.host.removeEventListener('cancel', this.handleCancel, true)
    this.document.removeEventListener('keydown', this.handleKeydown)
    this.document.removeEventListener('focusin', this.handleFocusIn)
    this.fileInput.removeEventListener('change', this.handleFile)
    for (const [url, timer] of this.downloadTimers) {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
    }
    this.downloadTimers.clear()
    const dialog = this.content.querySelector<HTMLDialogElement>('dialog')
    if (dialog?.open && typeof dialog.close === 'function') dialog.close()
    this.content.remove()
    this.fileInput.remove()
    this.host.classList.remove('three-interface')
    this.view = null
    this.preview = null
    this.pendingCardId = null
    this.returnFocus = null
  }
}
