import { getInstallUiState, promptInstall } from '../../app/install-support'
import type Phaser from 'phaser'
import type { LayoutSafeAreaInsets } from './layout'
import type { MenuOverlayInstallEntry } from './menu-overlay'

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function colorHexToNumber(hex: string): number {
  const parsed = Number.parseInt(hex.replace('#', ''), 16)
  return Number.isFinite(parsed) ? parsed : 0xffffff
}

export function parseFontPx(fontSize: string, fallback: number): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*px\s*$/.exec(fontSize)
  if (!match) {
    return fallback
  }

  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function snapCardToOrigin(card: Phaser.GameObjects.Container): void {
  const originX = card.getData('originX')
  const originY = card.getData('originY')
  if (typeof originX === 'number' && typeof originY === 'number') {
    card.setPosition(originX, originY)
  }
}

function parseCssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function measureSafeAreaInsets(container: HTMLElement): LayoutSafeAreaInsets {
  const probe = document.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  probe.style.paddingTop = 'env(safe-area-inset-top, 0px)'
  probe.style.paddingRight = 'env(safe-area-inset-right, 0px)'
  probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)'
  probe.style.paddingLeft = 'env(safe-area-inset-left, 0px)'
  container.appendChild(probe)
  const style = window.getComputedStyle(probe)
  const insets: LayoutSafeAreaInsets = {
    top: parseCssPixels(style.paddingTop),
    right: parseCssPixels(style.paddingRight),
    bottom: parseCssPixels(style.paddingBottom),
    left: parseCssPixels(style.paddingLeft),
  }
  probe.remove()
  return insets
}

type InstallButtonState = MenuOverlayInstallEntry & {
  label: string
  onClick: () => void
  disabled?: boolean
}

// Clamps a popup action button (Cancel, Show all, …) to a ratio of the
// popup's content width while never shrinking below `minWidth`, so labels
// stay readable on narrow phone-width popups.
export function popupActionWidth(maxWidth: number, ratio: number, minWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, maxWidth * ratio))
}

export function installButtonState(): InstallButtonState {
  const installState = getInstallUiState()
  if (installState.canPromptInstall) {
    return {
      label: 'Install App',
      onClick: () => { void promptInstall() },
    }
  }
  if (installState.showIosInstallHint) {
    return {
      label: 'iOS: Share → Add to Home Screen',
      onClick: () => {},
      disabled: true,
    }
  }
  if (installState.isStandalone) {
    return {
      label: 'Installed app mode active',
      onClick: () => {},
      disabled: true,
    }
  }
  return {
    label: 'Install unavailable in this browser',
    onClick: () => {},
    disabled: true,
  }
}
