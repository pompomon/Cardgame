type InstallPromptChoice = {
  outcome: 'accepted' | 'dismissed'
  platform: string
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<InstallPromptChoice>
}

export type InstallUiState = {
  isStandalone: boolean
  canPromptInstall: boolean
  showIosInstallHint: boolean
  showInstallUi: boolean
  statusText: string
  iosInstructions: string
}

let initialized = false
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notifyChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

function isStandaloneDisplayMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

function detectIosSafari(): { isIos: boolean; isSafari: boolean } {
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/i.test(ua)
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua)
  return { isIos, isSafari }
}

export function initInstallSupport(): void {
  if (initialized) {
    return
  }
  initialized = true

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredInstallPrompt = event as BeforeInstallPromptEvent
    notifyChange()
  })

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    notifyChange()
  })

  const displayModeQuery = window.matchMedia('(display-mode: standalone)')
  displayModeQuery.addEventListener('change', () => {
    notifyChange()
  })
}

export function subscribeInstallSupport(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getInstallUiState(): InstallUiState {
  const { isIos, isSafari } = detectIosSafari()
  const isStandalone = isStandaloneDisplayMode()
  const canPromptInstall = deferredInstallPrompt !== null && !isStandalone
  const showIosInstallHint = isIos && isSafari && !isStandalone && !canPromptInstall
  const showInstallUi = !isStandalone && (canPromptInstall || showIosInstallHint)
  const statusText = isStandalone
    ? 'Installed app mode active.'
    : canPromptInstall
      ? 'Install Cardgame for faster home-screen access and standalone launch.'
      : showIosInstallHint
        ? 'Install on iOS: Share → Add to Home Screen.'
        : 'Install unavailable in this browser right now.'
  return {
    isStandalone,
    canPromptInstall,
    showIosInstallHint,
    showInstallUi,
    statusText,
    iosInstructions: 'Open Share and tap Add to Home Screen.',
  }
}

export async function promptInstall(): Promise<boolean> {
  const promptEvent = deferredInstallPrompt
  if (!promptEvent) {
    return false
  }
  deferredInstallPrompt = null
  notifyChange()
  await promptEvent.prompt()
  let accepted = false
  try {
    const choice = await promptEvent.userChoice
    accepted = choice.outcome === 'accepted'
  } finally {
    notifyChange()
  }
  return accepted
}
