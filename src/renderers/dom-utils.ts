import type { AppViewModel, AnimationSpeed, CardVisualStyle, RendererKind } from '../app/types'
import { HIDDEN_HAND_CARD_NAME } from '../app/types'
import { AI_LEVEL_OPTIONS } from '../app/ai-levels'
import { ANIMATION_SPEED_OPTIONS, durationMsForSpeed } from '../app/animation-settings'
import { BOARD_THEME_OPTIONS } from '../app/board-theme'
import { CARD_VISUAL_STYLE_OPTIONS } from '../app/card-visual-styles'
import { RENDER_QUALITY_PREFERENCE_OPTIONS } from '../app/render-quality'
import { cardArtSourceFor, cardVisualPaletteFor, isRasterCardVisualStyle } from '../app/card-visuals'
import { visualEffectForEvent, type VisualEffectDescriptor } from '../app/visual-effects'
import { getInstallUiState } from '../app/install-support'
import { isBasicLand, type BasicLand, type LogEvent } from '../game/types'

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

export function rendererSwitchLink(kind: RendererKind): string {
  return kind === 'dom'
    ? '<a href="?renderer=phaser" class="renderer-link">Switch to Phaser renderer</a>'
    : '<a href="?renderer=dom" class="renderer-link">Switch to DOM renderer</a>'
}

export function renderInstallControls(): string {
  const installState = getInstallUiState()
  return `
    <div class="controls install-controls dom-cardgame__install">
      <h3>Install</h3>
      <p>${escapeHtml(installState.statusText)}</p>
      ${installState.canPromptInstall
        ? '<div class="action-row"><button data-action="install-app">Install App</button></div>'
        : ''}
      ${installState.showIosInstallHint
        ? `<p class="install-hint">${escapeHtml(installState.iosInstructions)}</p>`
        : ''}
    </div>
  `
}

export function renderRecordingLoadControls(view: AppViewModel): string {
  return `
    <div class="controls dom-cardgame__recorder">
      <h3>Recording</h3>
      <p>Load a saved game recording from browser storage or a file.</p>
      <div class="action-row">
        <button data-action="load-recording-local">Load from Browser</button>
        <button data-action="load-recording-file">Load from File</button>
      </div>
      <input data-role="load-recording-file-input" type="file" accept="application/json,.json" hidden />
      <p>Local save available: ${view.recording.hasLocalSave ? 'Yes' : 'No'}</p>
    </div>
  `
}

