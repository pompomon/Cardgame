// Scene depth layering for the game view. Layering is anchored at
// the scene default depth (0), where gameplay UI (hand cards, End Turn /
// response buttons, battlefield rectangles & text) lives.
export const DEPTH_BOARD_BACKGROUND = -10
export const DEPTH_BOARD_AMBIENCE = -9
export const DEPTH_BOARD = -5
export const DEPTH_GAMEPLAY = 0
// Ability / play-land particle effects sit just above cards and battlefields
// but below the persistent header strip so they never obscure game controls.
export const DEPTH_EFFECT_OVERLAY = 1
export const DEPTH_HEADER_STRIP = 9
export const DEPTH_HEADER = 10
export const DEPTH_CARD_PREVIEW_OVERLAY = 15
export const DEPTH_MENU_OVERLAY = 20
export const DEPTH_TARGET_PICKER_OVERLAY = 30

export const SCENE_DEPTHS = {
  boardBackground: DEPTH_BOARD_BACKGROUND,
  boardAmbience: DEPTH_BOARD_AMBIENCE,
  board: DEPTH_BOARD,
  gameplay: DEPTH_GAMEPLAY,
  effectOverlay: DEPTH_EFFECT_OVERLAY,
  headerStrip: DEPTH_HEADER_STRIP,
  header: DEPTH_HEADER,
  cardPreviewOverlay: DEPTH_CARD_PREVIEW_OVERLAY,
  menuOverlay: DEPTH_MENU_OVERLAY,
  targetPickerOverlay: DEPTH_TARGET_PICKER_OVERLAY,
} as const
