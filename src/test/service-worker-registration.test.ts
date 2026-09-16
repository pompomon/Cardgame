import { describe, expect, it } from 'vitest'
import { serviceWorkerRegistrationUrl } from '../app/service-worker-registration'

describe('service worker registration URL', () => {
  it('preserves the deployment base and identifies the current entry build', () => {
    expect(serviceWorkerRegistrationUrl(
      '/Cardgame/',
      'https://example.test/Cardgame/assets/index-current123.js',
    )).toBe('/Cardgame/sw.js?base=%2FCardgame%2F&build=index-current123.js')
  })

  it('changes when a deployment emits a different entry chunk', () => {
    const first = serviceWorkerRegistrationUrl(
      '/Cardgame/',
      'https://example.test/Cardgame/assets/index-first.js',
    )
    const second = serviceWorkerRegistrationUrl(
      '/Cardgame/',
      'https://example.test/Cardgame/assets/index-second.js',
    )

    expect(second).not.toBe(first)
  })
})
