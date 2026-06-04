// Scene depth layering for the in-scene game view. Layering is anchored at
// the scene default depth (0), where gameplay UI (hand cards, End Turn /
// response buttons, battlefield rectangles & text) lives.
export const DEPTH_REPLAY_LOG = -10
export const DEPTH_REPLAY_LOG_HEADING = -9
export const DEPTH_BOARD = -5
export const DEPTH_GAMEPLAY = 0
export const DEPTH_HEADER_STRIP = 9
export const DEPTH_HEADER = 10
export const DEPTH_MENU_OVERLAY = 20
export const DEPTH_TARGET_PICKER_OVERLAY = 30

export const SCENE_DEPTHS = {
  replayLog: DEPTH_REPLAY_LOG,
  replayLogHeading: DEPTH_REPLAY_LOG_HEADING,
  board: DEPTH_BOARD,
  gameplay: DEPTH_GAMEPLAY,
  headerStrip: DEPTH_HEADER_STRIP,
  header: DEPTH_HEADER,
  menuOverlay: DEPTH_MENU_OVERLAY,
  targetPickerOverlay: DEPTH_TARGET_PICKER_OVERLAY,
} as const
