import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // The design system lives in the web app; import it from there instead of copying it.
  resolve: {
    alias: { '@web': fileURLToPath(new URL('../web/src', import.meta.url)) },
    dedupe: ['react', 'react-dom', 'lucide-react', 'zustand'],
  },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: Number(process.env.DESKTOP_PORT ?? 1420),
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  test: { environment: 'jsdom', globals: false, setupFiles: ['./test/setup.ts'] },
})
