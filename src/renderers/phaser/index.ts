// Composition root for the Phaser 4 renderer. Wires together the Lobby and
// Cardgame scenes, the Phaser.Game host, and the HTML overlays that Phaser
// itself cannot host (P2P manual signaling text areas, the accessibility
// navigation mirror, and the hidden recording file input). See
// docs/agent/architecture.md for the full module map and
// docs/agent/phaser-renderer.md for renderer-specific conventions.
import type { ControllerApi } from '../../app/controller'
import type { AppViewModel } from '../../app/types'
import type { AppRenderer } from '../types'
import { createA11yNav, type A11yNav } from './a11y-navigation'
import { CardgameScene } from './cardgame-scene'
import { LobbyScene } from './lobby-scene'
import { clamp, type LayoutSafeAreaInsets } from './layout'
import { createP2POverlay, type P2POverlay } from './p2p-overlay'
import { createRecordingFileInput, downloadRecordingJson, type RecordingFileInput } from './recording-file-actions'
import { createSceneHost, type SceneHost } from './scene-host'
import { clearFailedRuntimeAssetUrls } from './texture-loader'
import { measureSafeAreaInsets } from './ui-utils'
import { CARDGAME_SCENE_KEY, LOBBY_SCENE_KEY } from './scene-config'

export class PhaserRenderer implements AppRenderer {
  private container: HTMLElement | null = null
  controller: ControllerApi | null = null
  private sceneHost: SceneHost | null = null
  private cardgameScene: CardgameScene | null = null
  private lobbyScene: LobbyScene | null = null
  private activeSceneKey: string | null = null
  private fileInput: RecordingFileInput | null = null
  private p2pOverlay: P2POverlay | null = null
  private a11yNav: A11yNav | null = null
  private safeAreaInsets: LayoutSafeAreaInsets = {}
  currentView: AppViewModel | null = null

  private readonly handleOnline = (): void => {
    clearFailedRuntimeAssetUrls()
    if (this.activeSceneKey === CARDGAME_SCENE_KEY) {
      this.cardgameScene?.retryFailedBoardAssets()
    }
  }

  safeAreaInsetsForViewport(width: number, height: number): LayoutSafeAreaInsets {
    // Clamp insets against the current viewport so stale CSS env readings
    // cannot consume the entire scene if orientation changes mid-session.
    const left = clamp(this.safeAreaInsets.left ?? 0, 0, Math.max(0, width - 1))
    const right = clamp(this.safeAreaInsets.right ?? 0, 0, Math.max(0, width - left - 1))
    const top = clamp(this.safeAreaInsets.top ?? 0, 0, Math.max(0, height - 1))
    const bottom = clamp(this.safeAreaInsets.bottom ?? 0, 0, Math.max(0, height - top - 1))
    return { top, right, bottom, left }
  }

  mount(container: HTMLElement, controller: ControllerApi): void {
    if (this.container || this.sceneHost) {
      this.unmount()
    }
    this.container = container
    this.controller = controller
    container.classList.add('phaser-root')
    container.innerHTML = ''
    this.safeAreaInsets = measureSafeAreaInsets(container)

    // Hidden file input for "Load from File" recorder action. Phaser lobby and
    // menu entry points both trigger it via openRecordingFilePicker().
    this.fileInput = createRecordingFileInput(container, () => this.controller)

    // Lobby-only HTML overlay for P2P manual signaling. Phaser scenes cannot
    // host native <textarea> elements for paste/copy of the offer/answer
    // payloads, so we render this section as plain HTML siblings of the canvas
    // and only show it while the lobby is active and a P2P mode is selected.
    this.p2pOverlay = createP2POverlay(container)

    // Hidden, visually-offscreen accessibility navigation mirroring every
    // pointer-only Phaser control as a native <button>.
    this.a11yNav = createA11yNav(container)

    this.lobbyScene = new LobbyScene(this)
    this.cardgameScene = new CardgameScene(this)
    this.activeSceneKey = LOBBY_SCENE_KEY
    this.sceneHost = createSceneHost({
      container,
      scenes: [this.lobbyScene, this.cardgameScene],
      onResize: () => {
        this.safeAreaInsets = measureSafeAreaInsets(container)
      },
    })
    window.addEventListener('online', this.handleOnline)
  }

