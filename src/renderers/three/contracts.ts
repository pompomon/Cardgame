import type { AppViewModel } from '../../app/types'
import type { CounterHandOptions } from '../../app/response-options'
import type { VisualEffectDescriptor } from '../../app/visual-effects'

export interface BoardHit {
  readonly key: string
  readonly cardId: string
  readonly instanceId?: string
  readonly name: string
  readonly owner: number
  readonly zone: 'hand' | 'battlefield'
  readonly playable: boolean
}

export interface ThreeBoardApi {
  readonly canvas: HTMLCanvasElement
  render(view: AppViewModel, presentedActor: number, targetIds: ReadonlySet<string>, response: CounterHandOptions | null): void
  hitTest(clientX: number, clientY: number): BoardHit | null
  containsDrop(clientX: number, clientY: number): boolean
  beginDrag(hit: BoardHit): void
  moveDrag(clientX: number, clientY: number, touch: boolean): void
  endDrag(animateReturn: boolean): void
  playEffect(effect: VisualEffectDescriptor, duration: number, done: () => void): () => void
  setVisible(visible: boolean): void
  dispose(): void
}