export function renderLobby(view: AppViewModel): string {
  const aiLevelOptions = AI_LEVEL_OPTIONS.map((option) => {
    const selected = option.value === view.aiLevel ? ' selected' : ''
    return `<option value="${option.value}"${selected}>${option.label}</option>`
  }).join('')
  const cardVisualStyleOptions = CARD_VISUAL_STYLE_OPTIONS.map((option) => {
    const selected = option.value === view.cardVisualStyle ? ' selected' : ''
    return `<option value="${option.value}"${selected}>${option.label}</option>`
  }).join('')
  const animationSpeedOptions = ANIMATION_SPEED_OPTIONS.map((option) => {
    const selected = option.value === view.animationSpeed ? ' selected' : ''
    return `<option value="${option.value}"${selected}>${option.label}</option>`
  }).join('')
  const boardThemeOptions = BOARD_THEME_OPTIONS.map((option) => {
    const selected = option.value === view.boardTheme ? ' selected' : ''
    return `<option value="${option.value}"${selected}>${option.label}</option>`
  }).join('')
  const renderQualityOptions = RENDER_QUALITY_PREFERENCE_OPTIONS.map((option) => {
    const selected = option.value === view.renderQualityPreference ? ' selected' : ''
    return `<option value="${option.value}"${selected}>${option.label}</option>`
  }).join('')

  const adventure = view.adventure
  const nextOpponent = adventure.opponentLineup[adventure.currentOpponentIndex]
  const canResumeAdventure = adventure.hasSavedRun && (adventure.status === 'paused' || adventure.status === 'active')

  return `
    <section class="panel lobby dom-cardgame dom-cardgame__lobby">
      <div class="dom-cardgame__hero">
        <p class="dom-cardgame__eyebrow">HD mobile DOM renderer</p>
        <h1>Basic Land Game</h1>
        <p class="subtitle">Land-only 2-player game with local AI and optional P2P mode.</p>
        <p>${rendererSwitchLink(view.renderer)}</p>
      </div>
      <div class="dom-cardgame__lobby-grid">
        ${renderInstallControls()}
        <div class="controls">
          <h3>AI Difficulty</h3>
          <label for="ai-level-select">AI Level</label>
          <select id="ai-level-select">${aiLevelOptions}</select>
        </div>
        <div class="controls">
          <h3>Card Visual Style</h3>
          <label for="card-visual-style-select">Style</label>
          <select id="card-visual-style-select">${cardVisualStyleOptions}</select>
        </div>
        <div class="controls">
          <h3>Animations</h3>
          <label for="animation-speed-select">Speed</label>
          <select id="animation-speed-select">${animationSpeedOptions}</select>
          <p class="install-hint">Default follows system reduced-motion preference.</p>
        </div>
        <div class="controls">
          <h3>Board Theme</h3>
          <label for="board-theme-select">Theme</label>
          <select id="board-theme-select">${boardThemeOptions}</select>
        </div>
        <div class="controls">
          <h3>Render Quality</h3>
          <label for="render-quality-select">Profile</label>
          <select id="render-quality-select">${renderQualityOptions}</select>
        </div>
      </div>
      <div class="modes dom-cardgame__mode-grid" aria-label="Game modes">
        <button data-mode="tutorial">Tutorial (Learn to Play)</button>
        <button data-mode="local-hvh">Local Human vs Human</button>
        <button data-mode="local-hvai">Local Human vs AI</button>
        <button data-mode="local-aivai">Local AI vs AI</button>
        <button data-mode="adventure-hvai">Start Adventure (Human vs AI)</button>
        ${canResumeAdventure ? '<button id="resume-adventure">Resume Adventure</button>' : ''}
        <button data-mode="p2p-host">P2P Host</button>
        <button data-mode="p2p-join">P2P Join</button>
      </div>
      <div class="controls dom-cardgame__adventure-card">
        <h3>Adventure</h3>
        <p>High Score: ${adventure.highScore}</p>
        <p>Status: ${adventure.status}</p>
        <p>Round: ${adventure.currentRound}/7 • Chances: ${adventure.remainingChances} • Win Streak: ${adventure.winStreak}</p>
        <p>Total Rounds: ${adventure.totalRoundsPlayed} • Cards Played: ${adventure.totalCardsPlayed}</p>
        <p>Next Opponent: ${nextOpponent ? escapeHtml(nextOpponent.label) : 'N/A'}</p>
        ${adventure.hasSavedRun ? '<button data-action="abandon-adventure">Reset Adventure Run</button>' : ''}
      </div>
      ${renderRecordingLoadControls(view)}
    </section>
  `
}

