import './style.css'
import { AppController } from './app/controller'
import { initInstallSupport, subscribeInstallSupport } from './app/install-support'
import { persistRendererKind, pickRendererKind, readStoredRendererKind } from './app/renderer-selection'
import { joinBasePath } from './app/url-path'
import { RendererHost } from './renderers/host'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found.')
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
const renderer = new RendererHost(app, controller)
const unsubscribe = controller.subscribe((view) => renderer.render(view))
const unsubscribeInstall = subscribeInstallSupport(() => renderer.refresh())
void renderer.start(rendererKind)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe()
    unsubscribeInstall()
    renderer.dispose()
  })
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const baseUrl = import.meta.env.BASE_URL
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    const serviceWorkerUrl = `${normalizedBaseUrl}sw.js?base=${encodeURIComponent(normalizedBaseUrl)}`
    void navigator.serviceWorker.register(serviceWorkerUrl)
  })
}
