import type { ControllerApi } from '../app/controller'
import type { AppViewModel } from '../app/types'
import type { AppRenderer } from './types'

export type RendererLoader = (
  onFailure: (message: string) => void,
) => Promise<AppRenderer>

export const loadRenderer: RendererLoader = async (onFailure) => {
  const { ThreeRenderer } = await import('./three')
  return new ThreeRenderer(onFailure)
}

export class RendererHost {
  private readonly container: HTMLElement
  private readonly controller: ControllerApi
  private readonly loader: RendererLoader
  private renderer: AppRenderer | null = null
  private currentView: AppViewModel | null = null
  private generation = 0
  private disposed = false

  constructor(
    container: HTMLElement,
    controller: ControllerApi,
    loader: RendererLoader = loadRenderer,
  ) {
    this.container = container
    this.controller = controller
    this.loader = loader
  }

  async start(): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    this.unmountRenderer()

    const loading = document.createElement('p')
    loading.setAttribute('role', 'status')
    loading.textContent = 'Loading Three.js renderer…'
    this.container.replaceChildren(loading)

    try {
      const renderer = await this.loader((message) => {
        queueMicrotask(() => this.showFailure(generation, message))
      })
      if (this.disposed || generation !== this.generation) {
        renderer.unmount()
        return
      }
      this.renderer = renderer
      renderer.mount(this.container, this.controller)
      this.refresh()
    } catch {
      this.showFailure(generation, 'The Three.js renderer could not load or initialize.')
    }
  }

  render(view: AppViewModel): void {
    this.currentView = view
    this.refresh()
  }

  refresh(): void {
    if (!this.renderer || !this.currentView || this.disposed) return
    const generation = this.generation
    try {
      this.renderer.render(this.currentView)
    } catch {
      this.showFailure(generation, 'The Three.js renderer stopped unexpectedly.')
    }
  }

  private showFailure(generation: number, message: string): void {
    if (this.disposed || generation !== this.generation) return
    ++this.generation
    this.unmountRenderer()

    const panel = document.createElement('section')
    panel.className = 'renderer-failure'
    panel.setAttribute('role', 'alert')
    panel.setAttribute('aria-labelledby', 'renderer-failure-title')

    const title = document.createElement('h1')
    title.id = 'renderer-failure-title'
    title.textContent = 'WebGL2 renderer unavailable'

    const reason = document.createElement('p')
    reason.textContent = message

    const preservation = document.createElement('p')
    preservation.textContent = 'Your current game is preserved in memory. Retry the renderer or reload the page.'

    const actions = document.createElement('div')
    actions.className = 'renderer-failure__actions'

    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = 'Retry renderer'
    retry.addEventListener('click', () => {
      void this.start()
    }, { once: true })

    const reload = document.createElement('button')
    reload.type = 'button'
    reload.textContent = 'Reload page'
    reload.addEventListener('click', () => {
      window.location.reload()
    }, { once: true })

    actions.append(retry, reload)
    panel.append(title, reason, preservation, actions)
    this.container.replaceChildren(panel)
    retry.focus()
  }

  private unmountRenderer(): void {
    try {
      this.renderer?.unmount()
    } catch {
      // Graphics teardown is best-effort after initialization or context failure.
    }
    this.renderer = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    ++this.generation
    this.unmountRenderer()
    this.currentView = null
  }
}
