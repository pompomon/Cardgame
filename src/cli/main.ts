import type { CliIo } from './io'
import { formatCliHelp, parseCliArgs, type CliMode } from './options'
import { runGameSession } from './session'

async function promptForMode(io: CliIo): Promise<CliMode | null> {
  io.write('Choose a game mode:')
  io.write('1. Human vs AI')
  io.write('2. AI vs AI')
  while (!io.signal?.aborted) {
    const response = await io.read('Mode (1-2, or q to quit): ')
    if (response === null) {
      return null
    }
    const normalized = response.trim().toLowerCase()
    if (normalized === '1' || normalized === 'human-vs-ai') {
      return 'human-vs-ai'
    }
    if (normalized === '2' || normalized === 'ai-vs-ai') {
      return 'ai-vs-ai'
    }
    if (normalized === 'q' || normalized === 'quit') {
      return null
    }
    io.writeError('Invalid mode. Enter 1, 2, or q.')
  }
  return null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCliArgs(argv)
  if (!parsed.ok) {
    io.writeError(`Error: ${parsed.error}`)
    io.writeError('Use --help for usage.')
    return 2
  }
  if (parsed.options.help) {
    io.write(formatCliHelp())
    return 0
  }

  let mode = parsed.options.mode
  if (!mode) {
    if (!io.interactive) {
      io.writeError('Error: --mode is required when input is not an interactive terminal.')
      io.writeError('Use --help for usage.')
      return 2
    }
    mode = await promptForMode(io)
    if (!mode) {
      io.write('No game started.')
      return 0
    }
  }

  try {
    await runGameSession({
      mode,
      aiLevel: parsed.options.aiLevel,
      seed: parsed.options.seed,
      delayMs: parsed.options.delayMs,
    }, io)
    return 0
  } catch (error) {
    io.writeError(`Error: ${errorMessage(error)}`)
    return 1
  }
}
