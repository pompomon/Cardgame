import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  resize: vi.fn(),
  removeResizeSync: vi.fn(),
  resizeCallback: null as ((size: { width: number; height: number }) => void) | null,
}))

vi.mock('phaser', () => ({
  default: {
    AUTO: 'auto',
    Scale: {
      RESIZE: 'resize',
      CENTER_BOTH: 'center-both',
    },
    Game: class {
      readonly scale = { resize: mocks.resize }
      readonly destroy = mocks.destroy
    },
  },
}))

vi.mock('../renderers/phaser/viewport-resize', () => ({
  installViewportResizeSync: vi.fn((
    _host: HTMLElement,
    callback: (size: { width: number; height: number }) => void,
  ) => {
    mocks.resizeCallback = callback
    return mocks.removeResizeSync
  }),
}))

import { createSceneHost } from '../renderers/phaser/scene-host'

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mocks.resizeCallback = null
})

describe('Phaser scene host lifecycle', () => {
  it('forwards settled viewport sizes and disposes the game exactly once', () => {
    const canvasHost = {
      className: '',
      clientWidth: 640,
      clientHeight: 360,
    }
    const container = {
      appendChild: vi.fn(),
    }
    vi.stubGlobal('document', {
      createElement: vi.fn(() => canvasHost),
    })
    const onResize = vi.fn()
    const host = createSceneHost({
      container: container as unknown as HTMLElement,
      scenes: [],
      onResize,
    })

    mocks.resizeCallback?.({ width: 800, height: 450 })
    host.dispose()
    host.dispose()

    expect(container.appendChild).toHaveBeenCalledWith(canvasHost)
    expect(onResize).toHaveBeenCalledWith({ width: 800, height: 450 })
    expect(mocks.resize).toHaveBeenCalledWith(800, 450)
    expect(mocks.removeResizeSync).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledWith(true)
  })
})
