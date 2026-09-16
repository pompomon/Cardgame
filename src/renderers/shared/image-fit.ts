export interface CoverFitCrop {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function computeCoverFitCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CoverFitCrop {
  const srcWidth = positiveFinite(sourceWidth)
  const srcHeight = positiveFinite(sourceHeight)
  const dstWidth = positiveFinite(targetWidth)
  const dstHeight = positiveFinite(targetHeight)
  const sourceAspect = srcWidth / srcHeight
  const targetAspect = dstWidth / dstHeight

  if (sourceAspect > targetAspect) {
    const width = srcHeight * targetAspect
    return {
      x: (srcWidth - width) / 2,
      y: 0,
      width,
      height: srcHeight,
    }
  }

  const height = srcWidth / targetAspect
  return {
    x: 0,
    y: (srcHeight - height) / 2,
    width: srcWidth,
    height,
  }
}
