import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const title = 'Urban Creatures'
const description = 'Urban-fantasy 2-player card game with local AI and optional P2P mode.'

describe('browser metadata', () => {
  it('uses the approved title and description without root-relative deployed assets', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    expect(html).toContain(`<title>${title}</title>`)
    expect(html).toContain(`name="apple-mobile-web-app-title" content="${title}"`)
    expect(html).toContain(`name="description" content="${description}"`)
    for (const path of ['favicon.svg', 'apple-touch-icon.png', 'manifest.webmanifest']) {
      expect(html).toContain(`href="%BASE_URL%${path}"`)
    }
  })

  it('keeps manifest navigation and icons relative while applying approved branding', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8')) as {
      name: string
      short_name: string
      description: string
      start_url: string
      scope: string
      icons: Array<{ src: string }>
    }
    expect(manifest).toMatchObject({
      name: title,
      short_name: title,
      description,
      start_url: './',
      scope: './',
    })
    expect(manifest.icons.map(({ src }) => src)).toEqual([
      './pwa-192.png',
      './pwa-512.png',
      './pwa-maskable-512.png',
    ])
  })

  it('brands the GitHub Pages deep-link fallback consistently', () => {
    const html = readFileSync(join(root, 'public', '404.html'), 'utf8')
    expect(html).toContain(`<title>${title}</title>`)
  })
})
