import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Same certificate as the server: LAN daemons can bind to this origin, and Secure cookies need https.
const { GONGGONG_TLS_CERT: cert, GONGGONG_TLS_KEY: key } = process.env
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined
const server = process.env.GONGGONG_SERVER ?? `${https ? 'https' : 'http'}://127.0.0.1:8787`

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // One chunk for the first load; otherwise each module it shares with a lazy chunk gets its own.
        codeSplitting: { groups: [{ name: 'app', tags: ['$initial'] }] },
      },
    },
  },
  server: {
    host: process.env.WEB_HOST ?? '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    https,
    // The upstream is our own loopback server with a self-signed certificate.
    proxy: {
      '/api': { target: server, secure: false },
      '/ws': { target: server, ws: true, secure: false },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    // Most tests render the whole app and await several steps, each allowed the 5s asyncUtilTimeout from setup.ts;
    // with the default 5s test timeout, one slow step under parallel load kills the test before the query can report.
    testTimeout: 15_000,
  },
})
