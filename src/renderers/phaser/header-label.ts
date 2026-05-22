// Pure derivation of the Phaser scene's single-row header label.
//
// The Phaser cardgame scene reserves only one header row above the board
// (alongside the ☰ Menu button). Earlier code inlined the winner banner into
// the turn/phase string, e.g. "Winner: Player 1 • Turn 15 • Phase: main".
// On phone-width viewports the available header text width is small, so
// Phaser's single-line wrap+truncate dropped the trailing "Player N", leaving
// the user staring at "Winner:" with no winner shown.
//
// Once the game ends, turn/phase is no longer actionable information, while
// the winner is the most important thing to communicate. So when
// `winnerText` is non-empty we show it alone; otherwise we show the
// turn/phase string. Both fit comfortably on one line at any supported
// viewport width.

export interface HeaderLabelInput {
  winnerText: string
  turn: number
  phase: string
}

export function computeHeaderLabel(input: HeaderLabelInput): string {
  if (input.winnerText.length > 0) {
    return input.winnerText
  }
  return `Turn ${input.turn} • Phase: ${input.phase}`
}
