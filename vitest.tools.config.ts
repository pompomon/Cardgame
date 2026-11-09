import { defineConfig } from 'vitest/config'

// Opt-in AI measurement tools (`npm run ai:tournament`, `npm run ai:tune`).
// `npm run test` uses the default include, which never matches `*.tool.ts`.
export default defineConfig({
  test: {
    include: ['src/test/tools/**/*.tool.ts'],
    testTimeout: 0,
    hookTimeout: 0,
  },
})
