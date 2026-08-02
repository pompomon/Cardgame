// Scene-wide numeric constants and identifiers shared between the lobby and
// cardgame scenes. Kept separate from theme.ts (colors/card styling) and
// scene-host.ts (Phaser.Game bootstrap) so each concern has a single home.
export const BASE_WIDTH = 1280
export const BASE_HEIGHT = 820
export const LOBBY_SCENE_KEY = 'cardgame-lobby'
export const CARDGAME_SCENE_KEY = 'cardgame-main'

export const DEFAULT_TARGET_OPTIONS = 5
export const SCROLL_INDICATOR_RIGHT_OFFSET = 10

// Cap how many log tiles we materialize per render. Long replays / imported
// recordings (or malicious JSON) can carry thousands of entries, and creating
// multiple Phaser GameObjects per entry on every render quickly becomes a
// freeze. When exceeded, we render only the most recent
// MAX_RENDERED_LOG_TILES entries with a leading "older entries omitted" row
// so the rest of the panel still functions.
export const MAX_RENDERED_LOG_TILES = 200

export const BLOB_URL_REVOCATION_DELAY_MS = 1000

export const INFO_PANEL_VERTICAL_PADDING = 12
export const INFO_PANEL_LINE_HEIGHT_MULTIPLIER = 1.25
export const MIN_LOBBY_ROW_HEIGHT = 16
export const DEFAULT_BATTLEFIELD_HEADER_BAND = 22

export const POPUP_CANCEL_BUTTON_WIDTH_RATIO = 0.62
export const POPUP_CANCEL_BUTTON_MIN_WIDTH = 180
export const POPUP_TOGGLE_BUTTON_WIDTH_RATIO = 0.72
export const POPUP_TOGGLE_BUTTON_MIN_WIDTH = 200

export const CARD_CHOICE_ICON_MIN_SIZE = 16
export const CARD_CHOICE_ICON_WIDTH_RATIO = 0.2
export const CARD_CHOICE_ICON_HEIGHT_RATIO = 0.8
export const CARD_FACE_ICON_MIN_SIZE = 22

export type LobbySubmenu = 'root' | 'settings' | 'recording'
