export interface CoverCrop {
  readonly sourceX: number
  readonly sourceY: number
  readonly sourceWidth: number
  readonly sourceHeight: number
}

export interface RoundedCoverTextureSize {
  readonly width: number
  readonly height: number
  readonly radius: number
}

export function computeRoundedCoverTextureSize(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  targetRadius: number,
): RoundedCoverTextureSize {
  const scale = Math.max(1, Math.min(sourceWidth / targetWidth, sourceHeight / targetHeight))
  return {
    width: Math.max(1, Math.round(targetWidth * scale)),
    height: Math.max(1, Math.round(targetHeight * scale)),
    radius: Math.max(0, Math.round(targetRadius * scale)),
  }
}

export function computeCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CoverCrop {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const sourceCropWidth = Math.min(sourceWidth, targetWidth / scale)
  const sourceCropHeight = Math.min(sourceHeight, targetHeight / scale)
  return {
    sourceX: Math.max(0, (sourceWidth - sourceCropWidth) / 2),
    sourceY: Math.max(0, (sourceHeight - sourceCropHeight) / 2),
    sourceWidth: sourceCropWidth,
    sourceHeight: sourceCropHeight,
  }
}

export function roundedCoverTextureKey(
  sourceKey: string,
  width: number,
  height: number,
  radius: number,
): string {
  return `rounded-cover:${sourceKey}:${width}x${height}:r${radius}`
}

export function paintRoundedCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  radius: number,
): void {
  const crop = computeCoverCrop(sourceWidth, sourceHeight, width, height)
  const boundedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.clearRect(0, 0, width, height)
  context.save()
  context.beginPath()
  context.moveTo(boundedRadius, 0)
  context.lineTo(width - boundedRadius, 0)
  context.quadraticCurveTo(width, 0, width, boundedRadius)
  context.lineTo(width, height - boundedRadius)
  context.quadraticCurveTo(width, height, width - boundedRadius, height)
  context.lineTo(boundedRadius, height)
  context.quadraticCurveTo(0, height, 0, height - boundedRadius)
  context.lineTo(0, boundedRadius)
  context.quadraticCurveTo(0, 0, boundedRadius, 0)
  context.closePath()
  context.clip()
  context.drawImage(
    source,
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    0,
    0,
    width,
    height,
  )
  context.restore()
}
