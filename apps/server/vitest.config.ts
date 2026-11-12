import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Most tests boot the app on a fresh database; under parallel load the default 5s cuts slow ones off.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    globalSetup: ['test/support/template-db.ts'],
    setupFiles: ['test/support/setup.ts'],
  },
})
