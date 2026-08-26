import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALL_BOARD_ATLAS_ASSETS,
  ALL_BOARD_BACKGROUND_ASSETS,
  type BoardBackgroundVariant,
} from '../app/board-assets'
import {
  AMBIENCE_ATLAS_FRAMES,
  BOARD_UI_ATLAS_FRAMES,
  EFFECTS_ATLAS_FRAMES,
} from '../renderers/phaser/asset-manifest'

const PUBLIC_ROOT = resolve(__dirname, '..', '..', 'public')
const GENERATOR_PATH = resolve(__dirname, '..', '..', 'scripts', 'generate-board-backgrounds.mjs')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MINIMUM_BACKGROUND_SIZE: Record<
  BoardBackgroundVariant,
  { readonly width: number; readonly height: number }
> = {
  hd: { width: 1920, height: 1080 },
  balanced: { width: 1280, height: 720 },
  low: { width: 960, height: 540 },
  fallback: { width: 640, height: 360 },
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0
}

function readPngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path)
  if (bytes.length < 24 || !bytesEqual(bytes.slice(0, 8), PNG_SIGNATURE)) {
    throw new Error(`${path} is not a valid PNG`)
  }
  return {
    width: readUInt32BE(bytes, 16),
    height: readUInt32BE(bytes, 20),
  }
}

function expectedFrames(name: string): readonly string[] {
  if (name.startsWith('ambience:')) {
    return AMBIENCE_ATLAS_FRAMES
  }
  if (name === 'board-ui') {
    return BOARD_UI_ATLAS_FRAMES
  }
  return EFFECTS_ATLAS_FRAMES
}

describe('board asset files', () => {
  it('ships every registered background at its quality-tier dimensions', () => {
    for (const asset of ALL_BOARD_BACKGROUND_ASSETS) {
      const path = resolve(PUBLIC_ROOT, asset.path)
      expect(statSync(path).size, `${asset.path} should be non-empty`).toBeGreaterThan(0)
      const size = readPngSize(path)
      expect(size.width, `${asset.path} width`)
        .toBeGreaterThanOrEqual(MINIMUM_BACKGROUND_SIZE[asset.variant].width)
      expect(size.height, `${asset.path} height`)
        .toBeGreaterThanOrEqual(MINIMUM_BACKGROUND_SIZE[asset.variant].height)
      expect(size.width / size.height, `${asset.path} aspect ratio`).toBeCloseTo(16 / 9, 5)
    }
  })

  it('ships valid textures and declared frames for every atlas', () => {
    for (const asset of ALL_BOARD_ATLAS_ASSETS) {
      const texturePath = resolve(PUBLIC_ROOT, asset.texturePath)
      expect(statSync(texturePath).size, `${asset.texturePath} should be non-empty`)
        .toBeGreaterThan(0)
      const textureSize = readPngSize(texturePath)
      expect(textureSize.width).toBeGreaterThan(0)
      expect(textureSize.height).toBeGreaterThan(0)

      const atlas = JSON.parse(readFileSync(resolve(PUBLIC_ROOT, asset.atlasPath), 'utf8')) as {
        frames?: Record<string, unknown>
        meta?: { image?: string; size?: { width?: number; height?: number; w?: number; h?: number } }
      }
      const atlasFileName = asset.texturePath.split('/').slice(-1)[0]
      expect(atlas.meta?.image).toBe(atlasFileName)
      expect(Object.keys(atlas.frames ?? {})).toEqual(expectedFrames(asset.name))
      expect(atlas.meta?.size?.w ?? atlas.meta?.size?.width).toBe(textureSize.width)
      expect(atlas.meta?.size?.h ?? atlas.meta?.size?.height).toBe(textureSize.height)
    }
  })

  it('renders deterministic outputs for every board background preset', () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'board-bg-'))
    const secondRoot = mkdtempSync(join(tmpdir(), 'board-bg-'))

    try {
      const smallVariants = [
        ['hd', 96, 54],
        ['balanced', 64, 36],
        ['low', 48, 27],
        ['fallback', 32, 18],
      ] as const
      const expectedSizes = new Map<string, { width: number; height: number }>(smallVariants.map(
        ([variantName, width, height]) => [variantName, { width, height }],
      ))

      const makeVariantList = (variants: readonly (readonly [string, number, number])[]) =>
        variants.map(([name, width, height]) => `${name}:${width}:${height}`).join(';')

      const runGenerator = (outputRoot: string): void => {
        const result = spawnSync(process.execPath, [
          GENERATOR_PATH,
          '--output',
          outputRoot,
          '--variants',
          makeVariantList(smallVariants),
        ], {
          cwd: resolve(__dirname, '..', '..'),
          stdio: 'pipe',
        })
        expect(result.status).toBe(0)
      }

      runGenerator(firstRoot)
      runGenerator(secondRoot)

      const expectedFiles = [
        'classic/background-hd.png',
        'classic/background-balanced.png',
        'classic/background-low.png',
        'classic/background-fallback.png',
        'moonlit/background-hd.png',
        'moonlit/background-balanced.png',
        'moonlit/background-low.png',
        'moonlit/background-fallback.png',
        'verdant/background-hd.png',
        'verdant/background-balanced.png',
        'verdant/background-low.png',
        'verdant/background-fallback.png',
      ]

      expect(expectedFiles).toHaveLength(12)

      for (const relativePath of expectedFiles) {
        const firstPath = join(firstRoot, relativePath)
        const secondPath = join(secondRoot, relativePath)
        const firstBytes = readFileSync(firstPath)
        const secondBytes = readFileSync(secondPath)
        expect(firstBytes).toEqual(secondBytes)

        const info = readPngSize(firstPath)
        const variantName = relativePath.split('/').slice(-1)[0].replace(/^background-/, '').replace(/\.png$/, '')
        expect(info.width).toBe(expectedSizes.get(variantName)?.width)
        expect(info.height).toBe(expectedSizes.get(variantName)?.height)
        expect(info.width / info.height).toBeCloseTo(16 / 9, 5)
      }
    } finally {
      rmSync(firstRoot, { recursive: true, force: true })
      rmSync(secondRoot, { recursive: true, force: true })
    }
  })
})
