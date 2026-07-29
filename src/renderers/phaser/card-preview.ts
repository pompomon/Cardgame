export interface CardPreviewLayout {
  readonly centerX: number
  readonly centerY: number
  readonly scale: number
}

export function computeCardPreviewLayout(input: {
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly safeAreaLeft: number
  readonly safeAreaTop: number
  readonly safeAreaWidth: number
  readonly safeAreaHeight: number
  readonly cardWidth: number
  readonly cardHeight: number
  readonly margin: number
}): CardPreviewLayout {
  const availableWidth = Math.max(1, input.safeAreaWidth - input.margin * 2)
  const availableHeight = Math.max(1, input.safeAreaHeight - input.margin * 2)
  const desiredWidth = Math.min(availableWidth, Math.max(input.cardWidth, availableWidth * 0.42))
  const desiredHeight = Math.min(availableHeight, Math.max(input.cardHeight, availableHeight * 0.72))
  const scale = Math.max(1, Math.min(desiredWidth / input.cardWidth, desiredHeight / input.cardHeight))
  return {
    centerX: input.safeAreaLeft + input.safeAreaWidth / 2,
    centerY: input.safeAreaTop + input.safeAreaHeight / 2,
    scale,
  }
}
