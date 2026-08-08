// Hidden, visually-offscreen accessibility navigation. The Phaser canvas
// exposes its controls only through `pointerup`, which is unreachable for
// keyboard and screen-reader users. This renders an equivalent <nav> of
// native <button> elements whose contents are kept in sync with the view
// model, covering every Phaser control that would otherwise be a
// pointer-only hit area (mode buttons, Menu/Recorder/Replay actions, play
// land options, counter responses, Pass, End Turn, target pickers, …).
// Extracted from PhaserRenderer.updateA11yNav().
import { AI_LEVEL_OPTIONS } from '../../app/ai-levels'
import { ANIMATION_SPEED_OPTIONS } from '../../app/animation-settings'
import { BOARD_THEME_OPTIONS } from '../../app/board-theme'
import { CARD_VISUAL_STYLE_OPTIONS } from '../../app/card-visual-styles'
import type { ControllerApi } from '../../app/controller'
import { RENDER_QUALITY_OPTIONS } from '../../app/render-quality'
import type { AppViewModel, Mode } from '../../app/types'
import type { CardgameScene } from './cardgame-scene'
import { isAdventureResumable, LOBBY_MODE_OPTIONS, selectedAiLevelLabel } from './lobby-actions'
import type { LobbyScene } from './lobby-scene'
import { installButtonState } from './ui-utils'

export type NavEntry = { key: string; label: string; onClick: () => void; disabled?: boolean }

type VisualSettingsView = Pick<
  AppViewModel,
  'animationSpeed' | 'boardTheme' | 'cardVisualStyle' | 'renderQualityPreference'
>

type VisualSettingsController = Pick<
  ControllerApi,
  'setAnimationSpeed' | 'setBoardTheme' | 'setCardVisualStyle' | 'setRenderQualityPreference'
>

export interface A11yNavDeps {
  controller: ControllerApi | null
  lobbyScene: LobbyScene | null
  cardgameScene: CardgameScene | null
  openRecordingFilePicker: () => void
  handleDownloadRecording: () => void
}

export interface A11yNav {
  element: HTMLElement
  update: (view: AppViewModel, lobbyActive: boolean, deps: A11yNavDeps) => void
  remove: () => void
}

export function buildVisualSettingsA11yEntries(
  view: VisualSettingsView,
  controller: VisualSettingsController,
): NavEntry[] {
  const entries: NavEntry[] = []
  for (const option of CARD_VISUAL_STYLE_OPTIONS) {
    const selected = view.cardVisualStyle === option.value ? ' (selected)' : ''
    entries.push({
      key: `settings-card-visual-style:${option.value}`,
      label: `Set card visual style: ${option.label}${selected}`,
      onClick: () => controller.setCardVisualStyle(option.value),
    })
  }
  for (const option of BOARD_THEME_OPTIONS) {
    const selected = view.boardTheme === option.value ? ' (selected)' : ''
    entries.push({
      key: `settings-board-theme:${option.value}`,
      label: `Set board theme: ${option.label}${selected}`,
      onClick: () => controller.setBoardTheme(option.value),
    })
  }
  for (const option of RENDER_QUALITY_OPTIONS) {
    const selected = view.renderQualityPreference === option.value ? ' (selected)' : ''
    entries.push({
      key: `settings-render-quality:${option.value}`,
      label: `Set render quality: ${option.label}${selected}`,
      onClick: () => controller.setRenderQualityPreference(option.value),
    })
  }
  for (const option of ANIMATION_SPEED_OPTIONS) {
    const selected = view.animationSpeed === option.value ? ' (selected)' : ''
    entries.push({
      key: `settings-animation-speed:${option.value}`,
      label: `Set animation speed: ${option.label}${selected}`,
      onClick: () => controller.setAnimationSpeed(option.value),
    })
  }
  return entries
}

