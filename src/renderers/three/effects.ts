import { durationMsForSpeed, MAX_QUEUED_EFFECTS } from '../../app/animation-settings'
import { BoardPresentationCoordinator } from '../../app/board-presentation'
import type { AppViewModel } from '../../app/types'
import { visualEffectForEvent, type VisualEffectDescriptor } from '../../app/visual-effects'
import type { LogEvent } from '../../game/types'

export type EffectPlayback = (
  effect: VisualEffectDescriptor, duration: number, done: () => void,
) => () => void

export function presentationBoundary(previous: AppViewModel | null, next: AppViewModel): boolean {
  if (!previous || !previous.game || !next.game) return true
  if (previous.seed !== next.seed || previous.mode !== next.mode
    || previous.replay.active !== next.replay.active
    || (next.replay.active && next.replay.step < previous.replay.step)) return true
  const oldEvents = previous.game.events
  const events = next.game.events
  return events.length < oldEvents.length
    || (oldEvents.length > 0
      && JSON.stringify(oldEvents.at(-1)) !== JSON.stringify(events[oldEvents.length - 1]))
}

export class ThreeEffects {
  private readonly play: EffectPlayback
  private readonly onSettled: () => void
  private readonly presentation = new BoardPresentationCoordinator()
  private view: AppViewModel | null = null
  private queue: LogEvent[] = []
  private cancelPlaying: (() => void) | null = null
  private playing = false
  private generation = 0
  private suppressed = false
  private cursor = 0

  constructor(play: EffectPlayback, onSettled: () => void) {
    this.play = play
    this.onSettled = onSettled
  }

  update(view: AppViewModel, suppressed: boolean): number {
    const boundary = presentationBoundary(this.view, view)
    this.view = view
    this.suppressed = suppressed || view.animationSpeed === 'off'
    const game = view.game
    if (boundary || this.suppressed || !game) {
      this.clear()
      this.cursor = game?.events.length ?? 0
      if (boundary) this.presentation.reset(game?.actor ?? null, view.controllers)
    } else {
      for (let index = this.cursor; index < game.events.length; index++) {
        const event = game.events[index]
        if (visualEffectForEvent(event, view.cardVisualStyle)) this.queue.push(event)
      }
      this.queue = this.queue.slice(-MAX_QUEUED_EFFECTS)
      this.cursor = game.events.length
    }
    return game
      ? this.presentation.resolve(game.actor, view.controllers, this.playing || this.queue.length > 0, !this.suppressed)
      : 0
  }

  pump(): void {
    const view = this.view
    if (!view?.game || this.playing || this.suppressed) return
    const event = this.queue.shift()
    if (!event) {
      if (this.presentation.effectsDrained()) this.onSettled()
      return
    }
    const effect = visualEffectForEvent(event, view.cardVisualStyle)
    if (!effect) {
      this.pump()
      return
    }
    const generation = this.generation
    this.playing = true
    let completed = false
    const cancel = this.play(effect, durationMsForSpeed(view.animationSpeed), () => {
      if (completed || generation !== this.generation) return
      completed = true
      this.cancelPlaying = null
      this.playing = false
      this.pump()
    })
    if (!completed && generation === this.generation) this.cancelPlaying = cancel
  }

  private clear(): void {
    ++this.generation
    this.cancelPlaying?.()
    this.cancelPlaying = null
    this.playing = false
    this.queue = []
  }

  dispose(): void {
    this.clear()
    this.view = null
    this.cursor = 0
    this.presentation.reset()
  }
}
