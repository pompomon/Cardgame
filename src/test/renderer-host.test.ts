import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControllerApi } from '../app/controller'
import type { AppViewModel } from '../app/types'
import { RendererHost } from '../renderers/host'
import type { AppRenderer } from '../renderers/types'

class FakeElement {
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly listeners = new Map<string, Set<() => void>>()
  className = ''
  id = ''
  type = ''
  textContent = ''
  focused = false

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children)
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0
    this.children.push(...children)
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener()
  }

  focus(): void {
    this.focused = true
  }
}

function findByText(root: FakeElement, text: string): FakeElement | undefined {
  if (root.textContent === text) return root
  return root.children.map((child) => findByText(child, text)).find(Boolean)
}

function renderer(): AppRenderer {
  return { mount: vi.fn(), render: vi.fn(), unmount: vi.fn() }
}

function fixture() {
  vi.stubGlobal('document', { createElement: () => new FakeElement() })
  const container = new FakeElement()
  const controller = { reportStatus: vi.fn() } as unknown as ControllerApi
  const view = { status: '', seed: 42, game: { turn: 3 } } as AppViewModel
  return { container, controller, view }
}

afterEach(() => vi.unstubAllGlobals())

describe('renderer host', () => {
  it('delivers the latest snapshot after asynchronous loading', async () => {
    const { container, controller, view } = fixture()
    const graphics = renderer()
    let resolve!: (value: AppRenderer) => void
    const host = new RendererHost(
      container as unknown as HTMLElement,
      controller,
      () => new Promise((done) => { resolve = done }),
    )
    const start = host.start()
    host.render(view)
    const latest = { ...view, seed: 43 }
    host.render(latest)
    resolve(graphics)
    await start
    expect(graphics.mount).toHaveBeenCalledWith(container, controller)
    expect(graphics.render).toHaveBeenCalledExactlyOnceWith(latest)
    host.dispose()
    host.dispose()
    expect(graphics.unmount).toHaveBeenCalledOnce()
  })

  it('shows an accessible failure and retries with the preserved snapshot', async () => {
    const { container, controller, view } = fixture()
    const graphics = renderer()
    let attempts = 0
    const host = new RendererHost(container as unknown as HTMLElement, controller, async () => {
      attempts += 1
      if (attempts === 1) throw new Error('offline chunk')
      return graphics
    })
    host.render(view)
    await host.start()

    const panel = container.children[0]!
    expect(panel.attributes.get('role')).toBe('alert')
    expect(findByText(panel, 'WebGL2 renderer unavailable')).toBeDefined()
    const retry = findByText(panel, 'Retry renderer')!
    expect(retry.focused).toBe(true)
    retry.click()
    await vi.waitFor(() => expect(graphics.mount).toHaveBeenCalledWith(container, controller))
    expect(graphics.render).toHaveBeenCalledWith(view)
    expect(controller.reportStatus).not.toHaveBeenCalled()
  })

  it('handles duplicate runtime failure callbacks only once', async () => {
    const { container, controller, view } = fixture()
    const graphics = renderer()
    let fail!: (message: string) => void
    const host = new RendererHost(container as unknown as HTMLElement, controller, async (onFailure) => {
      fail = onFailure
      return graphics
    })
    host.render(view)
    await host.start()
    fail('Context lost.')
    fail('Context lost again.')
    await Promise.resolve()
    expect(graphics.unmount).toHaveBeenCalledOnce()
    expect(container.children[0]?.attributes.get('role')).toBe('alert')
  })

  it('cleans partial initialization when mounting throws', async () => {
    const { container, controller, view } = fixture()
    const graphics = renderer()
    graphics.mount = vi.fn(() => { throw new Error('No WebGL2') })
    const host = new RendererHost(container as unknown as HTMLElement, controller, async () => graphics)
    host.render(view)
    await host.start()
    expect(graphics.unmount).toHaveBeenCalledOnce()
    expect(container.children[0]?.attributes.get('role')).toBe('alert')
  })

  it('moves to recovery when rendering throws', async () => {
    const { container, controller, view } = fixture()
    const graphics = renderer()
    graphics.render = vi.fn(() => { throw new Error('render failed') })
    const host = new RendererHost(container as unknown as HTMLElement, controller, async () => graphics)
    host.render(view)
    await host.start()
    expect(graphics.unmount).toHaveBeenCalledOnce()
    expect(findByText(container, 'The Three.js renderer stopped unexpectedly.')).toBeDefined()
  })

  it('discards a late load after disposal', async () => {
    const { container, controller } = fixture()
    const graphics = renderer()
    let resolve!: (value: AppRenderer) => void
    const host = new RendererHost(
      container as unknown as HTMLElement,
      controller,
      () => new Promise((done) => { resolve = done }),
    )
    const start = host.start()
    host.dispose()
    resolve(graphics)
    await start
    expect(graphics.mount).not.toHaveBeenCalled()
    expect(graphics.unmount).toHaveBeenCalledOnce()
  })
})
