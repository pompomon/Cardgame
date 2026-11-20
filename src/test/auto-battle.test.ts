import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdventureRun, createInactiveAdventureState, pauseAdventureRun, type AdventureRunState } from '../app/adventure'
import {
  aiLevelForSeat,
  canEnableAutoBattle,
  effectiveControllers,
  isAutoBattleMode,
  isAutoBattleSeat,
  type AutoBattleInput,
} from '../app/auto-battle'
import { createGameRecord } from '../app/game-recording'
import type { AiLevel, Mode } from '../app/types'
import { createInitialGame } from '../game/engine'

const TEST_RUN_ID = '0123456789abcdef0123456789abcdef'
const MODES: readonly (Mode | null)[] = [
  null, 'local-hvh', 'local-hvai', 'local-aivai', 'adventure-hvai', 'p2p-host', 'p2p-join', 'tutorial',
]

function input(overrides: Partial<AutoBattleInput> = {}): AutoBattleInput {
  return {
    autoBattle: true,
    mode: 'local-hvai',
    replay: null,
    game: createInitialGame(7),
    controllers: ['human', 'ai'],
    adventure: createInactiveAdventureState(),
    aiLevel: 'basic',
    ...overrides,
  }
}

function adventureInput(run: AdventureRunState | null, overrides: Partial<AutoBattleInput> = {}): AutoBattleInput {
  return input({ mode: 'adventure-hvai', adventure: { ...createInactiveAdventureState(0, run !== null), run }, ...overrides })
}

describe('Auto battle availability', () => {
  it('is offered only in Human vs AI games and Adventure', () => {
    const offered = MODES.filter((mode) => isAutoBattleMode(mode))
    const run = createAdventureRun(57, TEST_RUN_ID)

    expect(offered).toEqual(['local-hvai', 'adventure-hvai'])
    for (const mode of MODES) {
      expect(canEnableAutoBattle(adventureInput(run, { mode }))).toBe(offered.includes(mode))
    }
  })

  it('needs an Adventure run in progress and no result waiting to be saved', () => {
    const run = createAdventureRun(57, TEST_RUN_ID)

    expect(canEnableAutoBattle(adventureInput(run, { game: null }))).toBe(true)
    expect(canEnableAutoBattle(adventureInput(pauseAdventureRun(run)))).toBe(true)
    expect(canEnableAutoBattle(adventureInput(null))).toBe(false)
    expect(canEnableAutoBattle(adventureInput({ ...run, status: 'completed' }))).toBe(false)
    expect(canEnableAutoBattle(adventureInput({ ...run, status: 'failed' }))).toBe(false)
    const pending = adventureInput(run)
    expect(canEnableAutoBattle({ ...pending, adventure: { ...pending.adventure, pendingCompletion: { outcome: 'win' } } }))
      .toBe(false)
  })

  it('is unavailable during a replay', () => {
    const game = createInitialGame(7)
    const record = createGameRecord(7, 'local-hvai', ['human', 'ai'], 'basic', game, 0)

    expect(canEnableAutoBattle(input({ replay: { record, step: 0, isPlaying: false } }))).toBe(false)
  })
})

describe('Auto battle seats', () => {
  it('plays only the human seat, and only while the game is in progress', () => {
    const over = createInitialGame(7)
    over.phase = 'gameOver'

    expect([0, 1].map((actor) => isAutoBattleSeat(input(), actor))).toEqual([true, false])
    expect(isAutoBattleSeat(input({ autoBattle: false }), 0)).toBe(false)
    expect(isAutoBattleSeat(input({ game: null }), 0)).toBe(false)
    expect(isAutoBattleSeat(input({ game: over }), 0)).toBe(false)
    expect(isAutoBattleSeat(input({ mode: 'tutorial' }), 0)).toBe(false)
    expect(isAutoBattleSeat(input({ mode: 'local-hvh', controllers: ['human', 'human'] }), 1)).toBe(false)
  })

  it.each(['basic', 'advanced', 'hard'] as const)('gives the auto seat Hard and the opponent its %s level', (aiLevel: AiLevel) => {
    expect(aiLevelForSeat(input({ aiLevel }), 0)).toBe('hard')
    expect(aiLevelForSeat(input({ aiLevel }), 1)).toBe(aiLevel)
    expect(aiLevelForSeat(input({ aiLevel, autoBattle: false }), 0)).toBeNull()
    expect(aiLevelForSeat(input({ aiLevel, mode: 'local-aivai', controllers: ['ai', 'ai'], autoBattle: false }), 0))
      .toBe(aiLevel)
  })

  it('returns new effective seats without changing the real ones', () => {
    const state = input()
    const controllers = Object.freeze(['human', 'ai'] as const) as unknown as AutoBattleInput['controllers']
    const effective = effectiveControllers({ ...state, controllers })

    expect(effective).toEqual(['ai', 'ai'])
    expect(effective).not.toBe(controllers)
    expect(controllers).toEqual(['human', 'ai'])
    expect(effectiveControllers(input({ autoBattle: false }))).toEqual(['human', 'ai'])
  })
})

describe('Auto battle module boundary', () => {
  const source = readFileSync(resolve(__dirname, '..', 'app', 'auto-battle.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('imports only app types, and only as types', () => {
    const imports = [...code.matchAll(/\bimport\b[^'"]*['"]([^'"]+)['"]/g)].map((match) => match[0])

    expect(imports).toEqual([expect.stringMatching(/^import type \{[^}]*\} from '\.\/types'$/)])
  })

  it('reads no storage, DOM, clock or randomness', () => {
    for (const forbidden of [/\blocalStorage\b/, /\bdocument\b/, /\bwindow\b/, /\bDate\b/, /\bMath\.random\b/]) {
      expect(code).not.toMatch(forbidden)
    }
  })
})
