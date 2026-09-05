import { DEFAULT_AI_LEVEL, isAiLevel, type AiLevel } from '../game/ai-levels'

export const CLI_MODES = ['human-vs-ai', 'ai-vs-ai'] as const
export type CliMode = typeof CLI_MODES[number]

export const DEFAULT_CLI_DELAY_MS = 350
export const MAX_CLI_DELAY_MS = 60_000
export const MAX_CLI_SEED = Number.MAX_SAFE_INTEGER

export interface CliOptions {
  readonly mode: CliMode | null
  readonly aiLevel: AiLevel
  readonly seed: number
  readonly delayMs: number
  readonly help: boolean
}

export type CliOptionsResult =
  | { readonly ok: true; readonly options: CliOptions }
  | { readonly ok: false; readonly error: string }

export function isCliMode(value: unknown): value is CliMode {
  return typeof value === 'string' && (CLI_MODES as readonly string[]).includes(value)
}

function parseBoundedInteger(
  value: string,
  option: string,
  maximum: number,
): { ok: true; value: number } | { ok: false; error: string } {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    return { ok: false, error: `${option} must be a non-negative integer.` }
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    return { ok: false, error: `${option} must be between 0 and ${maximum}.` }
  }
  return { ok: true, value: parsed }
}

export function parseCliArgs(
  argv: readonly string[],
  now: () => number = Date.now,
): CliOptionsResult {
  let mode: CliMode | null = null
  let aiLevel: AiLevel = DEFAULT_AI_LEVEL
  let seed = now()
  let delayMs = DEFAULT_CLI_DELAY_MS
  let help = false
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '-h' || argument === '--help') {
      if (seen.has('--help')) {
        return { ok: false, error: 'Option --help may only be provided once.' }
      }
      seen.add('--help')
      help = true
      continue
    }

    const separator = argument.indexOf('=')
    const option = separator >= 0 ? argument.slice(0, separator) : argument
    let value = separator >= 0 ? argument.slice(separator + 1) : undefined
    if (option !== '--mode'
      && option !== '--ai-level'
      && option !== '--seed'
      && option !== '--delay-ms') {
      return { ok: false, error: `Unknown option: ${argument}` }
    }
    if (seen.has(option)) {
      return { ok: false, error: `Option ${option} may only be provided once.` }
    }
    seen.add(option)
    if (value === undefined) {
      index += 1
      value = argv[index]
    }
    if (!value) {
      return { ok: false, error: `Option ${option} requires a value.` }
    }

    if (option === '--mode') {
      if (!isCliMode(value)) {
        return {
          ok: false,
          error: `--mode must be one of: ${CLI_MODES.join(', ')}.`,
        }
      }
      mode = value
      continue
    }
    if (option === '--ai-level') {
      if (!isAiLevel(value)) {
        return { ok: false, error: '--ai-level must be one of: basic, advanced, hard.' }
      }
      aiLevel = value
      continue
    }
    if (option === '--seed') {
      const parsed = parseBoundedInteger(value, '--seed', MAX_CLI_SEED)
      if (!parsed.ok) {
        return parsed
      }
      seed = parsed.value
      continue
    }

    const parsed = parseBoundedInteger(value, '--delay-ms', MAX_CLI_DELAY_MS)
    if (!parsed.ok) {
      return parsed
    }
    delayMs = parsed.value
  }

  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_CLI_SEED) {
    return { ok: false, error: `Generated seed must be between 0 and ${MAX_CLI_SEED}.` }
  }

  return {
    ok: true,
    options: Object.freeze({ mode, aiLevel, seed, delayMs, help }),
  }
}

export function formatCliHelp(): string {
  return [
    'Cardgame terminal CLI',
    '',
    'Usage:',
    '  cardgame-cli --mode <human-vs-ai|ai-vs-ai> [options]',
    '',
    'Options:',
    '  --mode <mode>          Game mode. Prompted when omitted in an interactive terminal.',
    '  --ai-level <level>     basic, advanced, or hard (default: basic).',
    '  --seed <integer>       Deterministic non-negative seed (default: current time).',
    `  --delay-ms <integer>  Delay before AI actions, 0-${MAX_CLI_DELAY_MS} (default: ${DEFAULT_CLI_DELAY_MS}).`,
    '  -h, --help             Show this help.',
    '',
    'During Human vs AI, enter an action number or q to quit.',
  ].join('\n')
}
