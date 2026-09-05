import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControllerApi } from '../app/controller'
import type { AppViewModel } from '../app/types'
import type { AppRenderer } from '../renderers/types'
import { RendererHost } from '../renderers/host'

vi.mock('../renderers/dom', () => ({ DomRenderer: class {} }))

function renderer(): AppRenderer {
  return { mount: vi.fn(), render: vi.fn(), unmount: vi.fn() }
}

function fixture() {
  vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), textContent: '' }) })
  const container = { replaceChildren: vi.fn() } as unknown as HTMLElement
  const controller = { reportStatus: vi.fn() } as unknown as ControllerApi
  const view = { renderer: 'three', status: '', seed: 42, game: { turn: 3 } } as AppViewModel
  return { container, controller, view }
}

afterEach(() => vi.unstubAllGlobals())

describe('renderer host', () => {
  it('delivers the latest snapshot after asynchronous loading', async () => {
    const { container, controller, view } = fixture()
    const graphics = renderer()
    let resolve!: (value: AppRenderer) => void
    const host = new RendererHost(container, controller, () => new Promise((done) => { resolve = done }))
    const start = host.start('three')
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

  it('falls back on load failure without changing the controller or preferred snapshot', async () => {
    const { container, controller, view } = fixture()
    const dom = renderer()
    const host = new RendererHost(container, controller, async () => { throw new Error('offline chunk') }, () => dom)
    host.render(view)
    await host.start('three')
    expect(dom.mount).toHaveBeenCalledWith(container, controller)
    expect(dom.render).toHaveBeenCalledWith({ ...view, renderer: 'dom' })
    expect(view.renderer).toBe('three')
    expect(controller.reportStatus).toHaveBeenCalledWith(expect.stringContaining('game is preserved'))
  })

  it('cleans partial initialization and handles runtime failures only once', async () => {
    const { container, controller, view } = fixture()
    const graphics = renderer()
    const dom = renderer()
    let fail!: (message: string) => void
    const host = new RendererHost(container, controller, async (_kind, onFailure) => {
      fail = onFailure
      return graphics
    }, () => dom)
    host.render(view)
    await host.start('three')
    fail('Context lost.')
    fail('Context lost again.')
    await Promise.resolve()
    expect(graphics.unmount).toHaveBeenCalledOnce()
    expect(dom.mount).toHaveBeenCalledOnce()
    expect(dom.render).toHaveBeenCalledWith(expect.objectContaining({ renderer: 'dom', game: view.game }))
    host.render({ ...view, seed: 100 })
    expect(dom.render).toHaveBeenLastCalledWith(expect.objectContaining({ seed: 100 }))
  })

  it('falls back when mounting throws', async () => {
    const { container, controller, view } = fixture()
    const graphics = renderer()
    graphics.mount = vi.fn(() => { throw new Error('No WebGL2') })
    const dom = renderer()
    const host = new RendererHost(container, controller, async () => graphics, () => dom)
    host.render(view)
    await host.start('three')
    expect(graphics.unmount).toHaveBeenCalledOnce()
    expect(dom.mount).toHaveBeenCalledOnce()
  })

  it('discards a late load after disposal', async () => {
    const { container, controller } = fixture()
    const graphics = renderer()
    let resolve!: (value: AppRenderer) => void
    const host = new RendererHost(container, controller, () => new Promise((done) => { resolve = done }))
    const start = host.start('three')
    host.dispose()
    resolve(graphics)
    await start
    expect(graphics.mount).not.toHaveBeenCalled()
    expect(graphics.unmount).toHaveBeenCalledOnce()
  })
})