  render(view: AppViewModel): void {
    this.currentView = view
    // For P2P modes, controller.startGame() creates state.game immediately so
    // both peers can prepare their boards, but the seed is only synchronized
    // once the host clicks Start Game (which sends the `start` packet) or the
    // joiner receives it. Until that handshake completes, stay in the lobby
    // so the user can run the offer/answer signaling flow; afterwards switch
    // to the match scene like a local game would.
    const isP2PMode = view.mode === 'p2p-host' || view.mode === 'p2p-join'
    const p2pReady = !isP2PMode || view.p2pStarted
    const targetSceneKey = view.game && p2pReady
      ? CARDGAME_SCENE_KEY
      : LOBBY_SCENE_KEY
    const lobbyActive = targetSceneKey === LOBBY_SCENE_KEY

    this.p2pOverlay?.update(view, lobbyActive, this.controller)

    if (this.activeSceneKey !== targetSceneKey && this.sceneHost) {
      const sceneManager = this.sceneHost.game.scene
      const previousKey = this.activeSceneKey
      this.activeSceneKey = targetSceneKey
      // Stop the previous scene before starting the next one. The new scene's
      // create() reads currentView from this renderer to render initial state.
      if (previousKey && sceneManager.getScene(previousKey)) {
        sceneManager.stop(previousKey)
      }
      sceneManager.start(targetSceneKey)
      this.refreshA11yNav(view, lobbyActive)
      return
    }

    if (targetSceneKey === CARDGAME_SCENE_KEY) {
      this.cardgameScene?.renderView(view)
    } else {
      this.lobbyScene?.renderView(view)
    }
    this.refreshA11yNav(view, lobbyActive)
  }

  refreshA11yNavForCurrentView(): void {
    if (!this.currentView) {
      return
    }
    this.refreshA11yNav(this.currentView, this.activeSceneKey === LOBBY_SCENE_KEY)
  }

  private refreshA11yNav(view: AppViewModel, lobbyActive: boolean): void {
    const presentedActor = view.game && !lobbyActive
      ? this.cardgameScene?.presentedActor(view.game.actor, view.controllers) ?? view.game.actor
      : null
    const presentedView = presentedActor !== null && view.game && presentedActor !== view.game.actor
      ? { ...view, game: { ...view.game, canInput: false } }
      : view
    this.a11yNav?.update(presentedView, lobbyActive, {
      controller: this.controller,
      lobbyScene: this.lobbyScene,
      cardgameScene: this.cardgameScene,
      openRecordingFilePicker: () => this.openRecordingFilePicker(),
      handleDownloadRecording: () => this.handleDownloadRecording(),
    })
  }

  unmount(): void {
    if (
      !this.container
      && !this.sceneHost
      && !this.fileInput
      && !this.p2pOverlay
      && !this.a11yNav
    ) {
      return
    }
    window.removeEventListener('online', this.handleOnline)
    this.sceneHost?.dispose()
    this.sceneHost = null
    this.fileInput?.remove()
    this.fileInput = null
    this.p2pOverlay?.remove()
    this.p2pOverlay = null
    this.a11yNav?.remove()
    this.a11yNav = null
    this.safeAreaInsets = {}
    clearFailedRuntimeAssetUrls()

    this.cardgameScene = null
    this.lobbyScene = null
    this.activeSceneKey = null

    if (this.container) {
      this.container.classList.remove('phaser-root')
      this.container.innerHTML = ''
    }
    this.container = null
    this.controller = null
    this.currentView = null
  }

  openRecordingFilePicker(): void {
    this.fileInput?.click()
  }

  handleDownloadRecording(): void {
    const payload = this.controller?.exportRecordingJson()
    if (!payload) {
      return
    }
    downloadRecordingJson(payload)
  }
}
