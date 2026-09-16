import './style.css'
import { AppController } from './app/controller'
import { initInstallSupport, subscribeInstallSupport } from './app/install-support'
import { clearLegacyRendererPreference, removeLegacyRendererSearch } from './app/renderer-migration'
import { serviceWorkerRegistrationUrl } from './app/service-worker-registration'
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
const rendererFreeSearch = removeLegacyRendererSearch(window.location.search)
if (rendererFreeSearch !== window.location.search) {
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${rendererFreeSearch}${window.location.hash}`,
  )
}
clearLegacyRendererPreference()
initInstallSupport()

const controller = new AppController()
const renderer = new RendererHost(app, controller)
const unsubscribe = controller.subscribe((view) => renderer.render(view))
const unsubscribeInstall = subscribeInstallSupport(() => renderer.refresh())
void renderer.start()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe()
    unsubscribeInstall()
    renderer.dispose()
  })
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = serviceWorkerRegistrationUrl(import.meta.env.BASE_URL, import.meta.url)
    void navigator.serviceWorker.register(serviceWorkerUrl)
  })
}
