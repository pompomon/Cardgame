import type { ControllerKind } from './types'

export const STARTING_PLAYER_INDEX = 0

type Controllers = readonly [ControllerKind, ControllerKind]

export interface BoardPlayerSlots {
  nearIndex: number
  farIndex: number
  nearIsActive: boolean
  farIsActive: boolean
}

export function hasAiController(controllers: Controllers): boolean {
  return controllers[0] === 'ai' || controllers[1] === 'ai'
}

export function boardActorFor(actor: number, controllers: Controllers): number {
  return hasAiController(controllers) ? STARTING_PLAYER_INDEX : actor
}

export function resolveBoardPlayerSlots(presentedActor: number, activeActor: number): BoardPlayerSlots {
  const farIndex = presentedActor === 0 ? 1 : 0
  return {
    nearIndex: presentedActor,
    farIndex,
    nearIsActive: presentedActor === activeActor,
    farIsActive: farIndex === activeActor,
  }
}

export class BoardPresentationCoordinator {
  private displayedActor: number | null = null
  private pendingActor: number | null = null

  resolve(
    actor: number,
    controllers: Controllers,
    effectsBusy: boolean,
    animationsEnabled: boolean,
  ): number {
    if (hasAiController(controllers)) {
      this.displayedActor = STARTING_PLAYER_INDEX
      this.pendingActor = null
      return STARTING_PLAYER_INDEX
    }
    if (this.displayedActor === null) {
      this.displayedActor = actor
      return actor
    }
    if (!animationsEnabled || !effectsBusy) {
      this.displayedActor = actor
      this.pendingActor = null
      return actor
    }
    this.pendingActor = actor === this.displayedActor ? null : actor
    return this.displayedActor
  }

  effectsDrained(): boolean {
    if (this.pendingActor === null || this.pendingActor === this.displayedActor) {
      this.pendingActor = null
      return false
    }
    this.displayedActor = this.pendingActor
    this.pendingActor = null
    return true
  }

  currentActor(fallback: number, controllers: Controllers): number {
    return boardActorFor(this.displayedActor ?? fallback, controllers)
  }

  reset(actor: number | null = null, controllers?: Controllers): void {
    this.displayedActor = actor === null || controllers === undefined
      ? actor
      : boardActorFor(actor, controllers)
    this.pendingActor = null
  }
}
