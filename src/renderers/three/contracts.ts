import type { AppViewModel } from '../../app/types'
import type { CounterHandOptions } from '../../app/response-options'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import type { BasicLand } from '../../game/types'
import type { ThreePrimaryAction } from './interface-model'

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

export interface ThreeBoardApi {
  readonly canvas: HTMLCanvasElement
  render(view: AppViewModel, presentedActor: number, targetIds: ReadonlySet<string>,
    response: CounterHandOptions | null, primaryAction: ThreePrimaryAction | null): void
  hitTest(clientX: number, clientY: number): BoardHit | null
  containsDrop(clientX: number, clientY: number): boolean
  beginDrag(hit: BoardHit): void
  moveDrag(clientX: number, clientY: number, touch: boolean): void
  endDrag(animateReturn: boolean): void
  playEffect(effect: VisualEffectDescriptor, duration: number, done: () => void): () => void
  setVisible(visible: boolean): void
  dispose(): void
}
