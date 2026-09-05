import { describe, expect, it } from 'vitest'
import type { CliIo } from '../cli/io'
import { runCli } from '../cli/main'
import {
  DEFAULT_CLI_DELAY_MS,
  MAX_CLI_DELAY_MS,
  parseCliArgs,
} from '../cli/options'

function makeIo(interactive: boolean): { io: CliIo; output: string[]; errors: string[] } {
  const output: string[] = []
  const errors: string[] = []
  return {
    output,
    errors,
    io: {
      interactive,
      async read() {
        return null
      },
      write(message) {
        output.push(message)
      },
      writeError(message) {
        errors.push(message)
      },
      async delay() {},
    },
  }
}

describe('CLI options', () => {
  it('uses canonical defaults and an injected current-time seed', () => {
    const result = parseCliArgs([], () => 1234)
    expect(result).toEqual({
      ok: true,
      options: {
        mode: null,
        aiLevel: 'basic',
        seed: 1234,
        delayMs: DEFAULT_CLI_DELAY_MS,
        help: false,
      },
    })
  })

  it('parses supported options in split and equals forms', () => {
    const result = parseCliArgs([
      '--mode=ai-vs-ai',
      '--ai-level', 'hard',
      '--seed=42',
      '--delay-ms', '0',
    ])
    expect(result).toMatchObject({
      ok: true,
      options: {
        mode: 'ai-vs-ai',
        aiLevel: 'hard',
        seed: 42,
        delayMs: 0,
      },
    })
  })

  it.each([
    [['--mode', 'network'], '--mode must be one of'],
    [['--ai-level', 'impossible'], '--ai-level must be one of'],
    [['--seed', '-1'], '--seed must be a non-negative integer'],
    [['--seed', '1.5'], '--seed must be a non-negative integer'],
    [['--delay-ms', String(MAX_CLI_DELAY_MS + 1)], '--delay-ms must be between'],
    [['--delay-ms'], 'requires a value'],
    [['--mode', 'ai-vs-ai', '--mode', 'human-vs-ai'], 'may only be provided once'],
    [['--network'], 'Unknown option'],
  ])('rejects invalid arguments %#', (argv, message) => {
    const result = parseCliArgs(argv)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(message)
    }
  })

  it('prints help without requiring a mode', async () => {
    const context = makeIo(false)
    const exitCode = await runCli(['--help'], context.io)
    expect(exitCode).toBe(0)
    expect(context.output.join('\n')).toContain('Cardgame terminal CLI')
    expect(context.errors).toEqual([])
  })

  it('requires an explicit mode for non-interactive input', async () => {
    const context = makeIo(false)
    const exitCode = await runCli([], context.io)
    expect(exitCode).toBe(2)
    expect(context.errors.join('\n')).toContain('--mode is required')
  })
})
