import type { AppViewModel } from '../../app/types'
import type { CounterHandOptions } from '../../app/response-options'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import type { BasicLand } from '../../game/types'
import type { ThreePrimaryAction } from './interface-model'
import type { PeekPlacement, ThreeShellProfile } from './layout'

export interface RendererCardIdentity {
  readonly name: string
  readonly serializedKey?: BasicLand
  readonly displayName?: string
  readonly assetSlug?: string
}

export interface BoardHit extends RendererCardIdentity {
  readonly key: string
  readonly cardId: string
  readonly instanceId?: string
  readonly owner: number
  readonly zone: 'hand' | 'battlefield'
  readonly playable: boolean
}

/** Pending touch selections, highlighted on the board until confirmed or cleared. */
export interface ThreeBoardSelection {
  readonly cardId: string | null
  readonly targetId: string | null
  readonly discardId: string | null
}

export interface ThreeBoardPresentation {
  /**
   * The in-game shell. Every touch shell (`narrow`, `dock`, `rail`) uses the
   * typed-slot touch layout, and its primary action lives in the action dock.
   */
  readonly shell: ThreeShellProfile
  /**
   * A short `rail`: a landscape screen too low for stacked rows, such as the
   * cover screen or a phone held sideways. The board then takes the full
   * height beside the rail. Ignored by every other shell.
   */
  readonly short?: boolean
  readonly selection: ThreeBoardSelection
}

export const NO_BOARD_SELECTION: ThreeBoardSelection = Object.freeze({ cardId: null, targetId: null, discardId: null })
export const DEFAULT_BOARD_PRESENTATION: ThreeBoardPresentation = Object.freeze({ shell: 'desktop', selection: NO_BOARD_SELECTION })
/** The action dock's live prompt, which also describes the docked primary button. */
export const THREE_DOCK_PROMPT_ID = 'three-dock-prompt'

/** An open long-press peek: the held card and where its preview opens, in client pixels. */
export interface ThreePeek {
  readonly hit: BoardHit
  readonly placement: PeekPlacement
}

/** A live drag, reported by the board when it starts and whenever its accepted state changes. */
export interface ThreeDragFeedback {
  readonly cardId: string
  /** Releasing now would summon the card. */
  readonly accepted: boolean
}

export interface ThreeBoardApi {
  readonly canvas: HTMLCanvasElement
  render(view: AppViewModel, presentedActor: number, targetIds: ReadonlySet<string>,
    response: CounterHandOptions | null, primaryAction: ThreePrimaryAction | null): void
  hitTest(clientX: number, clientY: number): BoardHit | null
  /** `touch` covers touch and pen, which get drop slop and a lifted card. */
  containsDrop(clientX: number, clientY: number, touch?: boolean): boolean
  beginDrag(hit: BoardHit): void
  moveDrag(clientX: number, clientY: number, touch: boolean): void
  endDrag(animateReturn: boolean): void
  /** Shows the long-press ring under a held finger. */
  showPeekRing(clientX: number, clientY: number): void
  hidePeekRing(): void
  /**
   * Where a peek of `hit` opens for a finger at the given point, or null when
   * it cannot open. `fits` can refuse a side whose room would clip the peek.
   */
  peekPlacement(hit: BoardHit, clientX: number, clientY: number, fits?: (placement: PeekPlacement) => boolean): PeekPlacement | null
  playEffect(effect: VisualEffectDescriptor, duration: number, done: () => void): () => void
  setVisible(visible: boolean): void
  dispose(): void
}
