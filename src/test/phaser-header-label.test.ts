import { describe, expect, it } from 'vitest'

import { computeHeaderLabel } from '../renderers/phaser/header-label'

describe('computeHeaderLabel', () => {
  it('returns the turn/phase string when there is no winner', () => {
    expect(computeHeaderLabel({ winnerText: '', turn: 3, phase: 'main' })).toBe(
      'Turn 3 • Phase: main',
    )
  })

  it('returns ONLY the winner text once the game ends (no truncation risk)', () => {
    // Regression guard: inlining "Winner: Player 1 • Turn N • Phase: …" into a
    // single header row caused phone-width viewports to wrap+truncate and
    // hide the player name. Showing the winner alone keeps it readable.
    expect(computeHeaderLabel({
      winnerText: 'Winner: Player 1',
      turn: 15,
      phase: 'main',
    })).toBe('Winner: Player 1')
  })

  it('preserves draw-game text without appending turn/phase', () => {
    expect(computeHeaderLabel({
      winnerText: 'Draw game.',
      turn: 20,
      phase: 'gameOver',
    })).toBe('Draw game.')
  })
})
