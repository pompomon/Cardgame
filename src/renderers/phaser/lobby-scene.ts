// Lobby scene: mode selection, Settings (AI difficulty / card visual style /
// board theme / render quality / animation speed), and Recording (load from
// browser/file) submenus. Extracted
// from the monolithic phaser/index.ts so lobby UI and its submenu state own a
// single file, matching docs/agent/phaser-renderer.md "Lobby fallbacks". Row
// content/predicates themselves live in the pure, testable `lobby-actions.ts`.
import Phaser from 'phaser'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import type { AppViewModel } from '../../app/types'
import { preloadCardArt } from './card-art-loader'
import { buildButton } from './button'
import {
  buildLobbyRecordingRows,
  buildLobbyRootRows,
  buildLobbySettingsRows,
  LOBBY_MODE_OPTIONS,
} from './lobby-actions'
import { buildLayout, orientationFromViewport, type SceneLayout } from './layout'
import { installButtonState } from './ui-utils'
import { BUTTON_THEME, UI_THEME } from './theme'
import { BASE_HEIGHT, BASE_WIDTH, LOBBY_SCENE_KEY, MIN_LOBBY_ROW_HEIGHT, type LobbySubmenu } from './scene-config'
import type { PhaserRendererHost } from './renderer-host'

// Re-exported for backwards-compatible imports (e.g. a11y-navigation.ts);
// the canonical definition now lives in lobby-actions.ts.
export { LOBBY_MODE_OPTIONS }

export class LobbyScene extends Phaser.Scene {
  private readonly rendererRef: PhaserRendererHost
  private rootContainer: Phaser.GameObjects.Container | null = null
  private currentLayout: SceneLayout = buildLayout(BASE_WIDTH, BASE_HEIGHT, 'horizontal')
  private lastLayoutSignature = ''
  private activeSubmenu: LobbySubmenu = 'root'
  private aiLevelOptionsOpen = false

  constructor(rendererRef: PhaserRendererHost) {
    super(LOBBY_SCENE_KEY)
    this.rendererRef = rendererRef
  }

  getActiveSubmenu(): LobbySubmenu {
    return this.activeSubmenu
  }

  isAiLevelOptionsOpen(): boolean {
    return this.aiLevelOptionsOpen
  }

  showRootMenu(): void {
    this.activeSubmenu = 'root'
    this.aiLevelOptionsOpen = false
    this.renderView(this.rendererRef.currentView)
  }

  showSettingsMenu(): void {
    this.activeSubmenu = 'settings'
    this.renderView(this.rendererRef.currentView)
  }

  showRecordingMenu(): void {
    this.activeSubmenu = 'recording'
    this.renderView(this.rendererRef.currentView)
  }

  toggleAiLevelOptions(): void {
    if (this.activeSubmenu !== 'settings') {
      return
    }
    this.aiLevelOptionsOpen = !this.aiLevelOptionsOpen
    this.renderView(this.rendererRef.currentView)
  }

  closeAiLevelOptions(): void {
    if (!this.aiLevelOptionsOpen) {
      return
    }
    this.aiLevelOptionsOpen = false
    this.renderView(this.rendererRef.currentView)
  }

  preload(): void {
    const selectedStyle = this.rendererRef.currentView?.cardVisualStyle
      ?? this.rendererRef.controller?.getViewModel().cardVisualStyle
      ?? DEFAULT_CARD_VISUAL_STYLE
    preloadCardArt(this, selectedStyle)
  }

