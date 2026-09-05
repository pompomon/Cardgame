import type { ControllerApi } from '../app/controller'
import type { AppViewModel, RendererKind } from '../app/types'
import { DomRenderer } from './dom'
import type { AppRenderer } from './types'

export type RendererLoader = (
  kind: RendererKind,
  onFailure: (message: string) => void,
) => Promise<AppRenderer>

export const loadRenderer: RendererLoader = async (kind, onFailure) => {
  switch (kind) {
    case 'three': {
      const { ThreeRenderer } = await import('./three')
      return new ThreeRenderer(onFailure)
    }
    case 'phaser': {
      const { PhaserRenderer } = await import('./phaser')
      return new PhaserRenderer()
    }
    default:
      return new DomRenderer()
  }
}

// The controller survives renderer failures, including an in-progress P2P game.
// The persisted preference stays intact; only the rendered projection changes.
export class RendererHost {
  private readonly container: HTMLElement
  private readonly controller: ControllerApi
  private readonly loader: RendererLoader
  private readonly fallback: () => AppRenderer
  private renderer: AppRenderer | null = null
  private currentView: AppViewModel | null = null
  private kind: RendererKind = 'dom'
  private generation = 0
  private disposed = false

  constructor(
    container: HTMLElement,
    controller: ControllerApi,
    loader: RendererLoader = loadRenderer,
    fallback: () => AppRenderer = () => new DomRenderer(),
  ) {
    this.container = container
    this.controller = controller
    this.loader = loader
    this.fallback = fallback
  }

  async start(kind: RendererKind): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    this.renderer?.unmount()
    this.renderer = null
    this.kind = kind
    const loading = document.createElement('p')
    loading.setAttribute('role', 'status')
    loading.textContent = 'Loading renderer…'
    this.container.replaceChildren(loading)
    try {
      const renderer = await this.loader(kind, (message) => {
        // A graphics callback may fire while its own render stack is active.
        queueMicrotask(() => this.useFallback(generation, message))
      })
      if (this.disposed || generation !== this.generation) {
        renderer.unmount()
        return
      }
      this.renderer = renderer
      renderer.mount(this.container, this.controller)
      this.refresh()
    } catch {
      this.useFallback(generation, 'The graphics renderer could not load or initialize.')
    }
  }

  render(view: AppViewModel): void {
    this.currentView = view
    this.refresh()
  }

  refresh(): void {
    if (!this.renderer || !this.currentView || this.disposed) return
    try {
      this.renderer.render({ ...this.currentView, renderer: this.kind })
    } catch (error) {
      if (this.kind === 'dom') throw error
      this.useFallback(this.generation, 'The graphics renderer stopped unexpectedly.')
    }
  }

  private useFallback(generation: number, message: string): void {
    if (this.disposed || generation !== this.generation || this.kind === 'dom') return
    ++this.generation
    try {
      this.renderer?.unmount()
    } catch {
      // A lost graphics context must not prevent the accessible fallback.
    }
    this.renderer = null
    this.container.replaceChildren()
    this.kind = 'dom'
    this.renderer = this.fallback()
    this.renderer.mount(this.container, this.controller)
    this.controller.reportStatus(`${message} Using the DOM renderer; your game is preserved.`)
    this.refresh()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    ++this.generation
    this.renderer?.unmount()
    this.renderer = null
    this.currentView = null
  }
}
