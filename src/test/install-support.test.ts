import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MediaQueryListLike = {
  matches: boolean
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
  addListener?: (listener: () => void) => void
  removeListener?: (listener: () => void) => void
}

type WindowStubOptions = {
  userAgent?: string
  navigatorStandalone?: boolean
  displayModeStandalone?: boolean
  displayModeFullscreen?: boolean
  matchMediaSupportsAddEventListener?: boolean
}

function setupWindowStub(options: WindowStubOptions = {}): {
  window: EventTarget & { matchMedia: (q: string) => MediaQueryListLike; navigator: { userAgent: string; standalone?: boolean } }
  navigator: { userAgent: string; standalone?: boolean }
} {
  const userAgent = options.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0'
  const navigator: { userAgent: string; standalone?: boolean } = { userAgent }
  if (options.navigatorStandalone !== undefined) {
    navigator.standalone = options.navigatorStandalone
  }

  const matchMedia = (query: string): MediaQueryListLike => {
    let matches = false
    if (query.includes('standalone')) {
      matches = options.displayModeStandalone === true
    } else if (query.includes('fullscreen')) {
      matches = options.displayModeFullscreen === true
    }
    const list: MediaQueryListLike = { matches }
    if (options.matchMediaSupportsAddEventListener !== false) {
      list.addEventListener = () => {}
      list.removeEventListener = () => {}
    } else {
      list.addListener = () => {}
      list.removeListener = () => {}
    }
    return list
  }

  const target = new EventTarget() as EventTarget & {
    matchMedia: (q: string) => MediaQueryListLike
    navigator: typeof navigator
  }
  ;(target as { matchMedia: typeof matchMedia }).matchMedia = matchMedia
  ;(target as { navigator: typeof navigator }).navigator = navigator

  vi.stubGlobal('window', target)
  vi.stubGlobal('navigator', navigator)

  return { window: target, navigator }
}

function makeBeforeInstallPromptEvent(promptResult: 'accepted' | 'dismissed' | 'reject'): Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
} {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  }
  event.prompt = vi.fn(async () => {
    if (promptResult === 'reject') {
      throw new Error('prompt rejected')
    }
  })
  event.userChoice = Promise.resolve({
    outcome: promptResult === 'reject' ? 'dismissed' : promptResult,
    platform: 'web',
  })
  return event
}

async function loadModule(): Promise<typeof import('../app/install-support')> {
  vi.resetModules()
  return import('../app/install-support')
}

describe('install-support', () => {
  beforeEach(() => {
    setupWindowStub()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports unavailable install state by default', async () => {
    const mod = await loadModule()
    mod.initInstallSupport()
    const state = mod.getInstallUiState()
    expect(state.isStandalone).toBe(false)
    expect(state.canPromptInstall).toBe(false)
    expect(state.showIosInstallHint).toBe(false)
    expect(state.statusText).toMatch(/unavailable/i)
  })

  it('marks state as standalone when display-mode matches', async () => {
    setupWindowStub({ displayModeStandalone: true })
    const mod = await loadModule()
    mod.initInstallSupport()
    const state = mod.getInstallUiState()
    expect(state.isStandalone).toBe(true)
    expect(state.canPromptInstall).toBe(false)
    expect(state.statusText).toMatch(/installed app mode/i)
  })

  it('shows iOS install hint on iOS Safari and not in standalone', async () => {
    setupWindowStub({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    const mod = await loadModule()
    mod.initInstallSupport()
    const state = mod.getInstallUiState()
    expect(state.showIosInstallHint).toBe(true)
    expect(state.canPromptInstall).toBe(false)
    expect(state.statusText).toMatch(/add to home screen/i)
  })

  it('hides iOS install hint when running in iOS standalone (navigator.standalone)', async () => {
    setupWindowStub({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      navigatorStandalone: true,
    })
    const mod = await loadModule()
    mod.initInstallSupport()
    const state = mod.getInstallUiState()
    expect(state.isStandalone).toBe(true)
    expect(state.showIosInstallHint).toBe(false)
  })

  it('captures beforeinstallprompt, notifies subscribers, and exposes promptable state', async () => {
    const { window } = setupWindowStub()
    const mod = await loadModule()
    mod.initInstallSupport()

    const listener = vi.fn()
    mod.subscribeInstallSupport(listener)

    const event = makeBeforeInstallPromptEvent('accepted')
    const preventDefault = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(mod.getInstallUiState().canPromptInstall).toBe(true)
  })

  it('promptInstall returns false when no deferred prompt is available', async () => {
    const mod = await loadModule()
    mod.initInstallSupport()
    expect(await mod.promptInstall()).toBe(false)
  })

  it('promptInstall clears the deferred prompt, notifies subscribers, and returns true when accepted', async () => {
    const { window } = setupWindowStub()
    const mod = await loadModule()
    mod.initInstallSupport()

    const event = makeBeforeInstallPromptEvent('accepted')
    window.dispatchEvent(event)
    expect(mod.getInstallUiState().canPromptInstall).toBe(true)

    const listener = vi.fn()
    mod.subscribeInstallSupport(listener)

    const result = await mod.promptInstall()
    expect(result).toBe(true)
    expect(event.prompt).toHaveBeenCalled()
    expect(mod.getInstallUiState().canPromptInstall).toBe(false)
    // notifyChange is called once when clearing the prompt and once in finally.
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('promptInstall returns false when prompt() rejects but still notifies subscribers', async () => {
    const { window } = setupWindowStub()
    const mod = await loadModule()
    mod.initInstallSupport()

    const event = makeBeforeInstallPromptEvent('reject')
    window.dispatchEvent(event)

    const listener = vi.fn()
    mod.subscribeInstallSupport(listener)

    const result = await mod.promptInstall()
    expect(result).toBe(false)
    expect(mod.getInstallUiState().canPromptInstall).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('clears deferred prompt on appinstalled and notifies subscribers', async () => {
    const { window } = setupWindowStub()
    const mod = await loadModule()
    mod.initInstallSupport()

    window.dispatchEvent(makeBeforeInstallPromptEvent('accepted'))
    expect(mod.getInstallUiState().canPromptInstall).toBe(true)

    const listener = vi.fn()
    mod.subscribeInstallSupport(listener)

    window.dispatchEvent(new Event('appinstalled'))
    expect(mod.getInstallUiState().canPromptInstall).toBe(false)
    expect(listener).toHaveBeenCalled()
  })

  it('initInstallSupport falls back to addListener when addEventListener is missing on MediaQueryList', async () => {
    setupWindowStub({ matchMediaSupportsAddEventListener: false })
    const mod = await loadModule()
    expect(() => mod.initInstallSupport()).not.toThrow()
  })
})