  create(): void {
    this.rootContainer = this.add.container(0, 0)
    // Phaser reuses the same LobbyScene instance across stop/start cycles, so
    // reset submenu UI state here to avoid carrying an old submenu forward
    // when returning from an in-progress match back to the lobby.
    this.activeSubmenu = 'root'
    this.aiLevelOptionsOpen = false
    this.updateLayout()

    // Save the resize listener so we can detach it on scene shutdown. Without
    // this, every lobby↔game scene transition would reuse the same scene
    // instance and rerun create(), accumulating duplicate listeners that fire
    // on later resizes.
    const onResize = (): void => {
      if (this.updateLayout()) {
        this.renderView(this.rendererRef.currentView)
      }
    }
    this.scale.on('resize', onResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize)
    })

    this.renderView(this.rendererRef.currentView)
  }

  private updateLayout(): boolean {
    const width = this.scale.gameSize.width ?? this.scale.width ?? BASE_WIDTH
    const height = this.scale.gameSize.height ?? this.scale.height ?? BASE_HEIGHT
    const orientation = orientationFromViewport(width, height)
    const insets = this.rendererRef.safeAreaInsetsForViewport(width, height)
    this.currentLayout = buildLayout(width, height, orientation, insets)
    const signature = `${width}x${height}:${orientation}:${this.currentLayout.isCompact ? 'compact' : 'full'}`
    const changed = signature !== this.lastLayoutSignature
    this.lastLayoutSignature = signature
    return changed
  }

  renderView(_view: AppViewModel | null): void {
    this.updateLayout()
    if (!this.rootContainer) {
      return
    }
    this.rootContainer.removeAll(true)

    const top = this.currentLayout.headerTop
    const centerX = this.currentLayout.safeAreaCenterX
    const wrapWidth = Math.max(40, this.currentLayout.safeAreaWidth - this.currentLayout.margin * 2)

    this.rootContainer.add(this.add.text(centerX, top, 'Basic Land Game (Phaser Renderer)', {
      color: UI_THEME.primaryText,
      fontSize: this.currentLayout.titleFontSize,
      align: 'center',
    }).setOrigin(0.5, 0))
    this.rootContainer.add(this.add.text(centerX, top + this.currentLayout.actionButtonHeight + 6, 'Land-only 2-player game with local AI and optional P2P mode.', {
      color: UI_THEME.secondaryText,
      fontSize: this.currentLayout.subtitleFontSize,
      wordWrap: { width: wrapWidth },
      align: 'center',
    }).setOrigin(0.5, 0))

    const view = this.rendererRef.currentView
    const hasLocalSave = view?.recording?.hasLocalSave ?? false
    const selectedCardVisualStyle = view?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    const adventure = view?.adventure
    const nextOpponent = adventure?.opponentLineup?.[adventure.currentOpponentIndex]
    const adventureStatusText = this.add.text(
      centerX,
      top + this.currentLayout.actionButtonHeight + 6 + Math.max(this.currentLayout.actionButtonHeight, 28),
      `Adventure: ${adventure?.status ?? 'inactive'} • Round ${adventure?.currentRound ?? 0}/7 • Chances ${adventure?.remainingChances ?? 0} • High Score ${adventure?.highScore ?? 0}${nextOpponent ? ` • Next ${nextOpponent.label}` : ''}`,
      {
        color: UI_THEME.secondaryText,
        fontSize: this.currentLayout.smallFontSize,
        wordWrap: { width: wrapWidth },
        align: 'center',
      },
    ).setOrigin(0.5, 0)
    this.rootContainer.add(adventureStatusText)

    type LobbyRow = { label: string; disabled?: boolean; onClick: () => void }
    const rows: LobbyRow[] = []
    const installEntry = installButtonState()
    if (this.activeSubmenu === 'root') {
      for (const row of buildLobbyRootRows({ adventure, installLabel: installEntry.label, installDisabled: installEntry.disabled ?? false })) {
        switch (row.kind) {
          case 'start-mode':
            rows.push({ label: row.label, onClick: () => { this.rendererRef.controller?.startGame(row.mode) } })
            break
          case 'open-settings':
            rows.push({ label: row.label, onClick: () => { this.showSettingsMenu() } })
            break
          case 'open-recording':
            rows.push({ label: row.label, onClick: () => { this.showRecordingMenu() } })
            break
          case 'resume-adventure':
            rows.push({ label: row.label, onClick: () => { this.rendererRef.controller?.resumeAdventure() } })
            break
          case 'reset-adventure':
            rows.push({ label: row.label, onClick: () => { this.rendererRef.controller?.abandonAdventure() } })
            break
          case 'install':
            rows.push({ label: row.label, disabled: row.disabled, onClick: installEntry.onClick })
            break
          case 'switch-renderer':
            rows.push({ label: row.label, onClick: () => { window.location.search = '?renderer=dom' } })
            break
        }
      }
    } else if (this.activeSubmenu === 'settings') {
      for (const row of buildLobbySettingsRows({
        aiLevel: view?.aiLevel,
        aiLevelOptionsOpen: this.aiLevelOptionsOpen,
        cardVisualStyle: selectedCardVisualStyle,
        boardTheme: view?.boardTheme,
        renderQualityPreference: view?.renderQualityPreference,
        animationSpeed: view?.animationSpeed,
      })) {
        switch (row.kind) {
          case 'back':
            rows.push({ label: row.label, onClick: () => { this.showRootMenu() } })
            break
          case 'ai-level-toggle':
            rows.push({ label: row.label, onClick: () => { this.toggleAiLevelOptions() } })
            break
          case 'ai-level-option':
            rows.push({
              label: row.label,
              onClick: () => {
                this.rendererRef.controller?.setAiLevel(row.value)
                this.closeAiLevelOptions()
              },
            })
            break
          case 'card-visual-style-option':
            rows.push({ label: row.label, onClick: () => { this.rendererRef.controller?.setCardVisualStyle(row.value) } })
            break
          case 'board-theme-option':
            rows.push({ label: row.label, onClick: () => { this.rendererRef.controller?.setBoardTheme(row.value) } })
            break
          case 'render-quality-option':
            rows.push({ label: row.label, onClick: () => { this.rendererRef.controller?.setRenderQualityPreference(row.value) } })
            break
          case 'animation-speed-option':
            rows.push({ label: row.label, onClick: () => { this.rendererRef.controller?.setAnimationSpeed(row.value) } })
            break
        }
      }
    } else {
      for (const row of buildLobbyRecordingRows({ hasLocalSave })) {
        switch (row.kind) {
          case 'back':
            rows.push({ label: row.label, onClick: () => { this.showRootMenu() } })
            break
          case 'load-from-browser':
            rows.push({ label: row.label, disabled: row.disabled, onClick: () => { this.rendererRef.controller?.loadRecordingFromLocalStorage() } })
            break
          case 'load-from-file':
            rows.push({ label: row.label, onClick: () => { this.rendererRef.openRecordingFilePicker() } })
            break
        }
      }
    }

    const buttonWidth = Math.min(this.currentLayout.safeAreaWidth - this.currentLayout.margin * 2, this.currentLayout.isCompact ? 330 : 360)
    const subtitleBottom = top + this.currentLayout.actionButtonHeight + 6
      + Math.max(this.currentLayout.actionButtonHeight, 28)
      + Math.max(0, adventureStatusText.height) + 8
    const lobbyBodyTop = subtitleBottom + 16
    const lobbyBodyBottom = this.currentLayout.height
      - this.currentLayout.statusBottomOffset - this.currentLayout.margin
    let rowsTop = lobbyBodyTop
    if (this.activeSubmenu !== 'root') {
      const submenuLabel = this.activeSubmenu === 'settings' ? 'Settings' : 'Recording'
      const heading = this.add.text(centerX, rowsTop, submenuLabel, {
        color: UI_THEME.secondaryText,
        fontSize: this.currentLayout.bodyFontSize,
        align: 'center',
      }).setOrigin(0.5, 0)
      this.rootContainer.add(heading)
      rowsTop += Math.max(18, heading.height) + 8
    }
    const lobbyBodyHeight = Math.max(80, lobbyBodyBottom - rowsTop)
    const totalRows = rows.length
    const desiredButtonHeight = this.currentLayout.isCompact ? 38 : 44
    const desiredGap = this.currentLayout.isCompact ? 8 : 14
    const desiredRowHeight = desiredButtonHeight + desiredGap
    const rowScale = Math.min(1, lobbyBodyHeight / Math.max(1, totalRows * desiredRowHeight))
    const rowHeight = desiredRowHeight * rowScale
    if (rowHeight < MIN_LOBBY_ROW_HEIGHT) {
      this.rootContainer?.add(this.add.text(
        centerX,
        rowsTop,
        'Viewport too short to show lobby actions. Increase window height.',
        {
          color: UI_THEME.secondaryText,
          fontSize: this.currentLayout.smallFontSize,
          wordWrap: { width: buttonWidth },
          align: 'center',
        },
      ).setOrigin(0.5, 0))
      this.rendererRef.refreshA11yNavForCurrentView()
      return
    }
    const buttonHeight = Math.min(desiredButtonHeight, rowHeight)
    const modeStartY = rowsTop + buttonHeight / 2
    rows.forEach((entry, index) => {
      const button = buildButton(
        this,
        entry.label,
        centerX,
        modeStartY + index * rowHeight,
        this.currentLayout.actionButtonFontSize,
        buttonWidth,
        buttonHeight,
        entry.disabled ? () => {} : entry.onClick,
        BUTTON_THEME,
      )
      if (entry.disabled) {
        button.setAlpha(0.4)
        button.disableInteractive()
      }
      this.rootContainer?.add(button)
    })

    // Status footer (renders any controller status strings such as P2P signaling errors).
    const status = this.rendererRef.currentView?.status ?? ''
    if (status) {
      this.rootContainer.add(this.add.text(
        centerX,
        this.currentLayout.height - this.currentLayout.statusBottomOffset,
        status,
        {
          color: UI_THEME.secondaryText,
          fontSize: this.currentLayout.bodyFontSize,
          wordWrap: { width: Math.max(40, this.currentLayout.width - this.currentLayout.margin * 2) },
          align: 'center',
        },
      ).setOrigin(0.5, 0))
    }
    this.rendererRef.refreshA11yNavForCurrentView()
  }
}
