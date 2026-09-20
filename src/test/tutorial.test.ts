import { describe, expect, it } from 'vitest'
import { cardCatalogEntry } from '../app/card-catalog'
import { targetPromptForCard } from '../app/game-presentation'
import { getCurrentTutorialStep, TUTORIAL_STEPS } from '../app/tutorial'
import { tutorialPolicy } from '../game/ai-policies/tutorial'
import { createTutorialDecks } from '../game/cards'
import { applyAction, canAct, createInitialGame, getLegalActions } from '../game/engine'
import type { BasicLand, GameAction, GameState } from '../game/types'

function tutorialPolicyContext() {
  return {
    level: 'basic' as const,
    visibility: {
      kind: 'partial' as const,
      canInspectOpponentHand: false,
    },
  }
}

function countNames(deck: ReadonlyArray<{ name: BasicLand }>): Record<BasicLand, number> {
  const counts: Record<BasicLand, number> = {
    Forest: 0,
    Island: 0,
    Mountain: 0,
    Plains: 0,
    Swamp: 0,
  }
  for (const card of deck) {
    counts[card.name] += 1
  }
  return counts
}

function findPlayAction(state: GameState, name: BasicLand, targetId?: string): GameAction {
  const actions = getLegalActions(state, 0).filter((action) => action.type === 'play_land')
  const action = actions.find((candidate) => {
    const card = state.players[0].hand.find((entry) => entry.id === candidate.cardId)
    if (!card || card.name !== name) {
      return false
    }
    return targetId === undefined ? true : candidate.effectTargetId === targetId
  })
  if (!action) {
    throw new Error(`Expected playable action for ${name}`)
  }
  return action
}

function findSwampDiscardAction(state: GameState): GameAction {
  const action = getLegalActions(state, 0).find((candidate) => candidate.type === 'resolve_swamp_discard')
  if (!action) {
    throw new Error('Expected swamp discard resolution action')
  }
  return action
}

function takeAiAction(state: GameState): GameState {
  const actor = state.currentPlayer === 1 || state.phase === 'respond' ? 1 : 0
  const actions = getLegalActions(state, actor)
  const action = tutorialPolicy({
    state,
    actor,
    actions,
    context: tutorialPolicyContext(),
  })
  if (!action) {
    return state
  }
  return applyAction(state, action)
}

function playAiTurn(state: GameState): GameState {
  let next = state
  while (!(next.phase === 'main' && next.currentPlayer === 0 && canAct(next, 0))) {
    if (next.phase === 'respond') {
      if (canAct(next, 1)) {
        const updated = takeAiAction(next)
        if (updated === next) break
        next = updated
        continue
      }
      if (canAct(next, 0)) {
        const pass = getLegalActions(next, 0).find((action) => action.type === 'pass_response')
        if (!pass) break
        next = applyAction(next, pass)
        continue
      }
      break
    }
    if (next.currentPlayer === 1 && canAct(next, 1)) {
      const updated = takeAiAction(next)
      if (updated === next) break
      next = updated
      continue
    }
    break
  }
  return next
}

