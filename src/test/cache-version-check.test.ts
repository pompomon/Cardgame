import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  checkCacheVersionForRepo,
  evaluateCacheVersionCheck,
  extractRuntimeAssetVersion,
} from './cache-version-check'

const REPO_ROOT = resolve(__dirname, '..', '..')

describe('runtime-asset-version unhashed-asset change warning', () => {
  it('extracts RUNTIME_ASSET_VERSION from the service worker source', () => {
    expect(extractRuntimeAssetVersion("const RUNTIME_ASSET_VERSION = 'v7'\n")).toBe('v7')
  })

  it.each([
    'public/cards/hd/gravebloom-dryad.png',
    'public/boards/classic/background-hd.png',
  ])('warns when %s changes without a runtime asset version bump', (changedPath) => {
    const result = evaluateCacheVersionCheck({
      baseRuntimeAssetVersion: 'v7',
      changedPaths: [changedPath],
      currentRuntimeAssetVersion: 'v7',
    })

    expect(result.kind).toBe('warning')
    expect(result).toMatchObject({
      message: expect.stringContaining('unhashed public assets changed without a public/sw.js RUNTIME_ASSET_VERSION bump'),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining('Risk / migration notes'),
    })
  })

  it('does not warn when an unhashed asset changes with a runtime asset version bump', () => {
    expect(
      evaluateCacheVersionCheck({
        baseRuntimeAssetVersion: 'v7',
        changedPaths: ['public/cards/monochrome/signal-siren.png'],
        currentRuntimeAssetVersion: 'v8',
      }),
    ).toEqual({ kind: 'ok' })
  })

  it('does not warn when no unhashed public assets changed', () => {
    expect(
      evaluateCacheVersionCheck({
        baseRuntimeAssetVersion: 'v7',
        changedPaths: ['public/sw.js', 'src/app/card-art.ts'],
        currentRuntimeAssetVersion: 'v7',
      }),
    ).toEqual({ kind: 'ok' })
  })

  it('skips instead of failing when RUNTIME_ASSET_VERSION cannot be read', () => {
    expect(
      evaluateCacheVersionCheck({
        baseRuntimeAssetVersion: null,
        changedPaths: ['public/cards/hd/rooftop-gargoyle.png'],
        currentRuntimeAssetVersion: 'v7',
      }),
    ).toMatchObject({ kind: 'skipped' })
  })

  it('runs the real repository check as a soft warning', () => {
    const warn = vi.spyOn(console, 'warn')
    try {
      const result = checkCacheVersionForRepo(REPO_ROOT)

      if (result.kind === 'warning') {
        console.warn(result.message)
      }

      expect(['ok', 'skipped', 'warning']).toContain(result.kind)
      if (result.kind === 'warning') {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('RUNTIME_ASSET_VERSION bump'))
      } else {
        expect(warn).not.toHaveBeenCalled()
      }
    } finally {
      warn.mockRestore()
    }
  })
})
