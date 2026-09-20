import { afterEach, describe, expect, it, vi } from 'vitest'

import { isGameAction, isLegalActionForState } from '../app/action-validation'
import { applyAction } from '../game/engine'
import { P2PLink } from '../net/p2p'
import { compatibilityTimeline } from './fixtures/compatibility-scenario'

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
  it('exchanges every legal action family using legacy-only packets and identical peer states', async () => {
    const peers: FakePeerConnection[] = []
    vi.stubGlobal('RTCPeerConnection', class {
      constructor() {
        const peer = new FakePeerConnection()
        peers.push(peer)
        return peer
      }
    })
    const { initial, steps } = compatibilityTimeline()
    const states = [structuredClone(initial), structuredClone(initial)]
    const receivedCounts = [0, 0]
    const links = states.map((_state, receiver) => new P2PLink((packet) => {
      expect(packet.type).toBe('action')
      if (!isGameAction(packet.payload)) throw new Error('Expected legacy action packet.')
      expect(isLegalActionForState(states[receiver], packet.payload)).toBe(true)
      states[receiver] = applyAction(states[receiver], packet.payload)
      receivedCounts[receiver] += 1
    }))
    await links[0].createOffer()
    await links[1].createOffer()

    try {
      for (const { action, before, state } of steps) {
        const sender = action.actor
        const receiver = sender === 0 ? 1 : 0
        expect(states[sender]).toEqual(before)
        expect(isLegalActionForState(states[sender], action)).toBe(true)
        expect(links[sender].send('action', action)).toBe(true)
        const wirePacket = peers[sender].channel.sent.at(-1)!
        expect(wirePacket).toBe(JSON.stringify({ type: 'action', payload: action }))
        expect(wirePacket).not.toMatch(
          /displayName|assetSlug|Gravebloom|Siren|Gargoyle|Doppelgänger|Vampire/,
        )
        states[sender] = applyAction(states[sender], action)
        peers[receiver].channel.onmessage?.({ data: wirePacket } as MessageEvent)
        expect(states[receiver]).toEqual(states[sender])
        expect(states[receiver]).toEqual(state)
      }
      expect(new Set(steps.map(({ action }) => action.type))).toEqual(new Set([
        'play_land', 'resolve_plains_reuse', 'resolve_swamp_discard',
        'counter_land', 'pass_response', 'end_turn',
      ]))
      expect(receivedCounts[0]).toBeGreaterThan(0)
      expect(receivedCounts[1]).toBeGreaterThan(0)
      expect(receivedCounts[0] + receivedCounts[1]).toBe(steps.length)
      expect(states[0]).toMatchObject({ phase: 'gameOver', winner: 0, turn: 15 })
    } finally {
      links.forEach((link) => link.close())
    }
  })
})
