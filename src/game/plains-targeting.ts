const PLAINS_TARGET_SEPARATOR = '::'

export interface PlainsTargeting {
  reuseTargetId: string
  reusedEffectTargetId?: string
}

export function encodePlainsTargeting(reuseTargetId: string, reusedEffectTargetId?: string): string {
  if (!reusedEffectTargetId) {
    return reuseTargetId
  }
  return `${reuseTargetId}${PLAINS_TARGET_SEPARATOR}${reusedEffectTargetId}`
}

export function decodePlainsTargeting(effectTargetId?: string): PlainsTargeting | null {
  if (!effectTargetId) {
    return null
  }

  const separatorIndex = effectTargetId.indexOf(PLAINS_TARGET_SEPARATOR)
  if (separatorIndex < 0) {
    return effectTargetId.length > 0 ? { reuseTargetId: effectTargetId } : null
  }

  const reuseTargetId = effectTargetId.slice(0, separatorIndex)
  if (reuseTargetId.length === 0) {
    return null
  }

  const reusedEffectTargetId = effectTargetId.slice(separatorIndex + PLAINS_TARGET_SEPARATOR.length)
  if (reusedEffectTargetId.length === 0) {
    return { reuseTargetId }
  }

  return {
    reuseTargetId,
    reusedEffectTargetId,
  }
}