export function renderP2P(view: AppViewModel, hostAnswerDraft: string, joinOfferDraft: string): string {
  const host = view.mode === 'p2p-host'
  const safeStatus = escapeHtml(view.status)
  const safeOffer = escapeHtml(view.offer)
  const safeAnswer = escapeHtml(view.answer)
  const safeHostAnswerDraft = escapeHtml(hostAnswerDraft)
  const safeJoinOfferDraft = escapeHtml(joinOfferDraft)

  return `
    <section class="panel dom-cardgame dom-cardgame__p2p">
      <h2>P2P Manual Signaling</h2>
      <p>${host ? 'Host: create offer, share it, then paste answer.' : 'Join: paste host offer, create answer, and share answer.'}</p>
      <div class="signal-grid">
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
      <p class="status">${safeStatus}</p>
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

export function renderCardTile(name: string, style: AppViewModel['cardVisualStyle']): string {
  if (name === HIDDEN_HAND_CARD_NAME) {
    return '<span class="card-tile card-tile--hidden dom-card dom-card--hidden" aria-label="Hidden card" title="Hidden card"><span class="dom-card__back">?</span><span class="dom-card__name">Hidden card</span></span>'
  }
  if (!isBasicLand(name)) {
    return `<span class="card-tile dom-card dom-card--text"><span class="dom-card__name">${escapeHtml(name)}</span></span>`
  }

  const source = cardArtSourceFor(name, style, 144)
  const palette = cardVisualPaletteFor(name, style)
  const stage = resolveRasterRenderStage(source)
  const raster = isRasterCardVisualStyle(style) && stage.isRaster
  const safeName = escapeHtml(name)
  const landClass = `dom-card--${name.toLowerCase()}`
  const tileStyleAttr = ` style="--tile-fill:${palette.cardFill};--tile-stroke:${palette.cardStroke};--tile-text:${palette.cardText}"`

  if (raster) {
    const onError = rasterOnErrorHandler(stage, 'card-tile-bg', 'card-tile--raster')
    return `<span class="card-tile card-tile--raster dom-card dom-card--raster ${landClass}"${tileStyleAttr}><span class="dom-card__art-frame"><img class="card-tile-bg dom-card__art" src="${stage.src}" alt="" role="presentation"${onError} /></span><span class="card-tile-label dom-card__name">${safeName}</span></span>`
  }

  return `<span class="card-tile dom-card dom-card--procedural ${landClass}"${tileStyleAttr}><span class="dom-card__art-frame">${renderLandIcon(name, style, 64, 'card-tile-icon')}</span><span class="dom-card__name">${safeName}</span></span>`
}

if (typeof window !== 'undefined') {
  window.__cardgameNoteRasterCardArtLoadFailure = noteRasterCardArtLoadFailure
}

// ---------------------------------------------------------------------------
// DOM ability-effect overlay system
// Renders CSS-animated particle overlays anchored to battlefield rows.
// Effects are appended to document.body (position:fixed) so they survive
// this.container.innerHTML replacements and self-remove via animationend.
// ---------------------------------------------------------------------------

const DOM_EFFECT_PARTICLES: Readonly<Record<VisualEffectDescriptor['kind'], number>> = {
  play_land: 3,
  forest_return: 6,
  swamp_discard: 4,
  mountain_destroy: 6,
  plains_reuse: 6,
  counter_resolved: 7,
}

// Build the particle <div> children for an effect element.
function buildParticles(kind: VisualEffectDescriptor['kind'], count: number): string {
  let html = ''
  for (let i = 0; i < count; i += 1) {
    const angle = (360 * i) / count
    // Per-particle directional offsets expressed as CSS custom properties so
    // the keyframes can translate relative to each particle's origin. Using
    // only transform+opacity keeps animations on the GPU compositor.
    html += `<div class="dom-effect__particle dom-effect__particle--${i}" style="--angle:${angle}deg;--i:${i}"></div>`
  }

  if (kind === 'mountain_destroy') {
    // Extra flash child that fades in the first 25% of the animation.
    html += '<div class="dom-effect__flash"></div>'
  }
  return html
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, ' ')
}

function selectorsForEffect(descriptor: VisualEffectDescriptor, activeActor: number): string[] {
  const selectors: string[] = []
  if (descriptor.targetInstanceId) {
    selectors.push(`[data-battlefield-card-id="${escapeCssAttribute(descriptor.targetInstanceId)}"]`)
  }
  if (descriptor.targetCardId) {
    selectors.push(`[data-card-id="${escapeCssAttribute(descriptor.targetCardId)}"]`)
  }
  if (selectors.length === 0 && descriptor.sourceInstanceId) {
    selectors.push(`[data-battlefield-card-id="${escapeCssAttribute(descriptor.sourceInstanceId)}"]`)
  }
  const owner = descriptor.targetActor ?? descriptor.actor
  selectors.push(owner === activeActor ? '.battlefield-active' : '.battlefield-non-active')
  return selectors
}

function isReducedDomEffectQuality(): boolean {
  return typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) <= 480
}

// Schedule a single DOM particle effect for the given event. Appends a
// position:fixed overlay div to document.body and removes it after the
// animation completes. Guards: no-op when `animationSpeed === 'off'`, when
// no target element is found, or when RAF is unavailable (SSR/test env).
export function scheduleDomEffect(
  event: LogEvent,
  animationSpeed: AnimationSpeed,
  visualStyle: CardVisualStyle,
  activeActor = 'actor' in event && typeof event.actor === 'number' ? event.actor : 0,
  onDone: () => void = () => {},
  shouldRun: () => boolean = () => true,
  retainedTargetAnchors: ReadonlyMap<string, DomEffectAnchor> = new Map(),
): void {
  if (animationSpeed === 'off') {
    onDone()
    return
  }
  if (typeof requestAnimationFrame !== 'function') {
    onDone()
    return
  }
  const descriptor = visualEffectForEvent(event, visualStyle)
  if (!descriptor) {
    onDone()
    return
  }
  const durationMs = durationMsForSpeed(animationSpeed)
  if (durationMs <= 0) {
    onDone()
    return
  }
  requestAnimationFrame(() => {
    if (!shouldRun()) {
      onDone()
      return
    }
    if (typeof document === 'undefined') {
      onDone()
      return
    }
    let target: HTMLElement | null = null
    let retainedTarget: HTMLElement | null = null
    const retainedAnchor = descriptor.kind === 'mountain_destroy' && descriptor.targetInstanceId
      ? retainedTargetAnchors.get(descriptor.targetInstanceId)
      : undefined
    if (retainedAnchor && descriptor.targetCardName && descriptor.targetInstanceId) {
      target = document.querySelector<HTMLElement>(
        `[data-battlefield-card-id="${escapeCssAttribute(descriptor.targetInstanceId)}"]`,
      )
    }
    if (!target && retainedAnchor && descriptor.targetCardName) {
      retainedTarget = document.createElement('div')
      retainedTarget.className = 'dom-effect-retained-target'
      retainedTarget.setAttribute('aria-hidden', 'true')
      retainedTarget.style.cssText = [
        'position:fixed',
        `left:${retainedAnchor.left}px`,
        `top:${retainedAnchor.top}px`,
        `width:${retainedAnchor.width}px`,
        `height:${retainedAnchor.height}px`,
      ].join(';')
      retainedTarget.innerHTML = renderCardTile(descriptor.targetCardName, descriptor.visualStyle)
      document.body.appendChild(retainedTarget)
      target = retainedTarget
    }
    if (!target) {
      for (const selector of selectorsForEffect(descriptor, activeActor)) {
        target = document.querySelector<HTMLElement>(selector)
        if (target) {
          break
        }
      }
    }
    if (!target) {
      onDone()
      return
    }
    const rect = retainedTarget ? retainedAnchor! : target.getBoundingClientRect()
    const el = document.createElement('div')
    el.className = `dom-effect dom-effect--${descriptor.kind}`
    el.style.cssText = [
      'position:fixed',
      `left:${rect.left}px`,
      `top:${rect.top}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      `--dom-effect-duration:${durationMs}ms`,
      `--effect-primary:${descriptor.palette.primary}`,
      `--effect-secondary:${descriptor.palette.secondary}`,
      `--effect-glow:${descriptor.palette.glow}`,
      'pointer-events:none',
      'z-index:9999',
      'overflow:hidden',
    ].join(';')
    const baseCount = DOM_EFFECT_PARTICLES[descriptor.kind]
    const particleCount = isReducedDomEffectQuality() ? Math.max(2, Math.ceil(baseCount / 2)) : baseCount
    el.innerHTML = buildParticles(descriptor.kind, particleCount)
    document.body.appendChild(el)
    // Self-remove: track animationend events from all particle children plus
    // the flash child (if any). Use a counter so we wait for the last one.
    const particleDivs = el.querySelectorAll<HTMLElement>('.dom-effect__particle,.dom-effect__flash')
    let remaining = particleDivs.length > 0 ? particleDivs.length : 1
    let completed = false
    const complete = (): void => {
      if (completed) {
        return
      }
      completed = true
      el.remove()
      retainedTarget?.remove()
      onDone()
    }
    const remove = (): void => {
      remaining -= 1
      if (remaining <= 0) {
        complete()
      }
    }
    for (const p of particleDivs) {
      p.addEventListener('animationend', remove, { once: true })
    }
    // Fallback timeout: remove even if animationend never fires (e.g. effect
    // hidden by prefers-reduced-motion: reduce or missing keyframe).
    setTimeout(complete, durationMs + 500)
  })
}

export interface DomEffectAnchor {
  left: number
  top: number
  width: number
  height: number
}

export function clearDomEffects(): void {
  if (typeof document === 'undefined') {
    return
  }
  for (const effect of document.querySelectorAll<HTMLElement>('.dom-effect,.dom-effect-retained-target')) {
    effect.remove()
  }
}
