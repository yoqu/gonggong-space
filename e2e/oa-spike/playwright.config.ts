import { defineConfig } from '@playwright/test'
import { EDITOR_PORT, HOST_PORT } from './ports'

export default defineConfig({
  testDir: '.',
  testMatch: /\.spike\.ts$/,
  timeout: 60_000,
  workers: 1,
  use: { trace: 'retain-on-failure', locale: 'zh-CN' },
  webServer: {
    command: 'node serve.mjs',
    env: { OA_SPIKE_HOST_PORT: String(HOST_PORT), OA_SPIKE_EDITOR_PORT: String(EDITOR_PORT) },
    url: `http://127.0.0.1:${HOST_PORT}/`,
    reuseExistingServer: false,
  },
})
