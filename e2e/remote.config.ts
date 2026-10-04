import { defineConfig } from '@playwright/test'

/** Opt-in two-machine force sync (e2e/two-machines.spec.ts); spawns its own HTTPS server and repo server. */
export default defineConfig({
  testDir: '.',
  testMatch: /two-machines\.spec/,
  timeout: 30 * 60_000,
  workers: 1,
})
