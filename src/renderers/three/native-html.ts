import { getInstallUiState } from '../../app/install-support'
import { cardAssetSlug, displayCardName } from '../../app/card-catalog'
import type { AppViewModel } from '../../app/types'
import { HIDDEN_HAND_CARD_NAME } from '../../app/types'
import { cardArtSourceFor, cardVisualPaletteFor, isRasterCardVisualStyle } from '../../app/card-visuals'
import { isBasicLand, type BasicLand } from '../../game/types'
import type { RendererCardIdentity } from './contracts'

const failedRasterCardArtUrls = new Set<string>()

declare global {
  interface Window {
    __cardgameNoteRasterCardArtLoadFailure?: (url: string) => void
  }
}

export function noteRasterCardArtLoadFailure(url: string): void {
  failedRasterCardArtUrls.add(url)
}

export function resetRasterCardArtLoadFailuresForTests(): void {
  failedRasterCardArtUrls.clear()
}

interface RasterRenderStage {
  readonly src: string
  readonly isRaster: boolean
  readonly onErrorSrc: string | null
  readonly onErrorIsRaster: boolean
  readonly noteFailureUrl: string | null
  readonly onErrorChainSrc: string | null
  readonly onErrorChainNoteFailureUrl: string | null
}

function resolveRasterRenderStage(source: {
  isRaster: boolean
  primaryUrl: string
  rasterFallbackUrl: string | null
  proceduralUrl: string
}): RasterRenderStage {
  if (!source.isRaster) {
    return { src: source.primaryUrl, isRaster: false, onErrorSrc: null, onErrorIsRaster: false, noteFailureUrl: null, onErrorChainSrc: null, onErrorChainNoteFailureUrl: null }
  }
  const primaryFailed = failedRasterCardArtUrls.has(source.primaryUrl)
  const fallbackUrl = source.rasterFallbackUrl
  const fallbackUsable = fallbackUrl !== null && !failedRasterCardArtUrls.has(fallbackUrl)
  if (!primaryFailed) {
    if (fallbackUsable) {
      return {
        src: source.primaryUrl,
        isRaster: true,
        onErrorSrc: fallbackUrl,
        onErrorIsRaster: true,
        noteFailureUrl: source.primaryUrl,
        onErrorChainSrc: source.proceduralUrl,
        onErrorChainNoteFailureUrl: fallbackUrl,
      }
    }
    return {
      src: source.primaryUrl,
      isRaster: true,
      onErrorSrc: source.proceduralUrl,
      onErrorIsRaster: false,
      noteFailureUrl: source.primaryUrl,
      onErrorChainSrc: null,
      onErrorChainNoteFailureUrl: null,
    }
  }
  if (fallbackUsable) {
    return {
      src: fallbackUrl,
      isRaster: true,
      onErrorSrc: source.proceduralUrl,
      onErrorIsRaster: false,
      noteFailureUrl: fallbackUrl,
      onErrorChainSrc: null,
      onErrorChainNoteFailureUrl: null,
    }
  }
  return { src: source.proceduralUrl, isRaster: false, onErrorSrc: null, onErrorIsRaster: false, noteFailureUrl: null, onErrorChainSrc: null, onErrorChainNoteFailureUrl: null }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderInstallControls(): string {
  const installState = getInstallUiState()
  return `
    <section class="three-install-controls" aria-label="Install">
      <h3>Install</h3>
      <p>${escapeHtml(installState.statusText)}</p>
      ${installState.canPromptInstall
        ? '<div class="three-actions"><button data-action="install-app">Install App</button></div>'
        : ''}
      ${installState.showIosInstallHint
        ? `<p class="three-install-hint">${escapeHtml(installState.iosInstructions)}</p>`
        : ''}
    </section>
  `
}

export function renderP2P(view: AppViewModel, hostAnswerDraft: string, joinOfferDraft: string): string {
  const host = view.mode === 'p2p-host'
  const safeOffer = escapeHtml(view.offer)
  const safeAnswer = escapeHtml(view.answer)
  const safeHostAnswerDraft = escapeHtml(hostAnswerDraft)
  const safeJoinOfferDraft = escapeHtml(joinOfferDraft)

  return `
    <section class="panel three-p2p">
      <h2>P2P Manual Signaling</h2>
      <p>${host ? 'Host: create offer, share it, then paste answer.' : 'Join: paste host offer, create answer, and share answer.'}</p>
      <div class="three-signal-grid">
        ${host
          ? `<button id="create-offer">Create Offer</button>
             <textarea id="offer-text" placeholder="Offer" readonly>${safeOffer}</textarea>
             <textarea id="answer-text" placeholder="Paste remote answer">${safeHostAnswerDraft}</textarea>
             <button id="accept-answer">Accept Answer</button>
             <button id="start-p2p-game">Start Game</button>`
          : `<textarea id="join-offer-text" placeholder="Paste host offer">${safeJoinOfferDraft}</textarea>
             <button id="create-answer">Create Answer</button>
             <textarea id="join-answer-text" placeholder="Answer" readonly>${safeAnswer}</textarea>`}
      </div>
    </section>
  `
}

function rasterOnErrorHandler(stage: RasterRenderStage, imageClass: string, parentClass: string | null): string {
  if (stage.onErrorSrc === null || stage.noteFailureUrl === null) {
    return ''
  }
  const parentRemoval = parentClass ? `this.closest(&#39;.${parentClass}&#39;)?.classList.remove(&#39;${parentClass}&#39;);` : ''
  if (stage.onErrorIsRaster && stage.onErrorChainSrc !== null && stage.onErrorChainNoteFailureUrl !== null) {
    return ` onerror="window.__cardgameNoteRasterCardArtLoadFailure?.(&#39;${stage.noteFailureUrl}&#39;);this.onerror=()=>{this.onerror=null;window.__cardgameNoteRasterCardArtLoadFailure?.(&#39;${stage.onErrorChainNoteFailureUrl}&#39;);this.classList.remove(&#39;${imageClass}&#39;);${parentRemoval}this.src=&#39;${stage.onErrorChainSrc}&#39;};this.src=&#39;${stage.onErrorSrc}&#39;"`
  }
  return ` onerror="this.onerror=null;window.__cardgameNoteRasterCardArtLoadFailure?.(&#39;${stage.noteFailureUrl}&#39;);this.classList.remove(&#39;${imageClass}&#39;);${parentRemoval}this.src=&#39;${stage.onErrorSrc}&#39;"`
}

export function renderLandIcon(
  name: BasicLand,
  style: AppViewModel['cardVisualStyle'],
  size: number,
  className: string,
  options: { forceProcedural?: boolean } = {},
): string {
  const source = cardArtSourceFor(name, style, size, options)
  const stage = resolveRasterRenderStage(source)
  const onError = stage.isRaster ? rasterOnErrorHandler(stage, `${className}--raster`, null) : ''
  const finalClassName = stage.isRaster ? `${className} ${className}--raster` : className
  return `<img class="${finalClassName}" src="${stage.src}" alt="" role="presentation" width="${size}" height="${size}"${onError} />`
}

export function renderCardTile(card: string | RendererCardIdentity, style: AppViewModel['cardVisualStyle']): string {
  const value: RendererCardIdentity = typeof card === 'string' ? { name: card } : card
  if (value.name === HIDDEN_HAND_CARD_NAME) {
    return '<span class="card-tile card-tile--hidden three-card three-card--hidden" aria-label="Hidden card" title="Hidden card"><span class="three-card__back">?</span><span class="three-card__name">Hidden card</span></span>'
  }
  const serializedKey = value.serializedKey ?? (isBasicLand(value.name) ? value.name : null)
  if (!serializedKey) {
    return `<span class="card-tile three-card three-card--text"><span class="three-card__name">${escapeHtml(value.displayName ?? value.name)}</span></span>`
  }

  const displayName = value.displayName ?? displayCardName(serializedKey)
  const assetSlug = cardAssetSlug(serializedKey)
  const source = cardArtSourceFor(serializedKey, style, 144)
  const palette = cardVisualPaletteFor(serializedKey, style)
  const stage = resolveRasterRenderStage(source)
  const raster = isRasterCardVisualStyle(style) && stage.isRaster
  const safeName = escapeHtml(displayName)
  const landClass = `three-card--${serializedKey.toLowerCase()}`
  const tileStyleAttr = ` style="--tile-fill:${palette.cardFill};--tile-stroke:${palette.cardStroke};--tile-text:${palette.cardText}"`
  const assetIdentity = ` data-card-art="${escapeHtml(assetSlug)}"`

  if (raster) {
    const onError = rasterOnErrorHandler(stage, 'card-tile-bg', 'card-tile--raster')
    return `<span class="card-tile card-tile--raster three-card three-card--raster ${landClass}"${assetIdentity}${tileStyleAttr}><span class="three-card__art-frame"><img class="card-tile-bg three-card__art" src="${stage.src}" alt="" role="presentation"${onError} /></span><span class="card-tile-label three-card__name">${safeName}</span></span>`
  }

  return `<span class="card-tile three-card three-card--procedural ${landClass}"${assetIdentity}${tileStyleAttr}><span class="three-card__art-frame">${renderLandIcon(serializedKey, style, 64, 'card-tile-icon')}</span><span class="three-card__name">${safeName}</span></span>`
}

if (typeof window !== 'undefined') {
  window.__cardgameNoteRasterCardArtLoadFailure = noteRasterCardArtLoadFailure
}
