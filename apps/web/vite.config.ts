import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const server = process.env.AIWS_SERVER ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { '/api': server, '/ws': { target: server, ws: true } },
  },
  test: { environment: 'jsdom', globals: false, setupFiles: ['./test/setup.ts'] },
})
