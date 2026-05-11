export type InSceneReplayLogContext = {
  menuOpen: boolean
}

export function shouldRenderInSceneReplayLog(context: InSceneReplayLogContext): boolean {
  // Keep the in-scene replay log visible for all gameplay phases (including
  // respond/plains_target) and only hide it when the full menu modal is open.
  return !context.menuOpen
}
