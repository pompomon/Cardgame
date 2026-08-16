import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControllerApi } from '../app/controller'
import type { AppViewModel } from '../app/types'
import { createA11yNav } from '../renderers/phaser/a11y-navigation'
import type { CardgameScene } from '../renderers/phaser/cardgame-scene'

type ClickListener = () => void

class FakeElement {
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, ClickListener[]>()
  className = ''
  textContent: string | null = null
  type = ''
  disabled = false
  parent: FakeElement | null = null
  private html = ''

  get innerHTML(): string {
    return this.html
  }

  set innerHTML(value: string) {
    this.html = value
    if (value === '') {
      for (const child of this.children) {
        child.parent = null
      }
      this.children.length = 0
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this
    this.children.push(child)
    return child
  }

  addEventListener(event: string, listener: ClickListener): void {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }

  removeEventListener(event: string, listener: ClickListener): void {
    const listeners = this.listeners.get(event) ?? []
    this.listeners.set(event, listeners.filter((entry) => entry !== listener))
  }

  click(): void {
    for (const listener of [...(this.listeners.get('click') ?? [])]) {
      listener()
    }
  }

  remove(): void {
    if (!this.parent) {
      return
    }
    const index = this.parent.children.indexOf(this)
    if (index >= 0) {
      this.parent.children.splice(index, 1)
    }
    this.parent = null
  }
}

const playAction = {
  type: 'play_land',
  actor: 0,
  cardId: 'card-1',
} as const

function gameplayView(): AppViewModel {
  return {
    mode: 'local-hvh',
    game: {
      phase: 'main',
      actor: 0,
      canInput: true,
      players: [
        { handCards: [{ id: 'card-1', name: 'Forest' }] },
        { handCards: [] },
      ],
      legal: {
        playLandByCard: {
          'card-1': [{ action: playAction, label: 'Play Forest' }],
        },
        canEndTurn: true,
      },
    },
    recording: {
      hasLocalSave: false,
      metadata: null,
    },
    replay: {
      active: false,
    },
  } as unknown as AppViewModel
}

function installBrowserStubs(): void {
  vi.stubGlobal('document', {
    createElement: () => new FakeElement(),
  })
  vi.stubGlobal('navigator', { userAgent: 'test' })
  vi.stubGlobal('window', {
    navigator: {},
    matchMedia: () => ({ matches: false }),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Phaser drag accessibility parity', () => {
  it('keeps native play-land actions available and blocks them behind the menu modal', () => {
    installBrowserStubs()
    const submitAction = vi.fn()
    const controller = { submitAction } as unknown as ControllerApi
    const container = new FakeElement()
    const nav = createA11yNav(container as unknown as HTMLElement)
    const view = gameplayView()

    nav.update(view, false, {
      controller,
      lobbyScene: null,
      cardgameScene: null,
      openRecordingFilePicker: vi.fn(),
      handleDownloadRecording: vi.fn(),
    })
    const playButton = (nav.element as unknown as FakeElement).children.find(
      (button) => button.textContent === 'Play Forest: Play Forest',
    )
    expect(playButton).toBeTruthy()
    playButton?.click()
    expect(submitAction).toHaveBeenCalledOnce()
    expect(submitAction).toHaveBeenCalledWith(playAction)

    nav.update(view, false, {
      controller,
      lobbyScene: null,
      cardgameScene: {
        isTargetPickerOpen: () => false,
        isMenuOverlayOpen: () => true,
      } as unknown as CardgameScene,
      openRecordingFilePicker: vi.fn(),
      handleDownloadRecording: vi.fn(),
    })
    expect((nav.element as unknown as FakeElement).children.some(
      (button) => button.textContent?.startsWith('Play Forest') === true,
    )).toBe(false)
    nav.remove()
  })

  it('exposes replay log expand/collapse in the menu a11y controls', () => {
    installBrowserStubs()
    const controller = {} as ControllerApi
    const container = new FakeElement()
    const nav = createA11yNav(container as unknown as HTMLElement)
    const view = gameplayView()
    const toggleMenuLogExpanded = vi.fn()
    const cardgameScene = {
      isTargetPickerOpen: () => false,
      isMenuOverlayOpen: () => true,
      isMenuLogExpanded: () => false,
      toggleMenuLogExpanded,
    } as unknown as CardgameScene

    nav.update(view, false, {
      controller,
      lobbyScene: null,
      cardgameScene,
      openRecordingFilePicker: vi.fn(),
      handleDownloadRecording: vi.fn(),
    })

    const toggleButton = (nav.element as unknown as FakeElement).children.find(
      (button) => button.textContent === 'Expand Replay Log',
    )
    expect(toggleButton).toBeTruthy()
    toggleButton?.click()
    expect(toggleMenuLogExpanded).toHaveBeenCalledOnce()
    nav.remove()
  })
})
