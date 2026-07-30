export interface ViewportSize {
  width: number
  height: number
}

type RequestFrame = (callback: FrameRequestCallback) => number
type CancelFrame = (handle: number) => void

export function normalizeViewportSize(width: number, height: number): ViewportSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
  }
}

export function createViewportResizeScheduler(
  readSize: () => ViewportSize | null,
  applySize: (size: ViewportSize) => void,
  requestFrame: RequestFrame,
  cancelFrame: CancelFrame,
): { schedule: () => void; dispose: () => void } {
  let frame: number | null = null
  let lastSize: ViewportSize | null = null
  let disposed = false

  const schedule = (): void => {
    if (disposed) {
      return
    }
    if (frame !== null) {
      cancelFrame(frame)
    }
    frame = requestFrame(() => {
      frame = requestFrame(() => {
        frame = null
        const size = readSize()
        if (!size || (size.width === lastSize?.width && size.height === lastSize?.height)) {
          return
        }
        lastSize = size
        applySize(size)
      })
    })
  }

  const dispose = (): void => {
    disposed = true
    if (frame !== null) {
      cancelFrame(frame)
      frame = null
    }
  }

  return { schedule, dispose }
}

export function installViewportResizeSync(
  host: HTMLElement,
  applySize: (size: ViewportSize) => void,
): () => void {
  const scheduler = createViewportResizeScheduler(
    () => normalizeViewportSize(host.clientWidth, host.clientHeight),
    applySize,
    window.requestAnimationFrame.bind(window),
    window.cancelAnimationFrame.bind(window),
  )
  const visualViewport = window.visualViewport
  window.addEventListener('resize', scheduler.schedule)
  window.addEventListener('orientationchange', scheduler.schedule)
  visualViewport?.addEventListener('resize', scheduler.schedule)
  scheduler.schedule()

  return () => {
    window.removeEventListener('resize', scheduler.schedule)
    window.removeEventListener('orientationchange', scheduler.schedule)
    visualViewport?.removeEventListener('resize', scheduler.schedule)
    scheduler.dispose()
  }
}
