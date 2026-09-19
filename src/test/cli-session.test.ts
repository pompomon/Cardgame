import { describe, expect, it } from 'vitest'
import { isLegalActionForState } from '../app/action-validation'
import type { CliIo } from '../cli/io'
import { formatTerminalGameState, runGameSession } from '../cli/session'
import { applyAction, createInitialGame } from '../game/engine'
import type { GamePhase } from '../game/types'

interface TestIoContext {
  io: CliIo
  output: string[]
  errors: string[]
  delayCalls: number[]
}

function makeIo(responses: string[], captureOutput = true): TestIoContext {
  const pending = [...responses]
  const output: string[] = []
  const errors: string[] = []
  const delayCalls: number[] = []
  return {
    output,
    errors,
    delayCalls,
    io: {
      interactive: false,
      async read() {
        return pending.shift() ?? null
      },
      write(message) {
        if (captureOutput) {
          output.push(message)
        }
      },
      writeError(message) {
        errors.push(message)
      },
      async delay(milliseconds) {
        delayCalls.push(milliseconds)
      },
    },
  }
}

describe('terminal game session', () => {
  it.each([
    ['main', 'Action phase'],
    ['plains_target', 'Action phase'],
    ['swamp_target', 'Action phase'],
    ['respond', 'Interception window'],
    ['gameOver', 'Game over'],
  ] satisfies Array<[GamePhase, string]>)('presents %s as %s', (phase, label) => {
    const state = createInitialGame(3)
    state.phase = phase

    const lines = formatTerminalGameState(state, ['human', 'human'], 0)

    expect(lines[1]).toContain(`Phase: ${label}`)
    expect(lines[1]).not.toContain(`Phase: ${phase}`)
  })

  it('uses catalog card names and approved zone labels', () => {
    const state = createInitialGame(4)
    state.players[0].hand = [
      { id: 'forest', name: 'Forest', type: 'land' },
      { id: 'plains', name: 'Plains', type: 'land' },
    ]
    state.players[0].battlefield = [{
      instanceId: 'mountain-instance',
      card: { id: 'mountain', name: 'Mountain', type: 'land' },
    }]
    state.players[0].graveyard = [{ id: 'island', name: 'Island', type: 'land' }]

    const output = formatTerminalGameState(state, ['human', 'human'], 0).join('\n')

    expect(output).toContain('Discard pile: 1')
    expect(output).toContain('Hand: Gravebloom Dryad, Echo Doppelgänger')
    expect(output).toContain('Board: Rooftop Gargoyle')
    expect(output).not.toMatch(/Battlefield:|Graveyard:/)
  })

  it.each([
    ['swamp_target', false],
    ['plains_target', true],
  ] satisfies Array<[GamePhase, boolean]>)(
    'reveals catalog-backed Drain Memory targets during %s',
    (phase, mimicked) => {
      const state = createInitialGame(5)
      state.phase = phase
      state.players[1].hand = [
        { id: 'mountain', name: 'Mountain', type: 'land' },
        { id: 'plains', name: 'Plains', type: 'land' },
      ]
      state.pendingSwampDiscard = mimicked ? null : { actor: 0 }
      state.pendingPlainsReuse = mimicked
        ? { actor: 0, reusedInstanceId: 'swamp-instance', reusedCardName: 'Swamp' }
        : null

      const output = formatTerminalGameState(state, ['human', 'ai'], 0).join('\n')

      expect(output).toContain('Hand: 2 hidden cards')
      expect(output).toContain('Drain Memory targets: Rooftop Gargoyle, Echo Doppelgänger')
    },
  )

  it('keeps the opposing hand hidden outside a Drain Memory decision', () => {
    const state = createInitialGame(6)
    state.players[0].hand = []
    state.players[1].hand = [
      { id: 'mountain', name: 'Mountain', type: 'land' },
      { id: 'plains', name: 'Plains', type: 'land' },
    ]

    const output = formatTerminalGameState(state, ['human', 'ai'], 0).join('\n')

    expect(output).toContain('Hand: 2 hidden cards')
    expect(output).not.toContain('Drain Memory targets:')
    expect(output).not.toMatch(/Rooftop Gargoyle|Echo Doppelgänger/)
  })

  it('reprompts invalid input, covers response/target phases, and applies only legal actions', async () => {
    const context = makeIo(['invalid', ...Array.from({ length: 500 }, () => '1')])
    const result = await runGameSession({
      mode: 'human-vs-ai',
      aiLevel: 'basic',
      seed: 0,
      delayMs: 0,
    }, context.io)

    expect(result.status).toBe('completed')
    expect(result.state.phase).toBe('gameOver')
    expect(context.errors).toEqual([
      expect.stringContaining('Invalid selection'),
    ])
    expect(result.actions.some((action) => action.type === 'counter_land')).toBe(true)
    expect(result.actions.some((action) => action.type === 'resolve_plains_reuse')).toBe(true)
    expect(result.actions.some((action) => action.type === 'resolve_swamp_discard')).toBe(true)
    const output = context.output.join('\n')
    expect(output).toContain('Summon ')
    expect(output).toContain('Intercept with Signal Siren')
    expect(output).toContain('Mimic ')
    expect(output).toContain('Drain Memory')

    let replayed = createInitialGame(0)
    for (const action of result.actions) {
      expect(isLegalActionForState(replayed, action)).toBe(true)
      replayed = applyAction(replayed, action)
    }
    expect(replayed).toEqual(result.state)
  })

  it('supports quit and EOF without applying a human action or exposing the AI hand', async () => {
    const quitContext = makeIo(['q'])
    const quitResult = await runGameSession({
      mode: 'human-vs-ai',
      aiLevel: 'basic',
      seed: 10,
      delayMs: 0,
    }, quitContext.io)
    expect(quitResult.status).toBe('quit')
    expect(quitResult.actions).toHaveLength(0)
    expect(quitContext.output).toContain('  Hand: 5 hidden cards')

    const eofContext = makeIo([])
    const eofResult = await runGameSession({
      mode: 'human-vs-ai',
      aiLevel: 'basic',
      seed: 10,
      delayMs: 0,
    }, eofContext.io)
    expect(eofResult.status).toBe('quit')
    expect(eofResult.actions).toHaveLength(0)
  })

  it('runs deterministic AI vs AI games to completion with one shared level', async () => {
    const firstIo = makeIo([], false)
    const secondIo = makeIo([], false)
    const config = {
      mode: 'ai-vs-ai' as const,
      aiLevel: 'advanced' as const,
      seed: 77,
      delayMs: 0,
    }

    const first = await runGameSession(config, firstIo.io)
    const second = await runGameSession(config, secondIo.io)

    expect(first.status).toBe('completed')
    expect(first.state.phase).toBe('gameOver')
    expect(first.actions).toEqual(second.actions)
    expect(first.state).toEqual(second.state)
  })
})
