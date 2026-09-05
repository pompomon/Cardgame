import { describe, expect, it } from 'vitest'
import { isLegalActionForState } from '../app/action-validation'
import type { CliIo } from '../cli/io'
import { runGameSession } from '../cli/session'
import { applyAction, createInitialGame } from '../game/engine'

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
  it('reprompts invalid input, covers response/target phases, and applies only legal actions', async () => {
    const context = makeIo(['invalid', ...Array.from({ length: 500 }, () => '1')], false)
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
