import { defineConfig } from '@playwright/test'

const SERVER_PORT = 8790
const WEB_PORT = 5190

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'bash ../scripts/pg.sh reset aiws_e2e && pnpm --filter @aiws/server start',
      env: { PORT: String(SERVER_PORT), AIWS_DB: 'aiws_e2e', AIWS_ADMIN_PASSWORD: 'admin-init-pass' },
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @aiws/web dev --strictPort',
      env: { WEB_PORT: String(WEB_PORT), AIWS_SERVER: `http://127.0.0.1:${SERVER_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
})
