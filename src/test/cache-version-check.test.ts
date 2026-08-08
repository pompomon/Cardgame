import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  checkCacheVersionForRepo,
  evaluateCacheVersionCheck,
  extractCacheVersion,
} from './cache-version-check'

const REPO_ROOT = resolve(__dirname, '..', '..')

describe('cache-version unhashed-asset change warning', () => {
  it('extracts CACHE_VERSION from the service worker source', () => {
    expect(extractCacheVersion("const CACHE_VERSION = 'v7'\n")).toBe('v7')
  })

  it.each([
    'public/cards/hd/Forest.png',
    'public/boards/classic/background-hd.png',
    'public/sprites/board-ui-atlas.png',
  ])('warns when %s changes without a CACHE_VERSION bump', (changedPath) => {
    const result = evaluateCacheVersionCheck({
      baseCacheVersion: 'v7',
      changedPaths: [changedPath],
      currentCacheVersion: 'v7',
    })

    expect(result.kind).toBe('warning')
    expect(result).toMatchObject({
      message: expect.stringContaining('unhashed public assets changed without a public/sw.js CACHE_VERSION bump'),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining('Risk / migration notes'),
    })
  })

  it('does not warn when an unhashed asset changes with a CACHE_VERSION bump', () => {
    expect(
      evaluateCacheVersionCheck({
        baseCacheVersion: 'v7',
        changedPaths: ['public/cards/monochrome/Island.png'],
        currentCacheVersion: 'v8',
      }),
    ).toEqual({ kind: 'ok' })
  })

  it('does not warn when no unhashed public assets changed', () => {
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
