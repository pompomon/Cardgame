export class BoardPresentationCoordinator {
  private displayedActor: number | null = null
  private pendingActor: number | null = null

  resolve(actor: number, effectsBusy: boolean, animationsEnabled: boolean): number {
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

  currentActor(fallback: number): number {
    return this.displayedActor ?? fallback
  }

  reset(actor: number | null = null): void {
    this.displayedActor = actor
    this.pendingActor = null
  }
}
