import './style.css'
import { AppController } from './app/controller'
import { persistRendererKind, pickRendererKind, readStoredRendererKind } from './app/renderer-selection'
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

const rendererKind = pickRendererKind(window.location.search, readStoredRendererKind())
persistRendererKind(rendererKind)

const controller = new AppController(rendererKind)
const renderer = createRenderer(rendererKind)
renderer.mount(app, controller)

controller.subscribe((view) => {
  renderer.render(view)
})

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const baseUrl = import.meta.env.BASE_URL
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    const serviceWorkerUrl = `${normalizedBaseUrl}sw.js?base=${encodeURIComponent(normalizedBaseUrl)}`
    void navigator.serviceWorker.register(serviceWorkerUrl)
  })
}
