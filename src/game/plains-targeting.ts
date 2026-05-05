const PLAINS_TARGET_SEPARATOR = '::'

export function encodePlainsEffectTargetId(reuseTargetId: string, reusedEffectTargetId?: string): string {
  if (!reusedEffectTargetId) {
    return reuseTargetId
  }
  return `${reuseTargetId}${PLAINS_TARGET_SEPARATOR}${reusedEffectTargetId}`
}

export function decodePlainsEffectTargetId(effectTargetId?: string): { reuseTargetId?: string; reusedEffectTargetId?: string } {
  if (!effectTargetId) {
    return {}
  }
  const separatorIndex = effectTargetId.indexOf(PLAINS_TARGET_SEPARATOR)
  if (separatorIndex < 0) {
    return { reuseTargetId: effectTargetId }
  }
  return {
    reuseTargetId: effectTargetId.slice(0, separatorIndex),
    reusedEffectTargetId: effectTargetId.slice(separatorIndex + PLAINS_TARGET_SEPARATOR.length),
  }
}
