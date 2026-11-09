// The information a seat's AI may use at a decision.
//
// Deck order is hidden from every player: no effect reveals or arranges a
// deck. Deck contents are knowable, because they are the deck list minus the
// cards seen elsewhere. A knowledge projection therefore keeps each deck only
// as a multiset, and search samples orders from it ("determinization"). When
// the profile cannot inspect the opponent's hand, that hand joins the
// opponent's deck in one hidden pool and is dealt back out of it at random.
//
// Every zone is sorted by id. Order within a zone has no effect on play when
// actions name their targets, so sorting makes search results independent of
// it.

import type { AiVisibilityProfile } from './ai-policy-types'
import { shuffleInPlace, type AiRng } from './ai-random'
import type { BattlefieldCard, Card, GameState, PlayerState } from './types'

export interface AiKnowledge {
  readonly actor: 0 | 1
  /**
   * The decision state without logs, with zones sorted by id and a hidden
   * opponent hand moved into that player's deck.
   */
  readonly root: GameState
  /** The opponent's hand size when that hand is hidden, otherwise `null`. */
  readonly hiddenOpponentHandSize: number | null
}

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}

function compareCards(left: Card, right: Card): number {
  return compareIds(left.id, right.id)
}

function compareBattlefieldCards(left: BattlefieldCard, right: BattlefieldCard): number {
  return compareIds(left.instanceId, right.instanceId)
}

function projectPlayer(player: PlayerState, pooled: boolean): PlayerState {
  const hidden = pooled ? [...player.deck, ...player.hand] : player.deck.slice()
  return {
    ...player,
    deck: hidden.sort(compareCards),
    hand: pooled ? [] : player.hand.slice().sort(compareCards),
    battlefield: player.battlefield.slice().sort(compareBattlefieldCards),
    graveyard: player.graveyard.slice().sort(compareCards),
  }
}

/** Projects `state` onto what `actor` may know under `visibility`. */
export function projectKnowledge(
  state: GameState,
  actor: 0 | 1,
  visibility: AiVisibilityProfile,
): AiKnowledge {
  const opponent = actor === 0 ? 1 : 0
  const hideOpponentHand = !visibility.canInspectOpponentHand
  const players: [PlayerState, PlayerState] = [
    projectPlayer(state.players[0], hideOpponentHand && opponent === 0),
    projectPlayer(state.players[1], hideOpponentHand && opponent === 1),
  ]
  return {
    actor,
    root: {
      ...state,
      players,
      pendingLandPlay: state.pendingLandPlay ? { ...state.pendingLandPlay } : null,
      pendingPlainsReuse: state.pendingPlainsReuse ? { ...state.pendingPlainsReuse } : null,
      pendingSwampDiscard: state.pendingSwampDiscard ? { ...state.pendingSwampDiscard } : null,
      log: [],
      events: [],
    },
    hiddenOpponentHandSize: hideOpponentHand ? state.players[opponent].hand.length : null,
  }
}

/**
 * Samples one complete state consistent with `knowledge`: every deck gets a
 * random order and a hidden opponent hand is dealt from its pool. The result
 * shares arrays with the projection, so advance it only with
 * `applyActionForSearch`, which copies before it changes anything.
 */
export function determinize(knowledge: AiKnowledge, rng: AiRng): GameState {
  const opponent = knowledge.actor === 0 ? 1 : 0
  const root = knowledge.root
  const sample = (player: PlayerState, seat: 0 | 1): PlayerState => {
    const deck = shuffleInPlace(player.deck.slice(), rng)
    if (seat !== opponent || knowledge.hiddenOpponentHandSize === null) {
      return { ...player, deck }
    }
    const hand = deck.splice(0, knowledge.hiddenOpponentHandSize)
    return { ...player, deck, hand }
  }
  return { ...root, players: [sample(root.players[0], 0), sample(root.players[1], 1)] }
}
