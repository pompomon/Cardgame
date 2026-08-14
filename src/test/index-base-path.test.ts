import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('index entry path', () => {
  it('uses a base-relative module URL for project-site deployments', () => {
    const html = readFileSync(resolve(__dirname, '..', '..', 'index.html'), 'utf8')

    expect(html).toContain('src="./src/main.ts"')
    expect(html).not.toContain('src="/src/main.ts"')
  })
})
