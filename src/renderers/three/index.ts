import type { ControllerApi } from '../../app/controller'
import { prefersReducedMotion } from '../../app/animation-settings'
import type { AppViewModel } from '../../app/types'
import type { AppRenderer } from '../types'
import { ThreeBoard } from './board'
import { ThreeEffects, presentationBoundary } from './effects'
import { ThreeInterface } from './interface'
import { threeSessionKey } from './interface-model'
import { ThreeInteraction } from './interaction'
import './renderer.css'

export class ThreeRenderer implements AppRenderer {
  private readonly onFailure: (message: string) => void
  private container: HTMLElement | null = null
  private stage: HTMLElement | null = null
  private board: ThreeBoard | null = null
  private ui: ThreeInterface | null = null
  private interaction: ThreeInteraction | null = null
  private effects: ThreeEffects | null = null
  private view: AppViewModel | null = null
  private presentedView: AppViewModel | null = null
  private motionQuery: MediaQueryList | null = null

  constructor(onFailure: (message: string) => void = () => {}) {
    this.onFailure = onFailure
  }

  mount(container: HTMLElement, controller: ControllerApi): void {
    this.unmount()
    this.container = container
    container.classList.add('three-root')
    const stage = document.createElement('section')
    stage.className = 'three-stage'
    stage.setAttribute('aria-label', 'Three-dimensional card table')
    const controls = document.createElement('section')
    controls.className = 'three-controls'
    const hud = document.createElement('section')
    hud.className = 'three-hud-mount'
    hud.hidden = true
    container.replaceChildren(hud, stage, controls)
    this.stage = stage
    try {
      this.board = new ThreeBoard(stage, this.onFailure, () => this.interaction?.cancel(),
        (action) => this.ui?.activatePrimaryAction(action))
      this.ui = new ThreeInterface(controls, controller, this.refresh, () => this.interaction?.cancel(), hud)
      this.interaction = new ThreeInteraction(
        this.board,
        () => this.stage?.hidden ? null : this.presentedView,
        () => this.ui?.isBlocked() ?? true,
        (cardId) => this.ui?.playCard(cardId),
        (hit) => this.ui?.activate(hit),
        (hit) => this.ui?.setHover(hit),
      )
      this.effects = new ThreeEffects(
        (effect, duration, done) => this.board!.playEffect(effect, duration, done),
        this.refresh,
        (ids) => this.board?.retainEffectTargets(ids),
      )
      document.addEventListener('visibilitychange', this.refresh)
      this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
      if (this.motionQuery?.addEventListener) this.motionQuery.addEventListener('change', this.refresh)
      else this.motionQuery?.addListener(this.refresh)
    } catch (error) {
      this.unmount()
      throw error
    }
  }

  render(view: AppViewModel): void {
    if (!this.board || !this.ui) return
    if (presentationBoundary(this.view, view)) {
      this.interaction?.cancel()
      // A lobby status/settings update is an effects boundary, not a new UI
      // session: resetting here would erase P2P drafts and close subviews.
      if (this.view && (this.view.game && view.game || threeSessionKey(this.view) !== threeSessionKey(view))) {
        this.ui.reset(this.view.replay.active && view.replay.active
          && threeSessionKey(this.view) === threeSessionKey(view))
      }
    }
    this.view = view
    const inGame = !!view.game
      && (!(view.mode === 'p2p-host' || view.mode === 'p2p-join') || view.p2pStarted)
    const effectView = inGame ? view : { ...view, game: null }
    const actor = this.effects?.update(effectView, document.hidden || prefersReducedMotion()) ?? 0
    this.presentedView = view.game && actor !== view.game.actor
      ? { ...view, game: { ...view.game, canInput: false } }
      : view
    if (this.stage) this.stage.hidden = !inGame
    this.board.setVisible(inGame && !document.hidden)
    this.ui.update(this.presentedView, actor)
    this.board.render(inGame ? this.presentedView : effectView, actor,
      this.ui.targetIds, this.ui.response, this.ui.primaryAction, this.ui.isBlocked())
    this.interaction?.reconcile()
    this.effects?.pump()
  }

  private readonly refresh = (): void => {
    if (this.view) this.render(this.view)
  }

  unmount(): void {
    document.removeEventListener('visibilitychange', this.refresh)
    if (this.motionQuery?.removeEventListener) this.motionQuery.removeEventListener('change', this.refresh)
    else this.motionQuery?.removeListener(this.refresh)
    this.motionQuery = null
    this.interaction?.dispose()
    this.effects?.dispose()
    this.ui?.dispose()
    this.board?.dispose()
    this.interaction = null
    this.effects = null
    this.ui = null
    this.board = null
    this.container?.classList.remove('three-root')
    this.container?.replaceChildren()
    this.container = null
    this.stage = null
    this.view = null
    this.presentedView = null
  }
}
