// This test runs under Node (vitest) and reads PNG files directly from disk.
// `@types/node` is not in this project's dev-deps, so node-stdlib modules
// (`node:fs` / `node:path`), `__dirname`, and `Buffer` are declared as
// ambient modules in `src/test/node-shims.d.ts` to satisfy `tsc --noEmit`.

import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_CARD_ART } from '../app/card-art'

const PUBLIC_ROOT = resolve(__dirname, '..', '..', 'public')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function publicPathFor(url: string): string {
  // cardArtUrl uses BASE_URL of '/' under vitest, so URL is '/cards/...'.
  return resolve(PUBLIC_ROOT, url.replace(/^\//, ''))
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0
}

function readImageSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path)
  if (buf.length < 24 || !bytesEqual(buf.slice(0, 8), PNG_SIGNATURE)) {
    throw new Error(`${path} is not a valid PNG (bad signature)`)
  }
  // IHDR is the first chunk; width and height are at offsets 16 and 20.
  const width = readUInt32BE(buf, 16)
  const height = readUInt32BE(buf, 20)
  return { width, height }
}

describe('card art asset files', () => {
  it('ships a PNG for every (style, land) entry registered in ALL_CARD_ART', () => {
    for (const entry of ALL_CARD_ART) {
      const path = publicPathFor(entry.url)
      // Existence + non-empty.
      const stat = statSync(path)
      expect(stat.size, `${entry.url} should be a non-empty file`).toBeGreaterThan(0)
      // PNG header + minimum useful dimensions.
      const { width, height } = readImageSize(path)
      expect(width, `${entry.url} width`).toBeGreaterThanOrEqual(256)
      expect(height, `${entry.url} height`).toBeGreaterThanOrEqual(256)
      expect(width, `${entry.url} must be square`).toBe(height)
    }
  })

  it('ships a runtime raster fallback PNG for every ALL_CARD_ART entry that declares one', () => {
    const fallbackEntries = ALL_CARD_ART.filter(
      (entry) => entry.fallbackUrl !== undefined,
    )
    // Sanity: at least the 5 HD lands ship a hd-fallback PNG.
    expect(fallbackEntries.length).toBeGreaterThanOrEqual(5)
    for (const entry of fallbackEntries) {
      const fallbackUrl = entry.fallbackUrl as string
      const path = publicPathFor(fallbackUrl)
      const stat = statSync(path)
      expect(stat.size, `${fallbackUrl} should be a non-empty file`).toBeGreaterThan(0)
      const { width, height } = readImageSize(path)
      expect(width, `${fallbackUrl} width`).toBeGreaterThanOrEqual(256)
      expect(height, `${fallbackUrl} height`).toBeGreaterThanOrEqual(256)
      expect(width, `${fallbackUrl} must be square`).toBe(height)
    }
  })

  it('ships a shared card-back PNG at the documented path', () => {
    const path = publicPathFor('/cards/card-back.png')
    const { width, height } = readImageSize(path)
    expect(width).toBeGreaterThanOrEqual(256)
    expect(height).toBeGreaterThanOrEqual(256)
    expect(width).toBe(height)
  })
})
