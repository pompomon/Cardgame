interface Packet {
  type: string
  payload: unknown
}

type MessageHandler = (packet: Packet) => void

export class P2PLink {
  private peer: RTCPeerConnection
  private channel: RTCDataChannel | null = null
  private onMessage: MessageHandler

  constructor(onMessage: MessageHandler) {
    this.onMessage = onMessage
    this.peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    this.peer.ondatachannel = (event) => {
      this.channel = event.channel
      this.attachChannel()
    }
  }

  private static isPacket(value: unknown): value is Packet {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    const packet = value as { type?: unknown; payload?: unknown }
    return typeof packet.type === 'string' && 'payload' in packet
  }

  private attachChannel(): void {
    if (!this.channel) {
      return
    }
    this.channel.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return
      }
      let packet: unknown
      try {
        packet = JSON.parse(event.data)
      } catch {
        return
      }
      if (!P2PLink.isPacket(packet)) {
        return
      }
      this.onMessage(packet)
    }
  }

  private async waitForIceGathering(): Promise<void> {
    if (this.peer.iceGatheringState === 'complete') {
      return
    }

    await new Promise<void>((resolve) => {
      const listener = (): void => {
        if (this.peer.iceGatheringState === 'complete') {
          this.peer.removeEventListener('icegatheringstatechange', listener)
          resolve()
        }
      }
      this.peer.addEventListener('icegatheringstatechange', listener)
    })
  }

  static encodeSession(value: RTCSessionDescriptionInit): string {
    return btoa(JSON.stringify(value))
  }

  static decodeSession(value: string): RTCSessionDescriptionInit {
    return JSON.parse(atob(value)) as RTCSessionDescriptionInit
  }

  async createOffer(): Promise<string> {
    this.channel = this.peer.createDataChannel('game')
    this.attachChannel()
    const offer = await this.peer.createOffer()
    await this.peer.setLocalDescription(offer)
    await this.waitForIceGathering()
    if (!this.peer.localDescription) {
      throw new Error('No local description available.')
    }
    return P2PLink.encodeSession(this.peer.localDescription)
  }

  async acceptOffer(encodedOffer: string): Promise<string> {
    const offer = P2PLink.decodeSession(encodedOffer)
    await this.peer.setRemoteDescription(offer)
    const answer = await this.peer.createAnswer()
    await this.peer.setLocalDescription(answer)
    await this.waitForIceGathering()
    if (!this.peer.localDescription) {
      throw new Error('No local description available.')
    }
    return P2PLink.encodeSession(this.peer.localDescription)
  }

  async acceptAnswer(encodedAnswer: string): Promise<void> {
    const answer = P2PLink.decodeSession(encodedAnswer)
    await this.peer.setRemoteDescription(answer)
  }

  send(type: string, payload: unknown): void {
    if (this.channel?.readyState !== 'open') {
      return
    }
    const packet: Packet = { type, payload }
    this.channel.send(JSON.stringify(packet))
  }

  isConnected(): boolean {
    return this.channel?.readyState === 'open'
  }
}
