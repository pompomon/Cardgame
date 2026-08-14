import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({
  default: {
    Loader: {
      Events: {
        FILE_LOAD_ERROR: 'loaderror',
        COMPLETE: 'complete',
      },
    },
  },
}))

import {
  clearFailedCardArtUrls,
  preloadCardArt,
} from '../renderers/phaser/card-art-loader'

type Listener = (file?: { key?: string; src?: string }) => void

function createScene(): {
  scene: unknown
  image: ReturnType<typeof vi.fn>
  emit(event: string, file?: { key?: string; src?: string }): void
  listenerCount(event: string): number
} {
  const listeners = new Map<string, Set<Listener>>()
  const image = vi.fn()
  const loader = {
    image,
    on: (event: string, listener: Listener) => {
      const entries = listeners.get(event) ?? new Set()
      entries.add(listener)
      listeners.set(event, entries)
    },
    once: (event: string, listener: Listener) => {
      const onceListener: Listener = (file) => {
        listeners.get(event)?.delete(onceListener)
        listener(file)
      }
      const entries = listeners.get(event) ?? new Set()
      entries.add(onceListener)
      listeners.set(event, entries)
    },
    off: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener)
    },
  }
  return {
    scene: {
      load: loader,
      textures: { exists: () => false },
    },
    image,
    emit: (event, file) => {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(file)
      }
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
  }
}

describe('Phaser card-art loading', () => {
  beforeEach(() => {
    clearFailedCardArtUrls()
    vi.restoreAllMocks()
  })

  it('suppresses failed URLs across scene loads until recovery clears them', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = createScene()
    const firstHandle = preloadCardArt(first.scene as never, 'classic')
    const failedCall = first.image.mock.calls.find(([key]) => key === 'card-art:classic:Forest')
    expect(failedCall).toBeDefined()

    first.emit('loaderror', {
      key: 'card-art:classic:Forest',
      src: failedCall?.[1],
    })
    first.emit('complete')
    expect(firstHandle?.isActive()).toBe(false)
    expect(warning).toHaveBeenCalledOnce()

    const second = createScene()
    preloadCardArt(second.scene as never, 'classic')
    expect(second.image.mock.calls.some(([key]) => key === 'card-art:classic:Forest')).toBe(false)

    clearFailedCardArtUrls()
    const recovered = createScene()
    preloadCardArt(recovered.scene as never, 'classic')
    expect(recovered.image.mock.calls.some(([key]) => key === 'card-art:classic:Forest')).toBe(true)
  })

  it('disposes loader listeners idempotently', () => {
    const harness = createScene()
    const handle = preloadCardArt(harness.scene as never, 'classic')

    expect(harness.listenerCount('loaderror')).toBe(1)
    expect(harness.listenerCount('complete')).toBe(1)
    handle?.dispose()
    handle?.dispose()

    expect(handle?.isActive()).toBe(false)
    expect(harness.listenerCount('loaderror')).toBe(0)
    expect(harness.listenerCount('complete')).toBe(0)
  })
})
