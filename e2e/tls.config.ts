import { defineConfig } from '@playwright/test'

/** Opt-in TLS path (e2e/tls.spec.ts); spawns its own HTTPS server, so none of the shared web servers are needed. */
export default defineConfig({ testDir: '.', testMatch: /tls\.spec/, timeout: 300_000, workers: 1 })
