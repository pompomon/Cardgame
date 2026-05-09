import './style.css'
import { AppController } from './app/controller'
import { initInstallSupport, subscribeInstallSupport } from './app/install-support'
import { persistRendererKind, pickRendererKind, readStoredRendererKind } from './app/renderer-selection'
import { joinBasePath } from './app/url-path'
import type { AppViewModel } from './app/types'
import type { RendererKind } from './app/types'
import { DomRenderer } from './renderers/dom'
import { PhaserRenderer } from './renderers/phaser'
import type { AppRenderer } from './renderers/types'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found.')
}

function createRenderer(kind: RendererKind): AppRenderer {
  if (kind === 'phaser') {
    return new PhaserRenderer()
  }
  return new DomRenderer()
}

function restoreGithubPagesDeepLink(): void {
  const current = new URL(window.location.href)
  const redirectedRelativePath = current.searchParams.get('__gh_path')
  if (!redirectedRelativePath) {
    return
  }
  const redirectedHash = current.searchParams.get('__gh_hash')
  current.searchParams.delete('__gh_path')
  current.searchParams.delete('__gh_hash')
  const search = current.searchParams.toString()
  const targetPath = joinBasePath(import.meta.env.BASE_URL, redirectedRelativePath)
  const targetUrl = `${targetPath}${search ? `?${search}` : ''}${redirectedHash ?? current.hash}`
  window.history.replaceState(null, '', targetUrl)
}

restoreGithubPagesDeepLink()
initInstallSupport()

const rendererKind = pickRendererKind(window.location.search, readStoredRendererKind())
persistRendererKind(rendererKind)

const controller = new AppController(rendererKind)
const renderer = createRenderer(rendererKind)
renderer.mount(app, controller)

let currentView: AppViewModel | null = null
controller.subscribe((view) => {
  currentView = view
  renderer.render(view)
})

subscribeInstallSupport(() => {
  if (currentView) {
    renderer.render(currentView)
  }
})

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const baseUrl = import.meta.env.BASE_URL
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    const serviceWorkerUrl = `${normalizedBaseUrl}sw.js?base=${encodeURIComponent(normalizedBaseUrl)}`
    void navigator.serviceWorker.register(serviceWorkerUrl)
  })
}
