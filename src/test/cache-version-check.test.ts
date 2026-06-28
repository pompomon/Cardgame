import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  checkCacheVersionForRepo,
  evaluateCacheVersionCheck,
  extractCacheVersion,
} from './cache-version-check'

const REPO_ROOT = resolve(__dirname, '..', '..')

describe('cache-version card-art change warning', () => {
  it('extracts CACHE_VERSION from the service worker source', () => {
    expect(extractCacheVersion("const CACHE_VERSION = 'v7'\n")).toBe('v7')
  })

  it('warns when card files changed without a CACHE_VERSION bump', () => {
    const result = evaluateCacheVersionCheck({
      baseCacheVersion: 'v7',
      changedPaths: ['public/cards/hd/Forest.png'],
      currentCacheVersion: 'v7',
    })

    expect(result.kind).toBe('warning')
    expect(result).toMatchObject({
      message: expect.stringContaining('public/cards/ changed without a public/sw.js CACHE_VERSION bump'),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining('Risk / migration notes'),
    })
  })

  it('does not warn when card files changed with a CACHE_VERSION bump', () => {
    expect(
      evaluateCacheVersionCheck({
        baseCacheVersion: 'v7',
        changedPaths: ['public/cards/monochrome/Island.png'],
        currentCacheVersion: 'v8',
      }),
    ).toEqual({ kind: 'ok' })
  })

  it('does not warn when no card files changed', () => {
    expect(
      evaluateCacheVersionCheck({
        baseCacheVersion: 'v7',
        changedPaths: ['public/sw.js', 'src/app/card-art.ts'],
        currentCacheVersion: 'v7',
      }),
    ).toEqual({ kind: 'ok' })
  })

  it('skips instead of failing when CACHE_VERSION cannot be read', () => {
    expect(
      evaluateCacheVersionCheck({
        baseCacheVersion: null,
        changedPaths: ['public/cards/hd/Mountain.png'],
        currentCacheVersion: 'v7',
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
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('CACHE_VERSION bump'))
      } else {
        expect(warn).not.toHaveBeenCalled()
      }
    } finally {
      warn.mockRestore()
    }
  })
})
