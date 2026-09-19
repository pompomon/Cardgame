import { afterEach, describe, expect, it, vi } from 'vitest'

import { isGameAction } from '../app/action-validation'
import { applyAction, createInitialGame, getLegalActions } from '../game/engine'
import type { GameAction } from '../game/types'
import { P2PLink } from '../net/p2p'

class FakeDataChannel {
  readyState: RTCDataChannelState = 'open'
  onmessage: ((event: MessageEvent) => void) | null = null
  readonly sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {}
}

class FakePeerConnection {
  readonly channel = new FakeDataChannel()
  iceGatheringState: RTCIceGatheringState = 'complete'
  localDescription: RTCSessionDescriptionInit | null = null
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null

  createDataChannel(): RTCDataChannel {
    return this.channel as unknown as RTCDataChannel
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'legacy-compatible-offer' }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  close(): void {}
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('P2P compatibility', () => {
  it('serializes legacy-only action packets that both peers apply deterministically', async () => {
    const peer = new FakePeerConnection()
    vi.stubGlobal('RTCPeerConnection', class {
      constructor() {
        return peer
      }
    })
    const receivedPackets: Array<{ type: string; payload: unknown }> = []
    const link = new P2PLink((packet) => {
      receivedPackets.push(packet)
    })
    await link.createOffer()

    const actions = [
      { type: 'play_land', actor: 0, cardId: 'legacy-card', effectTargetId: 'legacy-target' },
      { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'legacy-target' },
      { type: 'resolve_swamp_discard', actor: 0, effectTargetId: 'legacy-card' },
      { type: 'counter_land', actor: 1, discardCardId: 'legacy-discard' },
      { type: 'pass_response', actor: 1 },
      { type: 'end_turn', actor: 0 },
    ] satisfies GameAction[]

    for (const action of actions) {
      expect(link.send('action', action)).toBe(true)
      expect(peer.channel.sent.at(-1)).toBe(JSON.stringify({
        type: 'action',
        payload: action,
      }))
    }
    expect(peer.channel.sent.join('')).not.toMatch(
      /displayName|assetSlug|Gravebloom|Siren|Gargoyle|Doppelgänger|Vampire/,
    )

    const initial = createInitialGame(4242)
    initial.players[0].hand = [
      { id: 'legacy-forest', name: 'Forest', type: 'land' },
    ]
    initial.players[1].hand = []
    const legalAction = getLegalActions(initial, 0).find(
      (action) => action.type === 'play_land' && action.cardId === 'legacy-forest',
    )
    expect(legalAction).toBeDefined()
    expect(link.send('action', legalAction)).toBe(true)
    const wirePacket = peer.channel.sent.at(-1)!
    peer.channel.onmessage?.({ data: wirePacket } as MessageEvent)
    const receivedPacket = receivedPackets[0]

    expect(receivedPacket).toEqual({
      type: 'action',
      payload: { type: 'play_land', actor: 0, cardId: 'legacy-forest' },
    })
    if (!receivedPacket || !isGameAction(receivedPacket.payload)) {
      throw new Error('Expected a legacy-compatible action packet.')
    }
    const hostState = applyAction(structuredClone(initial), legalAction!)
    const peerState = applyAction(structuredClone(initial), receivedPacket.payload)
    expect(peerState).toEqual(hostState)
  })
})