export function createA11yNav(container: HTMLElement): A11yNav {
  const nav = document.createElement('nav')
  nav.className = 'phaser-a11y-nav'
  nav.setAttribute('aria-label', 'Cardgame controls')
  container.appendChild(nav)

  let keySignature: string | null = null

  const buildLobbyEntries = (view: AppViewModel, deps: A11yNavDeps): NavEntry[] => {
    const entries: NavEntry[] = []
    const { controller, lobbyScene } = deps
    if (!controller) {
      return entries
    }
    const submenu = lobbyScene?.getActiveSubmenu() ?? 'root'
    const aiOptionsOpen = lobbyScene?.isAiLevelOptionsOpen() ?? false
    const currentAiLevelLabel = selectedAiLevelLabel(view.aiLevel)
    const canResumeAdventure = isAdventureResumable(view.adventure)
    if (submenu === 'root') {
      const modes: Array<{ mode: Mode; label: string }> = LOBBY_MODE_OPTIONS
      for (const entry of modes) {
        entries.push({ key: `start:${entry.mode}`, label: `Start ${entry.label}`, onClick: () => controller.startGame(entry.mode) })
      }
      entries.push({
        key: 'lobby-open-settings',
        label: 'Open Settings',
        onClick: () => lobbyScene?.showSettingsMenu(),
      })
      entries.push({
        key: 'lobby-open-recording',
        label: 'Open Recording',
        onClick: () => lobbyScene?.showRecordingMenu(),
      })
      if (canResumeAdventure) {
        entries.push({
          key: 'resume-adventure',
          label: 'Resume Adventure',
          onClick: () => controller.resumeAdventure(),
        })
      }
      if (view.adventure.hasSavedRun) {
        entries.push({
          key: 'reset-adventure',
          label: 'Reset Adventure Run',
          onClick: () => controller.abandonAdventure(),
        })
      }
      const installEntry = installButtonState()
      entries.push({
        key: 'lobby-install',
        label: installEntry.label,
        onClick: installEntry.onClick,
        disabled: installEntry.disabled,
      })
      entries.push({
        key: 'switch-renderer',
        label: 'Switch to DOM renderer',
        onClick: () => { window.location.search = '?renderer=dom' },
      })
    } else if (submenu === 'settings') {
      entries.push({
        key: 'settings-back',
        label: 'Back to Lobby',
        onClick: () => lobbyScene?.showRootMenu(),
      })
      entries.push({
        key: 'settings-ai-toggle',
        label: `${aiOptionsOpen ? 'Collapse' : 'Expand'} AI Difficulty Selector (current: ${currentAiLevelLabel})`,
        onClick: () => lobbyScene?.toggleAiLevelOptions(),
      })
      if (aiOptionsOpen) {
        for (const option of AI_LEVEL_OPTIONS) {
          const selected = view.aiLevel === option.value ? ' (selected)' : ''
          entries.push({
            key: `settings-ai-level:${option.value}`,
            label: `Set AI level: ${option.label}${selected}`,
            onClick: () => {
              controller.setAiLevel(option.value)
              lobbyScene?.closeAiLevelOptions()
            },
          })
        }
      }
      entries.push(...buildVisualSettingsA11yEntries(view, controller))
    } else {
      entries.push({
        key: 'recording-back',
        label: 'Back to Lobby',
        onClick: () => lobbyScene?.showRootMenu(),
      })
      entries.push({
        key: 'lobby-recorder-load-browser',
        label: 'Load Recording from Browser',
        onClick: () => controller.loadRecordingFromLocalStorage(),
        disabled: !view.recording.hasLocalSave,
      })
      entries.push({
        key: 'lobby-recorder-load-file',
        label: 'Load Recording from File',
        onClick: () => deps.openRecordingFilePicker(),
      })
    }
    return entries
  }

  const buildGameplayEntries = (view: AppViewModel, deps: A11yNavDeps): NavEntry[] => {
    const entries: NavEntry[] = []
    const { controller, cardgameScene } = deps
    if (!controller) {
      return entries
    }
    const targetPickerOpen = cardgameScene?.isTargetPickerOpen() ?? false
    const closeSceneMenu = (): void => { cardgameScene?.closeMenuOverlay() }
    if (targetPickerOpen) {
      const targetPickerEntries = cardgameScene?.getTargetPickerA11yEntries() ?? []
      for (const entry of targetPickerEntries) {
        entries.push({
          key: `target-picker:${entry.key}`,
          label: entry.label,
          onClick: entry.onSelect,
        })
      }
      return entries
    }
    if (view.mode === 'adventure-hvai') {
      entries.push({ key: 'pause-adventure', label: 'Pause Adventure', onClick: () => {
        closeSceneMenu()
        controller.pauseAdventure()
      } })
      entries.push({ key: 'reset-adventure', label: 'Reset Adventure Run', onClick: () => {
        closeSceneMenu()
        controller.abandonAdventure()
      } })
    } else {
      entries.push({ key: 'back-to-lobby', label: 'Back to Lobby', onClick: () => {
        closeSceneMenu()
        controller.backToLobby()
      } })
      entries.push({ key: 'rematch', label: 'Rematch', onClick: () => {
        closeSceneMenu()
        controller.rematch()
      } })
    }
    // Mirror the Phaser menu's recorder actions: close the menu overlay
    // before invoking the controller so the resulting status message (e.g.
    // "No saved recording found" or "Failed to read recording file") shows
    // up in the scene's status footer instead of being hidden behind the
    // open modal. Without these closes, keyboard / screen-reader users who
    // trigger Save/Load via the a11y nav while the menu is open get no
    // visible feedback at all.
    const menuModalOpen = cardgameScene?.isMenuOverlayOpen() ?? false
    if (menuModalOpen) {
      entries.push({ key: 'menu-close', label: 'Close Menu', onClick: () => closeSceneMenu() })
    }
    entries.push({ key: 'recorder-download', label: 'Download Recording', onClick: () => {
      closeSceneMenu()
      deps.handleDownloadRecording()
    } })
    entries.push({ key: 'recorder-save', label: 'Save Recording to Browser', onClick: () => {
      closeSceneMenu()
      controller.saveRecordingToLocalStorage()
    } })
    entries.push({
      key: 'recorder-load-browser',
      label: 'Load Recording from Browser',
      onClick: () => {
        closeSceneMenu()
        controller.loadRecordingFromLocalStorage()
      },
      disabled: !view.recording.hasLocalSave,
    })
    entries.push({ key: 'recorder-load-file', label: 'Load Recording from File', onClick: () => {
      closeSceneMenu()
      deps.openRecordingFilePicker()
    } })
    const installEntry = installButtonState()
    entries.push({
      key: 'install',
      label: installEntry.label,
      onClick: () => {
        closeSceneMenu()
        installEntry.onClick()
      },
      disabled: installEntry.disabled,
    })
    if (view.replay.active) {
      entries.push({ key: 'replay-toggle', label: view.replay.isPlaying ? 'Pause Replay' : 'Play Replay', onClick: () => {
        if (view.replay.isPlaying) {
          controller.pauseReplay()
        } else {
          controller.startReplay()
        }
      } })
      entries.push({ key: 'replay-prev', label: 'Previous Replay Step', onClick: () => controller.stepReplay(-1) })
      entries.push({ key: 'replay-next', label: 'Next Replay Step', onClick: () => controller.stepReplay(1) })
      entries.push({ key: 'replay-jump-end', label: 'Jump Replay to End', onClick: () => controller.jumpReplayToEnd() })
      entries.push({ key: 'replay-exit', label: 'Exit Replay', onClick: () => controller.exitReplay() })
    } else {
      entries.push({
        key: 'replay-start',
        label: 'Start Replay',
        onClick: () => controller.startReplay(),
        disabled: !view.recording.metadata,
      })
    }

    // In-match gameplay actions: mirror the Phaser scene's interactive
    // controls (play land options, counter responses, Pass, End Turn) as
    // native <button> elements so keyboard and screen-reader users can take
    // turns without relying on pointer-only Phaser hit areas. Skip these
    // when the Phaser menu modal is open: pointer users cannot interact
    // with gameplay controls behind the modal, so exposing them through
    // the a11y nav would let keyboard / screen-reader users mutate game
    // state behind the overlay and break the modal semantics.
    const game = view.game
    if (game && game.canInput && !menuModalOpen) {
      if (game.phase === 'main') {
        const battlefieldTargets = cardgameScene?.getBattlefieldTargetA11yEntries() ?? []
        const hasBattlefieldTargets = battlefieldTargets.length > 0
        if (hasBattlefieldTargets) {
          for (const target of battlefieldTargets) {
            entries.push({
              key: target.key,
              label: target.label,
              onClick: target.onSelect,
            })
          }
        } else {
          for (const card of game.players[game.actor].handCards) {
            const options = game.legal.playLandByCard[card.id]
            if (!options) {
              continue
            }
            for (const option of options) {
              entries.push({
                key: `play:${card.id}:${option.label}`,
                label: `Play ${card.name}: ${option.label}`,
                onClick: () => controller.submitAction(option.action),
              })
            }
          }
        }
        if (game.legal.canEndTurn && !hasBattlefieldTargets) {
          entries.push({
            key: 'end-turn',
            label: 'End Turn',
            onClick: () => controller.submitAction({ type: 'end_turn', actor: game.actor }),
          })
        }
      } else if (game.phase === 'respond') {
        game.legal.counterOptions.forEach((option, index) => {
          entries.push({
            key: `counter:${index}`,
            label: option.label,
            onClick: () => controller.submitAction(option.action),
          })
        })
        if (game.legal.canPassResponse) {
          entries.push({
            key: 'pass-response',
            label: 'Pass Response',
            onClick: () => controller.submitAction({ type: 'pass_response', actor: game.actor }),
          })
        }
      } else if (game.phase === 'swamp_target') {
        game.legal.swampDiscardOptions.forEach((option, index) => {
          entries.push({
            key: `swamp-discard:${index}:${option.action.effectTargetId ?? 'default'}`,
            label: option.label,
            onClick: () => controller.submitAction(option.action),
          })
        })
      } else if (game.phase === 'plains_target') {
        const battlefieldTargets = cardgameScene?.getBattlefieldTargetA11yEntries() ?? []
        if (battlefieldTargets.length > 0) {
          for (const target of battlefieldTargets) {
            entries.push({
              key: target.key,
              label: target.label,
              onClick: target.onSelect,
            })
          }
        } else {
          game.legal.plainsReuseOptions.forEach((option, index) => {
            entries.push({
              key: `plains-reuse:${index}:${option.action.effectTargetId ?? 'default'}`,
              label: option.label,
              onClick: () => controller.submitAction(option.action),
            })
          })
        }
      }
    }
    return entries
  }

  const update = (view: AppViewModel, lobbyActive: boolean, deps: A11yNavDeps): void => {
    if (!deps.controller) {
      nav.innerHTML = ''
      keySignature = null
      return
    }
    const entries = lobbyActive ? buildLobbyEntries(view, deps) : buildGameplayEntries(view, deps)

    // Diff against the previous render to preserve focus on auto-updating
    // states (e.g. replay playback). When the set of buttons (keyed by `key`)
    // is unchanged, update labels / disabled and rebind handlers in place
    // instead of clearing innerHTML, which would destroy focus.
    const signature = entries.map((entry) => entry.key).join('|')
    if (signature === keySignature && nav.children.length === entries.length) {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        const button = nav.children[index] as HTMLButtonElement
        if (button.textContent !== entry.label) {
          button.textContent = entry.label
        }
        const shouldDisable = entry.disabled === true
        if (button.disabled !== shouldDisable) {
          button.disabled = shouldDisable
        }
        const previousHandler = (button as HTMLButtonElement & { _a11yHandler?: () => void })._a11yHandler
        if (previousHandler) {
          button.removeEventListener('click', previousHandler)
        }
        button.addEventListener('click', entry.onClick)
        ;(button as HTMLButtonElement & { _a11yHandler?: () => void })._a11yHandler = entry.onClick
      }
      return
    }

    nav.innerHTML = ''
    for (const entry of entries) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = entry.label
      if (entry.disabled) {
        button.disabled = true
      }
      button.addEventListener('click', entry.onClick)
      ;(button as HTMLButtonElement & { _a11yHandler?: () => void })._a11yHandler = entry.onClick
      nav.appendChild(button)
    }
    keySignature = signature
  }

  const remove = (): void => {
    nav.remove()
  }

  return { element: nav, update, remove }
}