describe('tutorial mode', () => {
  it('derives every tutorial creature and ability name from the catalog', () => {
    const dryad = cardCatalogEntry('Forest')
    const siren = cardCatalogEntry('Island')
    const gargoyle = cardCatalogEntry('Mountain')
    const echo = cardCatalogEntry('Plains')
    const vampire = cardCatalogEntry('Swamp')
    expect(TUTORIAL_STEPS.map(({ id, hint }) => [id, hint])).toEqual([
      ['play-island-first', `Summon ${siren.displayName}. Your opponent has a ${siren.displayName} and will use ${siren.responseAbility!.name} on your first summon.`],
      ['island-countered', `Your opponent may use ${siren.responseAbility!.name} now by discarding ${siren.displayName} and one other card. If they do, your ${siren.displayName} goes to your discard pile.`],
      ['play-forest', `Summon ${dryad.displayName}. ${dryad.primaryAbility.name} returns ${siren.displayName} from your discard pile to your hand.`],
      ['play-island-draw', `Summon ${siren.displayName} again. ${siren.primaryAbility.name} draws one card.`],
      ['play-mountain', `Choose an opposing creature for ${gargoyle.primaryAbility.name}, then summon ${gargoyle.displayName} to send it to its owner's discard pile.`],
      ['play-swamp', `Summon ${vampire.displayName}, then use ${vampire.primaryAbility.name} to choose one card from your opponent's hand for them to discard.`],
      ['swamp-target', `${vampire.primaryAbility.name}: ${targetPromptForCard('Swamp')}`],
      ['play-plains', `Choose one of your creatures other than ${echo.displayName} for ${echo.primaryAbility.name}, then summon ${echo.displayName} to repeat its ability.`],
      ['plains-target', `${echo.primaryAbility.name}: Choose a target for the repeated ability.`],
      ['win', 'You won by summoning all five creature types to your board. Tutorial complete!'],
    ])
  })

  it.each(['Forest', 'Mountain', 'Swamp'] as const)(
    'prompts for the already-selected %s ability in every nested Mimic decision',
    (reusedName) => {
      const template = TUTORIAL_STEPS.find((step) => step.id === 'plains-target')!
      const fallbackHint = template.hint
      for (const targetCount of [1, 2]) {
        let state = createInitialGame(1, createTutorialDecks())
        state.players[0].hand = [{ id: 'echo', name: 'Plains', type: 'land' }]
        state.players[0].battlefield = [{
          instanceId: 'reused-creature',
          card: { id: 'reused-card', name: reusedName, type: 'land' },
        }]
        state.players[0].graveyard = Array.from({ length: targetCount }, (_, index) => ({
          id: `grave-${index}`,
          name: 'Island',
          type: 'land',
        }))
        state.players[1].battlefield = Array.from({ length: targetCount }, (_, index) => ({
          instanceId: `enemy-board-${index}`,
          card: { id: `enemy-card-${index}`, name: 'Plains', type: 'land' },
        }))
        state.players[1].hand = Array.from({ length: targetCount }, (_, index) => ({
          id: `enemy-hand-${index}`,
          name: 'Swamp',
          type: 'land',
        }))

        state = applyAction(state, findPlayAction(state, 'Plains', 'reused-creature'))
        expect(state.phase).toBe('plains_target')
        expect(state.pendingPlainsReuse?.reusedCardName).toBe(reusedName)
        const step = getCurrentTutorialStep(state)
        expect(step?.id).toBe('plains-target')
        expect(step?.condition).toBe(template.condition)
        expect(step?.hint).toBe(
          `${cardCatalogEntry('Plains').primaryAbility.name} — ${cardCatalogEntry(reusedName).primaryAbility.name}: ${targetPromptForCard(reusedName)}`,
        )
        expect(step?.hint).not.toContain('Choose one of your creatures')
        expect(template.hint).toBe(fallbackHint)

        const actions = getLegalActions(state, 0)
        expect(actions).toHaveLength(targetCount)
        expect(actions.every((action) => action.type === 'resolve_plains_reuse')).toBe(true)
        for (const action of actions) {
          const resolved = applyAction(state, action)
          expect(resolved.phase).toBe('main')
          expect(resolved.pendingPlainsReuse).toBeNull()
        }
      }
    },
  )

  it.each(['Forest', 'Island', 'Mountain', 'Swamp'] as const)(
    'does not request a nested target when repeating %s without targets',
    (reusedName) => {
      let state = createInitialGame(1, createTutorialDecks())
      state.players[0].hand = [{ id: 'echo', name: 'Plains', type: 'land' }]
      state.players[0].battlefield = [{
        instanceId: 'reused-creature',
        card: { id: 'reused-card', name: reusedName, type: 'land' },
      }]
      state.players[0].graveyard = []
      state.players[1].battlefield = []
      state.players[1].hand = []

      state = applyAction(state, findPlayAction(state, 'Plains', 'reused-creature'))

      expect(state.phase).toBe('main')
      expect(state.pendingPlainsReuse).toBeNull()
      expect(getCurrentTutorialStep(state)?.id).not.toBe('plains-target')
      expect(state.players[0].hand).toHaveLength(reusedName === 'Island' ? 1 : 0)
    },
  )

  it('keeps a safe repeated-ability hint when pending Mimic data is absent', () => {
    const state = createInitialGame(1, createTutorialDecks())
    state.phase = 'plains_target'
    state.pendingPlainsReuse = null
    expect(getCurrentTutorialStep(state)?.hint).toBe(
      `${cardCatalogEntry('Plains').primaryAbility.name}: Choose a target for the repeated ability.`,
    )
  })

  it('builds deterministic scripted tutorial decks', () => {
    const [playerDeck, aiDeck] = createTutorialDecks()
    const [playerDeckAgain, aiDeckAgain] = createTutorialDecks()

    expect(playerDeck).toHaveLength(50)
    expect(aiDeck).toHaveLength(50)
    expect(playerDeck).toEqual(playerDeckAgain)
    expect(aiDeck).toEqual(aiDeckAgain)

    expect(countNames(playerDeck)).toEqual({
      Forest: 10,
      Island: 10,
      Mountain: 10,
      Plains: 10,
      Swamp: 10,
    })
    expect(countNames(aiDeck)).toEqual({
      Forest: 0,
      Island: 1,
      Mountain: 0,
      Plains: 49,
      Swamp: 0,
    })
  })

  it('starts with scripted tutorial opening hands', () => {
    const state = createInitialGame(1, createTutorialDecks())
    expect(state.players[0].hand.map((card) => card.name)).toEqual(['Island', 'Forest', 'Mountain', 'Swamp', 'Plains'])
    expect(state.players[1].hand.map((card) => card.name)).toEqual(['Island', 'Plains', 'Plains', 'Plains', 'Plains'])
  })

  it('uses tutorial policy to counter first and otherwise pick safe actions', () => {
    let state = createInitialGame(1, createTutorialDecks())
    state = applyAction(state, findPlayAction(state, 'Island'))
    expect(state.phase).toBe('respond')

    const response = tutorialPolicy({
      state,
      actor: 1,
      actions: getLegalActions(state, 1),
      context: tutorialPolicyContext(),
    })
    expect(response?.type).toBe('counter_land')

    state = applyAction(state, response!)
    state = applyAction(state, { type: 'end_turn', actor: 0 })
    const mainActions = getLegalActions(state, 1)
    const picked = tutorialPolicy({
      state,
      actor: 1,
      actions: mainActions,
      context: tutorialPolicyContext(),
    })
    expect(picked?.type).toBe('play_land')
    if (picked?.type === 'play_land') {
      expect(picked.effectTargetId).toBeUndefined()
    }
  })

  it('progresses through script and wins by 5 different land types', () => {
    let state = createInitialGame(1, createTutorialDecks())
    expect(getCurrentTutorialStep(state)?.id).toBe('play-island-first')

    state = applyAction(state, findPlayAction(state, 'Island'))
    expect(getCurrentTutorialStep(state)?.id).toBe('island-countered')
    expect(getCurrentTutorialStep(state)?.hint).toContain(
      `may use ${cardCatalogEntry('Island').responseAbility!.name} now`,
    )
    state = takeAiAction(state)
    expect(state.players[0].graveyard.some((card) => card.name === 'Island')).toBe(true)
    expect(getCurrentTutorialStep(state)?.id).toBeUndefined()

    state = applyAction(state, { type: 'end_turn', actor: 0 })
    state = playAiTurn(state)
    expect(getCurrentTutorialStep(state)?.id).toBe('play-forest')

    state = applyAction(state, findPlayAction(state, 'Forest'))
    state = applyAction(state, { type: 'end_turn', actor: 0 })
    state = playAiTurn(state)
    expect(getCurrentTutorialStep(state)?.id).toBe('play-island-draw')

    state = applyAction(state, findPlayAction(state, 'Island'))
    state = applyAction(state, { type: 'end_turn', actor: 0 })
    state = playAiTurn(state)
    expect(getCurrentTutorialStep(state)?.id).toBe('play-mountain')

    state = applyAction(state, findPlayAction(state, 'Mountain'))
    state = applyAction(state, { type: 'end_turn', actor: 0 })
    state = playAiTurn(state)
    expect(getCurrentTutorialStep(state)?.id).toBe('play-swamp')

    state = applyAction(state, findPlayAction(state, 'Swamp'))
    expect(getCurrentTutorialStep(state)?.id).toBe('swamp-target')
    state = applyAction(state, findSwampDiscardAction(state))
    state = applyAction(state, { type: 'end_turn', actor: 0 })
    state = playAiTurn(state)
    expect(getCurrentTutorialStep(state)?.id).toBe('play-plains')

    const islandInstance = state.players[0].battlefield.find((entry) => entry.card.name === 'Island')?.instanceId
    expect(islandInstance).toBeTruthy()
    state = applyAction(state, findPlayAction(state, 'Plains', islandInstance))

    expect(state.winner).toBe(0)
    expect(state.phase).toBe('gameOver')
    expect(state.turn).toBe(11)
    expect(getCurrentTutorialStep(state)?.id).toBe('win')
  })

  it('returns null when no tutorial condition matches', () => {
    const state = createInitialGame(7)
    const ended = { ...state, phase: 'gameOver' as const, winner: 1 as const }
    expect(getCurrentTutorialStep(ended)).toBeNull()
  })
})
